-- 0002_invite_expiry.sql — 邀请码有效期与撤销能力
-- 新邀请码默认 7 天有效；旧邀请码在迁移时按创建时间补 7 天有效期。

ALTER TABLE invite_codes ADD COLUMN expires_at TEXT;

UPDATE invite_codes
SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+7 days')
WHERE expires_at IS NULL;
