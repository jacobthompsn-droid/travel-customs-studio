// Content collection schemas.
// ⚠️ PAIRED FILE: keystatic.config.ts (the editor schema) must always describe
// the same fields as this file. If you change one, change the other.
import { defineCollection, reference, z } from 'astro:content';
import { glob } from 'astro/loaders';

// One post = one folder under src/content/posts/<slug>/ containing index.md
// plus its images, colocated. The folder name is the post's slug/URL.
const posts = defineCollection({
  loader: glob({
    pattern: '**/index.md',
    base: './src/content/posts',
    generateId: ({ entry }) => entry.replace(/[\\/]index\.md$/, ''),
  }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      publishDate: z.coerce.date(),
      // Reference to the categories collection (data, not code). If a post
      // points at a category that no longer exists, the build fails — that's
      // the guardrail that keeps orphaned posts off the live site.
      category: reference('categories'),
      heroImage: image(),
      heroAlt: z.string(),
      draft: z.boolean().default(false),
      // Optional "Trip at a glance" quick facts. More travel modules
      // (itinerary, stay cards, budget table) get added in Phase 3.
      quickFacts: z
        .object({
          budget: z.string().optional(),
          duration: z.string().optional(),
          season: z.string().optional(),
          whoFor: z.string().optional(),
        })
        .optional(),
    }),
});

// Categories are user-managed data (edited in Studio), not code.
// One YAML file per category; the filename is the slug and drives the URL.
const categories = defineCollection({
  loader: glob({ pattern: '*.yaml', base: './src/content/categories' }),
  schema: z.object({
    name: z.string(),
    description: z.string(),
  }),
});

// Standalone editable pages (currently just About). The id strips both
// ".md" and "/index.md" so either file layout works.
const pages = defineCollection({
  loader: glob({
    pattern: '**/*.md',
    base: './src/content/pages',
    generateId: ({ entry }) => entry.replace(/\.md$/, '').replace(/[\\/]index$/, ''),
  }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
  }),
});

export const collections = { posts, categories, pages };
