import { defineCollection, z } from 'astro:content';

const showcase = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    publishDate: z.coerce.date(),
    read: z.number().optional(),

    cover: z.string(),                // required for grid
    category: z.array(z.string()),    // for filtering
    tag: z.string().optional(),       // UI label
    featured: z.boolean().optional(), // future use
    externalUrl: z.string().optional()
  }),
});

export const collections = {
  showcase
};