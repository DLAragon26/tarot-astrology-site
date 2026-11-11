// Cloudflare Worker 环境绑定。敏感值一律通过 Cloudflare Secrets / .dev.vars 注入，绝不写入仓库。

export interface Env {
  DB: D1Database;
  // AI（OpenAI-compatible）
  API_BASE_URL: string;
  API_KEY: string; // Cloudflare Secret
  MODEL_NAME: string;
  MAX_TOKENS?: string;
  TEMPERATURE?: string;
  // 站点
  SITE_ACCESS_KEY: string; // Cloudflare Secret
  SESSION_SECRET: string; // Cloudflare Secret
  ADMIN_INITIAL_PASSWORD: string; // Cloudflare Secret，仅用于首次引导创建 admin
  GLOBAL_DAILY_AI_LIMIT?: string;
  ALLOWED_ORIGINS?: string; // 逗号分隔白名单
  COOKIE_SECURE?: string; // 默认 "true"；仅本地 http 调试可设 "false"
}
