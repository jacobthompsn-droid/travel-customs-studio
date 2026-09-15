// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import keystatic from '@keystatic/astro';

// Keystatic (and the React runtime it needs) load ONLY in `astro dev`.
// Keystatic injects server routes, which would break the pure-static
// production build — the live site must never include it or an adapter.
const runningDev = process.argv.includes('dev');

export default defineConfig({
  site: 'https://thetravelcustoms.com',
  output: 'static',
  // TC_BUILD_OUT: set by Studio's publish gate to a folder OUTSIDE OneDrive —
  // OneDrive sync locks files in dist/ and randomly breaks builds (EPERM).
  // Unset everywhere else (Cloudflare, plain `npm run build`) → normal ./dist.
  outDir: process.env.TC_BUILD_OUT || './dist',
  integrations: [sitemap(), mdx(), ...(runningDev ? [react(), keystatic()] : [])],
});
