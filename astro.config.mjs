// @ts-check
import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';

// Deployed to GitHub Pages via .github/workflows/deploy.yml
// The site lives at https://shubhamtatvamasi.com/synthline/
//
// IMPORTANT: `base` must match the final URL path of the site.
// If you rename the GitHub repository (e.g. to `race`), update base to '/race'
// so that assets resolve correctly on GitHub Pages.
export default defineConfig({
  site: 'https://shubhamtatvamasi.com',
  base: '/synthline',
  integrations: [svelte()],
});
