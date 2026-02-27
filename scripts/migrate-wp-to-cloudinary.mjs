#!/usr/bin/env node
/**
 * migrate-wp-to-cloudinary.mjs
 *
 * Rewrites WordPress media URLs in:
 *   /Users/gmik/portfolio/src/content/showcase/index.mdx
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { v2 as cloudinary } from 'cloudinary';

dotenv.config();

// Manual overrides for assets that were renamed / moved on Cloudinary.
// Key: exact WP URL in MDX
// Value: exact Cloudinary URL (mp4) to replace with
const MANUAL_URL_MAP = {
  // 2023/01 CNY stickers (uploaded without folder, auto-suffixed)
  'https://janet.ng/wp-content/uploads/2023/01/大展鴻兔2-1.gif':
    'https://res.cloudinary.com/dwj5kjslu/video/upload/v1772211175/%E5%A4%A7%E5%B1%95%E9%B4%BB%E5%85%942-1_mvwvq7.mp4',

  'https://janet.ng/wp-content/uploads/2023/01/恭喜發財.gif':
    'https://res.cloudinary.com/dwj5kjslu/video/upload/v1772211139/%E6%81%AD%E5%96%9C%E7%99%BC%E8%B2%A1_gaxgbj.mp4',

  'https://janet.ng/wp-content/uploads/2023/01/百毒不侵-1.gif':
    'https://res.cloudinary.com/dwj5kjslu/video/upload/v1772211138/%E7%99%BE%E6%AF%92%E4%B8%8D%E4%BE%B5-1_knvwbm.mp4',

  'https://janet.ng/wp-content/uploads/2023/01/食極唔肥.gif':
    'https://res.cloudinary.com/dwj5kjslu/video/upload/v1772211122/%E9%A3%9F%E6%A5%B5%E5%94%94%E8%82%A5_o54rjq.mp4',

  'https://janet.ng/wp-content/uploads/2023/01/青春常駐-1.gif':
    'https://res.cloudinary.com/dwj5kjslu/video/upload/v1772211084/%E9%9D%92%E6%98%A5%E5%B8%B8%E9%A7%90-1_owvzu7.mp4',

  'https://janet.ng/wp-content/uploads/2023/01/告別OT_1.gif':
    'https://res.cloudinary.com/dwj5kjslu/video/upload/v1772211083/%E5%91%8A%E5%88%A5OT_1_zytd8l.mp4',

  'https://janet.ng/wp-content/uploads/2023/01/心想事成.gif':
    'https://res.cloudinary.com/dwj5kjslu/video/upload/v1772211082/%E5%BF%83%E6%83%B3%E4%BA%8B%E6%88%90_nne0vw.mp4',

  'https://janet.ng/wp-content/uploads/2023/01/利是到.gif':
    'https://res.cloudinary.com/dwj5kjslu/video/upload/v1772211079/%E5%88%A9%E6%98%AF%E5%88%B0_jmrrmb.mp4',

  // ezgif mismatches (hash changed after re-export)
  // IMPORTANT: if these two are swapped visually, just swap the values.
  'https://janet.ng/wp-content/uploads/2022/06/ezgif-3-1fb173cbac.gif':
    'https://res.cloudinary.com/dwj5kjslu/video/upload/v1771728101/2022/06/ezgif-3-2bd4b89d01.mp4',

  'https://janet.ng/wp-content/uploads/2022/06/ezgif-3-426c9abe55.gif':
    'https://res.cloudinary.com/dwj5kjslu/video/upload/v1771728093/2022/06/ezgif-3-2bd4b89d01-1.mp4'
};

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const VERBOSE = args.has('--verbose');
const ROOT = '/Users/gmik/portfolio/src/content/showcase';
const TARGET_FILENAME = 'index.mdx';

// Match URLs anywhere in MDX (frontmatter, html, markdown)
const WP_URL_RE = /https?:\/\/(?:www\.)?janet\.ng\/wp-content\/uploads\/(\d{4})\/(\d{2})\/([^"')\s<>\]]+)/g;

const CACHE_PATH = path.resolve(process.cwd(), '.cld_resource_cache.json');
const RATE_DELAY_MS = 350; // keep it gentle to avoid 429

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function loadCache() {
  if (!fs.existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveCache(cache) {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

function stripQueryAndHash(s) {
  return s.split('#')[0].split('?')[0];
}

function decodePathSegment(s) {
  // WordPress URLs may contain %20 etc.
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function removeExtension(filename) {
  return filename.replace(/\.[^/.]+$/, '');
}

function buildCloudUrl(cloudName, resourceType, publicId) {
  // Extensionless: Cloudinary will serve based on stored asset and/or transformations you add later.
  return `https://res.cloudinary.com/${cloudName}/${resourceType}/upload/${publicId}`;
}

function candidateBases(baseNoExt) {
  const cands = [baseNoExt];

  // strip -WxH
  const mSize = baseNoExt.match(/^(.*)-\d+x\d+$/);
  if (mSize && mSize[1]) cands.push(mSize[1]);

  // strip -scaled
  const mScaled = baseNoExt.match(/^(.*)-scaled$/i);
  if (mScaled && mScaled[1]) cands.push(mScaled[1]);

  // strip -copy and -copy-N
  const mCopy = baseNoExt.match(/^(.*)-copy(?:-\d+)?$/i);
  if (mCopy && mCopy[1]) cands.push(mCopy[1]);

  // strip _thumbnail or -thumbnail
  const mThumb = baseNoExt.match(/^(.*?)(?:[_-]thumbnail)$/i);
  if (mThumb && mThumb[1]) cands.push(mThumb[1]);

  // convert underscores to dashes
  cands.push(baseNoExt.replace(/_/g, '-'));

  // convert dashes to underscores
  cands.push(baseNoExt.replace(/-/g, '_'));

  return [...new Set(cands)];
}

async function existsOnCloud(publicId, resourceType, cache) {
  const key = `${resourceType}:${publicId}`;
  if (key in cache) return cache[key];

  try {
    await cloudinary.api.resource(publicId, { resource_type: resourceType });
    cache[key] = true;
    return true;
  } catch (e) {
    cache[key] = false;
    return false;
  } finally {
    await sleep(RATE_DELAY_MS);
  }
}

async function resolveCloudinaryTarget(year, month, filenameWithExt, cache) {
  const clean = stripQueryAndHash(filenameWithExt);
  const decoded = decodePathSegment(clean);
  const ext = decoded.split('.').pop().toLowerCase();
  const baseNoExt = removeExtension(decoded);
  const bases = candidateBases(baseNoExt);

  // GIFs were converted to MP4 → must exist as video
  if (ext === 'gif') {
    for (const b of bases) {
      const publicId = `${year}/${month}/${b}`;
      if (await existsOnCloud(publicId, 'video', cache)) {
        return { resourceType: 'video', publicId };
      }
    }
    return null;
  }

  // Normal image first
  for (const b of bases) {
    const publicId = `${year}/${month}/${b}`;
    if (await existsOnCloud(publicId, 'image', cache)) {
      return { resourceType: 'image', publicId };
    }
  }

  // Then try video (in case some non-gif was uploaded as video)
  for (const b of bases) {
    const publicId = `${year}/${month}/${b}`;
    if (await existsOnCloud(publicId, 'video', cache)) {
      return { resourceType: 'video', publicId };
    }
  }

  return null;
}

function* walkFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walkFiles(p);
    else if (ent.isFile() && ent.name === TARGET_FILENAME) yield p;
  }
}

function ensureEnv() {
  const missing = [];
  if (!process.env.CLD_CLOUD_NAME) missing.push('CLD_CLOUD_NAME');
  if (!process.env.CLD_API_KEY) missing.push('CLD_API_KEY');
  if (!process.env.CLD_API_SECRET) missing.push('CLD_API_SECRET');

  if (missing.length) {
    console.error(
      `Missing env vars: ${missing.join(', ')}\n\n` +
        `Create a .env in the folder you run this script from:\n` +
        `CLD_CLOUD_NAME=dwj5kjslu\nCLD_API_KEY=...\nCLD_API_SECRET=...\n`
    );
    process.exit(1);
  }
}

async function main() {
  ensureEnv();

  cloudinary.config({
    cloud_name: process.env.CLD_CLOUD_NAME,
    api_key: process.env.CLD_API_KEY,
    api_secret: process.env.CLD_API_SECRET
  });

  const cache = loadCache();

  const files = [...walkFiles(ROOT)];
  if (!files.length) {
    console.log(`No ${TARGET_FILENAME} found under: ${ROOT}`);
    return;
  }

  let totalReplacements = 0;
  const notFound = [];

  for (const filePath of files) {
    const original = fs.readFileSync(filePath, 'utf8');

    let changed = false;
    let out = original;

    // Collect all matches first (so we can await Cloudinary checks)
    const matches = [];
    WP_URL_RE.lastIndex = 0;
    for (let m; (m = WP_URL_RE.exec(original)) !== null; ) {
      matches.push({
        full: m[0],
        year: m[1],
        month: m[2],
        filename: m[3]
      });
    }

    if (!matches.length) continue;

    // De-dup by full URL within file
    const uniq = new Map();
    for (const m of matches) uniq.set(m.full, m);
    const uniqMatches = [...uniq.values()];

    const planned = [];

    for (const m of uniqMatches) {
      // Manual override (exact URL replacement)
      if (MANUAL_URL_MAP[m.full]) {
        planned.push({ from: m.full, to: MANUAL_URL_MAP[m.full] });
        continue;
      }

      const resolved = await resolveCloudinaryTarget(m.year, m.month, m.filename, cache);
      if (!resolved) {
        notFound.push({ file: filePath, url: m.full });
        if (VERBOSE) console.log(`[MISS] ${filePath}\n  ${m.full}`);
        continue;
      }

      const newUrl = buildCloudUrl(process.env.CLD_CLOUD_NAME, 
resolved.resourceType, resolved.publicId);

      if (newUrl !== m.full) {
        planned.push({ from: m.full, to: newUrl });
      }
    }

    if (!planned.length) continue;

    // Apply replacements (global replace per URL string)
    for (const p of planned) {
      // Escape for RegExp
      const escaped = p.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(escaped, 'g');
      const beforeCount = (out.match(re) || []).length;
      if (beforeCount > 0) {
        out = out.replace(re, p.to);
        changed = true;
        totalReplacements += beforeCount;
      }
    }

    if (changed) {
      console.log(`${APPLY ? '[APPLY]' : '[DRY]'} ${filePath}`);
      for (const p of planned) console.log(`  - ${p.from}\n    -> ${p.to}`);

      if (APPLY) {
        // Backup once
        const backupPath = `${filePath}.bak`;
        if (!fs.existsSync(backupPath)) fs.writeFileSync(backupPath, original);
        fs.writeFileSync(filePath, out);
      }
    }
  }

  saveCache(cache);

  console.log(`\nDone. Total replacements: ${totalReplacements}`);
  if (notFound.length) {
    const reportPath = path.resolve(process.cwd(), 
'cloudinary_migration_not_found.json');
    fs.writeFileSync(reportPath, JSON.stringify(notFound, null, 2));
    console.log(`Unresolved URLs: ${notFound.length}`);
    console.log(`Report written: ${reportPath}`);
    console.log(
      `Common cause: WP resized filenames (e.g. -1024x1024) when only originals 
were uploaded. ` +
        `This script already tries stripping -WxH and -scaled; remaining misses 
likely were never uploaded.`
    );
  }
  if (!APPLY) {
    console.log(`\nDry-run only. Re-run with --apply to write changes.`);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
