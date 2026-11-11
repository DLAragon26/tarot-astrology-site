import { defineConfig } from 'astro/config';

// GitHub Pages 部署时由 CI 注入：
//   SITE_URL=https://<username>.github.io
//   PUBLIC_BASE_PATH=/tarot-astrology-site
export default defineConfig({
  output: 'static',
  site: process.env.SITE_URL || 'http://localhost:4321',
  base: process.env.PUBLIC_BASE_PATH || '/',
});
