// Keystatic editor schema — what Jacob sees in the Studio editor.
// ⚠️ PAIRED FILE: src/content.config.ts (Astro's schema) must always describe
// the same fields as this file. If you change one, change the other.
import { config, collection, singleton, fields } from '@keystatic/core';

export default config({
  storage: { kind: 'local' },
  ui: {
    brand: { name: 'Travel Customs Studio' },
  },
  collections: {
    posts: collection({
      label: 'Posts',
      slugField: 'title',
      path: 'src/content/posts/*/',
      entryLayout: 'content',
      format: { contentField: 'content' },
      schema: {
        title: fields.slug({
          name: { label: 'Title', validation: { isRequired: true } },
          slug: {
            label: 'URL slug',
            description: 'Set once when the post is created — changing it later breaks links.',
          },
        }),
        description: fields.text({
          label: 'Description',
          description: 'One or two sentences shown on post cards and in Google results.',
          multiline: true,
          validation: { isRequired: true },
        }),
        publishDate: fields.date({
          label: 'Publish date',
          defaultValue: { kind: 'today' },
          validation: { isRequired: true },
        }),
        category: fields.relationship({
          label: 'Category',
          collection: 'categories',
          validation: { isRequired: true },
        }),
        // No directory/publicPath: Keystatic's default stores the image inside
        // the post's own folder and writes a bare filename (e.g. heroImage.jpg),
        // which Astro resolves relative to index.md — verified by build.
        // ⚠️ Do NOT set publicPath './' here: written values come out as
        // ./<slug>/<file> (doubled folder from inside the post dir) and the
        // build breaks. This crashed the site on 2026-07-05.
        heroImage: fields.image({
          label: 'Hero image',
          validation: { isRequired: true },
        }),
        heroAlt: fields.text({
          label: 'Hero image description (alt text)',
          description: 'Describe the photo for screen readers and search engines.',
          validation: { isRequired: true },
        }),
        draft: fields.checkbox({
          label: 'Draft',
          description: 'Drafts are never published to the live site.',
          defaultValue: false,
        }),
        quickFacts: fields.object(
          {
            budget: fields.text({ label: 'Budget (e.g. "$1,000–1,200 for 4")' }),
            duration: fields.text({ label: 'Duration (e.g. "5 days")' }),
            season: fields.text({ label: 'Best season' }),
            whoFor: fields.text({ label: 'Good for (e.g. "Families with kids 4+")' }),
          },
          {
            label: 'Trip at a glance (optional)',
            description: 'Leave blank to hide the box on this post.',
          },
        ),
        // Inline pictures: directory + '../' publicPath makes Keystatic store
        // each pasted image in the post's own folder and write a reference
        // like ../<slug>/photo.png, which resolves correctly from index.md.
        // ⚠️ The DEFAULT (no options) is broken for our layout: it saves the
        // file into a content/ subfolder but references it as if it were next
        // to index.md → missing image → build failure (bug found 2026-07-05).
        content: fields.mdx({
          extension: 'md',
          label: 'Content',
          options: {
            image: { directory: 'src/content/posts', publicPath: '../' },
          },
        }),
      },
    }),
    categories: collection({
      label: 'Categories',
      slugField: 'name',
      path: 'src/content/categories/*',
      format: { data: 'yaml' },
      schema: {
        name: fields.slug({
          name: { label: 'Name', validation: { isRequired: true } },
          slug: {
            label: 'URL slug',
            description:
              'Set once when the category is created — changing it later breaks links to its page.',
          },
        }),
        description: fields.text({
          label: 'Description',
          description: 'Shown at the top of this category’s page.',
          multiline: true,
          validation: { isRequired: true },
        }),
      },
    }),
  },
  singletons: {
    site: singleton({
      label: 'Site settings',
      path: 'src/data/site',
      format: { data: 'json' },
      schema: {
        tagline: fields.text({
          label: 'Tagline',
          description: 'Shown under the site title on the homepage and in the footer.',
          validation: { isRequired: true },
        }),
        authorName: fields.text({ label: 'Author name', validation: { isRequired: true } }),
        authorBio: fields.text({
          label: 'Author bio',
          description: 'The short "Written by…" blurb at the end of every post.',
          multiline: true,
          validation: { isRequired: true },
        }),
      },
    }),
    about: singleton({
      label: 'About page',
      path: 'src/content/pages/about',
      format: { contentField: 'content' },
      entryLayout: 'content',
      schema: {
        title: fields.text({ label: 'Page title', validation: { isRequired: true } }),
        description: fields.text({
          label: 'Description',
          description: 'One or two sentences for Google results.',
          multiline: true,
          validation: { isRequired: true },
        }),
        content: fields.mdx({ extension: 'md', label: 'Content' }),
      },
    }),
  },
});
