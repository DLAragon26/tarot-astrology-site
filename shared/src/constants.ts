// 全局常量：额度、session、标签。仅此一处定义，前后端共用。

export const DEFAULT_DAILY_AI_LIMIT = 20;
export const FALLBACK_GLOBAL_DAILY_AI_LIMIT = 200;
export const SESSION_TTL_SECONDS = 7 * 24 * 3600; // 7 天
export const SESSION_COOKIE_NAME = 'tq_session';
export const SHANGHAI_TZ = 'Asia/Shanghai';

export const QUESTION_MAX_LEN = 500;
export const NOTE_MAX_LEN = 2000;
export const USERNAME_MAX_LEN = 32;
export const PASSWORD_MIN_LEN = 8;
export const TAG_MAX_LEN = 12;

export const TOPIC_TAGS = ['事业', '感情', '学业', '财务', '健康', '自我成长', '人际', '其他'] as const;
export const MOOD_TAGS = ['平静', '焦虑', '期待', '迷茫', '低落', '兴奋', '中立'] as const;

export const ERR = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_ADMIN: 'NOT_ADMIN',
  NOT_OWNER: 'NOT_OWNER',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION: 'VALIDATION',
  QUOTA_USER: 'QUOTA_USER_EXCEEDED',
  QUOTA_GLOBAL: 'QUOTA_GLOBAL_EXCEEDED',
  AI_UPSTREAM: 'AI_UPSTREAM_ERROR',
  CONFLICT: 'CONFLICT',
  SITE_KEY: 'SITE_KEY_INVALID',
} as const;

export type ErrCode = (typeof ERR)[keyof typeof ERR];
