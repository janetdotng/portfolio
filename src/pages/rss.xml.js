import rss from "@astrojs/rss";
import { getCollection } from "astro:content";

export async function GET(context) {
  const blog = await getCollection('showcase');
  return rss({
    title: 'Ricocc Blog Template Astro',
    description: 'Astro Blog Template by Ricocc',
    site: context.site,
    items: blog.map((post) => ({
      title: post.data.title,
      pubDate: post.data.pubDate,
      description: post.data.description,
      // ...post.data,
      link: `/blog/${post.slug}/`,
      stylesheet: '/rss/pretty-feed-v3.xsl',
    })),
  });
}