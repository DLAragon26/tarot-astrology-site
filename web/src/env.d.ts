/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** Astro 注入的站点基础路径（GitHub Pages 部署时为 /<repo>/） */
  readonly BASE_URL: string;
  /** Worker API 地址（公开值，非密钥） */
  readonly PUBLIC_API_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
