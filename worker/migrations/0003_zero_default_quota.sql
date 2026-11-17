-- 0003_zero_default_quota.sql — 未显式分配额度的用户统一从 0 开始。
-- 保留已经由管理员设置的正整数额度；管理员自身也不再享有无限 AI 额度。

UPDATE users SET daily_ai_limit = 0 WHERE daily_ai_limit IS NULL;
