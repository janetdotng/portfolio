import { defineCollection, z } from 'astro:content';

const showcase = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    publishDate: z.coerce.date(),
    read: z.number().optional(),

    cover: z.string(),
    coverAlt: z.string().optional(),

    category: z.array(z.string()),
    tags: z.array(z.string()).optional(),

    tag: z.string().optional(),
    featured: z.boolean().optional(),
    externalUrl: z.string().optional()
  }),
});

export const collections = { showcase };