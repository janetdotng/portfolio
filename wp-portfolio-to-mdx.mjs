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
const items = parsed.rss.channel.item;

let count = 0;

function getCdata(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value.__cdata) return value.__cdata;
  return '';
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function yamlEscape(str = '') {
  return str.replace(/"/g, '\\"');
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

for (const item of items) {
  const postType = getCdata(item['wp:post_type']);
  if (postType !== 'eternel-portfolio') continue;

  const status = getCdata(item['wp:status']);
  if (status !== 'publish') continue;

  const title = getCdata(item.title);
  const slug = getCdata(item['wp:post_name']) || slugify(title);
  const publishDate = getCdata(item['wp:post_date']).split(' ')[0];
  const content = getCdata(item['content:encoded']);

  const $ = load(content);

  // Remove HTML wrapper tags if present
  $('html').replaceWith(function () {
    return $(this).html();
  });
  $('body').replaceWith(function () {
    return $(this).html();
  });
  $('head').remove();

  // Remove all WP block comments
  $.root()
    .contents()
    .each(function () {
      if (this.type === 'comment') {
        $(this).remove();
      }
    });

  // Extract intro (first styled H5)
  let intro = '';
  const firstH5 = $('h5.wp-block-heading.has-medium-font-size').first();
  if (firstH5.length) {
    intro = firstH5.text().trim();
    firstH5.remove();
  }

  const client = extractField($, 'Client');
  const projectDate = extractField($, 'Project Date');

  // Remove sidebar meta section
  $('h5').each((_, el) => {
    const text = $(el).text().trim().toLowerCase();
    if (['client', 'project date', 'tags'].includes(text)) {
      $(el).parent().remove();
    }
  });

  // Remove empty images
  $('img').each((_, el) => {
    const src = $(el).attr('src');
    if (!src) {
      $(el).parent().remove();
    }
  });

  // Remove post navigation block
  $('[class*="post-navigation"]').remove();

  // Remove spacers
  $('.wp-block-spacer').remove();

  // Flatten WP column wrappers
  $('.wp-block-columns').each((_, el) => {
    $(el).replaceWith($(el).html());
  });

  $('.wp-block-column').each((_, el) => {
    $(el).replaceWith($(el).html());
  });

  // Extract categories + tags
  let category = [];
  let tags = [];

  const categories = item.category
    ? Array.isArray(item.category)
      ? item.category
      : [item.category]
    : [];

  for (const cat of categories) {
    const domain = cat['@_domain'];
    const nicename = cat['@_nicename'];

    if (!nicename) continue;

    if (domain === 'eternel-portfolio-category') {
      category.push(nicename.replace(/-/g, '').toLowerCase());
    }

    if (domain === 'eternel-portfolio-tag') {
      tags.push(nicename.toLowerCase());
    }
  }

  const bodyHtml = $.html().trim();

  const mdx = `---
title: "${yamlEscape(title)}"
description: "${yamlEscape(title)}"
publishDate: ${publishDate}
slug: "${slug}"

intro: "${yamlEscape(intro)}"

client: "${yamlEscape(client)}"
projectDate: "${yamlEscape(projectDate)}"

category: ${JSON.stringify(category)}
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