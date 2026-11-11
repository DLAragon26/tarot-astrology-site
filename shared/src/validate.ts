import { isCardId } from './cards';
import {
  MOOD_TAGS,
  NOTE_MAX_LEN,
  PASSWORD_MIN_LEN,
  QUESTION_MAX_LEN,
  TAG_MAX_LEN,
  TOPIC_TAGS,
  USERNAME_MAX_LEN,
} from './constants';
import { getSpread } from './spreads';
import type { DrawnCard, Orientation, ReadingMode, SpreadId } from './types';

// 输入校验：后端在调用任何写操作与 AI 之前必须执行；前端仅用于即时提示。

export function isOrientation(v: unknown): v is Orientation {
  return v === 'upright' || v === 'reversed';
}

export function isReadingMode(v: unknown): v is ReadingMode {
  return v === 'online' || v === 'offline';
}

export function isSpreadId(v: unknown): v is SpreadId {
  return typeof v === 'string' && getSpread(v) !== null;
}

export interface ValidatedCards {
  ok: true;
  cards: DrawnCard[];
}
export interface InvalidCards {
  ok: false;
  reason: string;
}

/** 校验牌面数组与牌阵位置完全匹配、牌名存在、正逆位合法 */
export function validateCards(spreadId: string, raw: unknown): ValidatedCards | InvalidCards {
  const spread = getSpread(spreadId);
  if (!spread) return { ok: false, reason: `未知牌阵: ${String(spreadId)}` };
  if (!Array.isArray(raw)) return { ok: false, reason: 'cards 必须是数组' };
  if (raw.length !== spread.positions.length) {
    return { ok: false, reason: `${spread.nameZh} 需要 ${spread.positions.length} 张牌，收到 ${raw.length} 张` };
  }
  const cards: DrawnCard[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i] as Record<string, unknown> | null;
    if (!item || typeof item !== 'object') return { ok: false, reason: `第 ${i + 1} 张牌格式错误` };
    const expected = spread.positions[i];
    if (item.position !== expected.key) {
      return { ok: false, reason: `第 ${i + 1} 张牌的位置应为 ${expected.labelZh}(${expected.key})` };
    }
    if (typeof item.card !== 'string' || !isCardId(item.card)) {
      return { ok: false, reason: `第 ${i + 1} 张牌的牌名不合法: ${String(item.card)}` };
    }
    if (!isOrientation(item.orientation)) {
      return { ok: false, reason: `第 ${i + 1} 张牌的正逆位不合法` };
    }
    cards.push({ position: item.position, card: item.card, orientation: item.orientation });
  }
  return { ok: true, cards };
}

export function validateQuestion(q: unknown): string | null {
  if (typeof q !== 'string') return null;
  const t = q.trim();
  if (t.length === 0 || t.length > QUESTION_MAX_LEN) return null;
  return t;
}

export function validateOptionalText(v: unknown, maxLen = NOTE_MAX_LEN): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (t.length === 0) return null;
  return t.slice(0, maxLen);
}

export function validateTag(v: unknown, allowed: readonly string[]): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (t.length === 0) return null;
  if (t.length > TAG_MAX_LEN) return null;
  if (!allowed.includes(t)) return null;
  return t;
}

export function validateTopicTag(v: unknown): string | null {
  return validateTag(v, TOPIC_TAGS);
}

export function validateMoodTag(v: unknown): string | null {
  return validateTag(v, MOOD_TAGS);
}

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;

export function validateUsername(u: unknown): string | null {
  if (typeof u !== 'string') return null;
  const t = u.trim();
  return USERNAME_RE.test(t) && t.length <= USERNAME_MAX_LEN ? t : null;
}

export function validatePassword(p: unknown): string | null {
  if (typeof p !== 'string') return null;
  return p.length >= PASSWORD_MIN_LEN ? p : null;
}

/** 读取/写库时把 cards JSON 解析为 DrawnCard[]（不抛错） */
export function parseDrawnCardsJson(json: string): DrawnCard[] | null {
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return null;
    return arr.filter((c) => {
      return (
        c && typeof c === 'object' && typeof c.position === 'string' && typeof c.card === 'string' && isOrientation(c.orientation)
      );
    });
  } catch {
    return null;
  }
}
