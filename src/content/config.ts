import { defineCollection, z } from 'astro:content';

const showcase = defineCollection({
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    publishDate: z.coerce.date(),
    slug: z.string(),
    intro: z.string().optional(),
    client: z.string().optional(),
    projectDate: z.string().optional(),
    category: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    cover: z.string().optional(),
    media: z.array(
      z.object({
        type: z.string(),
        src: z.string(),
      })
    ).optional(),
  }),
});

export const collections = {
  showcase,
};