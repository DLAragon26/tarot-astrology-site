-- 0004_atomic_quota_tokens_login_attempts.sql
-- 1) 全站每日额度改为独立计数表：配合带 guard 的原子自增，消除「先查后加」的并发超发。
--    历史数据按日汇总回填（只有当天有意义，其余日期只为统计完整）。
-- 2) ai_usage 增加 token 用量两列（DeepSeek/OpenAI-compatible usage 字段，成功后累加）。
-- 3) 新增 login_attempts：登录/兑换失败计数与临时锁定（C2 登录限流）。

CREATE TABLE IF NOT EXISTS global_ai_usage (
  usage_date TEXT PRIMARY KEY,          -- Asia/Shanghai 日期 YYYY-MM-DD
  count INTEGER NOT NULL DEFAULT 0
);

INSERT INTO global_ai_usage (usage_date, count)
SELECT usage_date, SUM(count)
FROM ai_usage
GROUP BY usage_date
ON CONFLICT (usage_date) DO NOTHING;

ALTER TABLE ai_usage ADD COLUMN prompt_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_usage ADD COLUMN completion_tokens INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS login_attempts (
  attempt_key TEXT PRIMARY KEY,         -- SHA-256(ip|username)，原文不落库
  fail_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  updated_at TEXT NOT NULL
);
