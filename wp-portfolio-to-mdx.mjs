import fs from 'fs';
import path from 'path';
import { XMLParser } from 'fast-xml-parser';
import { load } from 'cheerio';

const xmlPath = process.argv[2];
const outputDir = process.argv[3];

if (!xmlPath || !outputDir) {
  console.error('Usage: node wp-portfolio-to-mdx.mjs "<xml>" "<outputDir>"');
  process.exit(1);
}

const xmlData = fs.readFileSync(xmlPath, 'utf-8');

const parser = new XMLParser({
  ignoreAttributes: false,
  cdataPropName: '__cdata',
});

const parsed = parser.parse(xmlData);
const items = parsed?.rss?.channel?.item ?? [];

let count = 0;

function stripWpBlockCommentsRaw(html = '') {
  return html
    // <!-- wp:something {...} -->
    .replace(/<!--\s*wp:[\s\S]*?-->/g, '')
    // <!-- /wp:something -->
    .replace(/<!--\s*\/wp:[\s\S]*?-->/g, '');
}

function getCdata(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value.__cdata) return value.__cdata;
  return '';
}

function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function yamlEscape(str = '') {
  return String(str).replace(/"/g, '\\"');
}

function selfCloseVoidTags(html = '') {
  const voidTags = [
    'img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'track',
    'area', 'base', 'col', 'embed', 'param', 'wbr'
  ];

  for (const tag of voidTags) {
    // Replace: <tag ...>  → <tag ... />
    // Skip if already self-closed: <tag ... />
    const re = new RegExp(`<${tag}\\b([^>]*?)>`, 'gi');
    html = html.replace(re, (match, attrs) => {
      return /\/\s*>$/.test(match) ? match : `<${tag}${attrs} />`;
    });
  }

  return html;
}

/**
 * Normalise to ISO date "YYYY-MM-DD" for z.coerce.date().
 */
function toIsoDateString(wpDateTime) {
  const raw = String(wpDateTime || '').trim();
  if (!raw) return '';

  const m1 = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`;

  const m2 = raw.match(/^(\d{4})-(\d{2})-(\d{2})\s+\d{2}:\d{2}:\d{2}$/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;

  const d = new Date(raw);
  if (!Number.isNaN(d.valueOf())) {
    const yyyy = String(d.getUTCFullYear()).padStart(4, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  const head = raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(head)) return head;

  return '';
}

function extractField($, label) {
  let result = '';
  $('h5').each((_, el) => {
    const text = $(el).text().trim().toLowerCase();
    if (text === label.toLowerCase()) {
      result = $(el).next('p').text().trim();
    }
  });
  return result;
}

/**
 * Convert HTML comment nodes into MDX-safe JSX comments.
 * Output format is: "{/" + "* ... *" + "/}" (avoids writing the closing token in this JS comment).
 * WP block comments like "wp:..." are removed.
 */
function convertHtmlCommentsToMdx($) {
  const isWpBlockComment = (t) => {
    const s = String(t || '').trim().toLowerCase();
    return s.startsWith('wp:') || s.startsWith('/wp:') || s.startsWith('wp ');
  };

  const toMdxComment = (t) => {
    // Avoid prematurely closing the JSX comment and avoid accidental JSX interpolation.
    const safe = String(t || '')
      .replace(/\*\//g, '*\\/') // prevent closing the JSX comment
      .replace(/{/g, '&#123;')
      .replace(/}/g, '&#125;');
    return `{/* ${safe} */}`;
  };

  const walk = (node) => {
    if (!node) return;
    const children = node.children || [];
    for (const child of children) {
      if (child.type === 'comment') {
        const text = child.data ?? '';
        if (isWpBlockComment(text)) {
          $(child).remove();
        } else {
          $(child).replaceWith(toMdxComment(text));
        }
      } else {
        walk(child);
      }
    }
  };

  walk($.root().get(0));
}

for (const item of items) {
  const postType = getCdata(item['wp:post_type']);
  if (postType !== 'eternel-portfolio') continue;

  const status = getCdata(item['wp:status']);
  if (status !== 'publish') continue;

  const title = getCdata(item.title);
  const slug = getCdata(item['wp:post_name']) || slugify(title);

  const wpPostDate = getCdata(item['wp:post_date']) || getCdata(item['wp:post_date_gmt']);
  const publishDateIso = toIsoDateString(wpPostDate);
  if (!publishDateIso) {
    console.warn(`Skipping "${title}" (slug: ${slug}) because publishDate is missing/unparseable: "${wpPostDate}"`);
    continue;
  }

  const content = stripWpBlockCommentsRaw(getCdata(item['content:encoded']));
const $ = load(content, { decodeEntities: false });

 // Remove HTML wrapper tags if present
$('html').replaceWith(function () { return $(this).html(); });
$('body').replaceWith(function () { return $(this).html(); });
$('head').remove();

// Convert/remove comments everywhere (inline too)
convertHtmlCommentsToMdx($);

  // Extract intro (first styled H5)
  let intro = '';
  const firstH5 = $('h5.wp-block-heading.has-medium-font-size').first();
  if (firstH5.length) {
    intro = firstH5.text().trim();
    firstH5.remove();
  }

  const client = extractField($, 'Client');
  const projectDate = extractField($, 'Project Date');

  // Remove sidebar meta section blocks (common pattern in your WP export)
  $('h5').each((_, el) => {
    const text = $(el).text().trim().toLowerCase();
    if (['client', 'project date', 'tags'].includes(text)) {
      $(el).parent().remove();
    }
  });

  // Remove empty images (no src)
  $('img').each((_, el) => {
    const src = $(el).attr('src');
    if (!src) $(el).parent().remove();
  });

  // Remove post navigation blocks
  $('[class*="post-navigation"]').remove();

  // Remove spacers
  $('.wp-block-spacer').remove();

  // Flatten WP columns
  $('.wp-block-columns').each((_, el) => $(el).replaceWith($(el).html()));
  $('.wp-block-column').each((_, el) => $(el).replaceWith($(el).html()));

  // Extract categories + tags from WP export taxonomy
  const category = [];
  const tags = [];

  const rawCats = item.category
    ? Array.isArray(item.category) ? item.category : [item.category]
    : [];

  for (const cat of rawCats) {
    // Sometimes parser yields strings; skip those
    if (!cat || typeof cat !== 'object') continue;

    const domain = cat['@_domain'];
    const nicename = cat['@_nicename'];
    if (!nicename) continue;

    if (domain === 'eternel-portfolio-category') {
      category.push(String(nicename).toLowerCase()); // keep hyphens if any
    }
    if (domain === 'eternel-portfolio-tag') {
      tags.push(String(nicename).toLowerCase());
    }
  }

  // Ensure schema-required fields always exist
  // You can later replace these with real extracted cover/category when you have rules.
  const cover = ''; // placeholder; avoids schema failures if required
  const coverAlt = title || 'cover';
  const tag = tags?.[0] ?? '';

  const bodyHtml = selfCloseVoidTags($.html().trim());

  const mdx = `---
title: "${yamlEscape(title)}"
description: "${yamlEscape(title)}"
publishDate: "${publishDateIso}"
slug: "${slug}"

intro: "${yamlEscape(intro)}"

client: "${yamlEscape(client)}"
projectDate: "${yamlEscape(projectDate)}"

cover: "${yamlEscape(cover)}"
coverAlt: "${yamlEscape(coverAlt)}"
category: ${JSON.stringify(category)}
tag: "${yamlEscape(tag)}"
tags: ${JSON.stringify(tags)}
---

${bodyHtml}
`;

  const folder = path.join(outputDir, slug);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'index.mdx'), mdx);

  count++;
}

console.log(`Done. Wrote ${count} MDX files.`);