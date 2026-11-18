import { defineConfig } from 'astro/config';

// 自定义域名部署时由 CI 注入：
//   SITE_URL=https://aragontarotastro.asia
//   PUBLIC_BASE_PATH=/
export default defineConfig({
  output: 'static',
  site: process.env.SITE_URL || 'http://localhost:4321',
  base: process.env.PUBLIC_BASE_PATH || '/',
});
