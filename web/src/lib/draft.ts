import type { DrawnCard, InterpretationPayload, SpreadId } from '@tarot/shared';

// A6 抽牌草稿：localStorage 持久化，防止刷新/误退丢失牌面与解读。

export interface Draft {
  ts: number;
  question: string;
  topic: string | null;
  mood: string | null;
  spread: SpreadId | null;
  /** 已确认的牌面（线上抽牌 = 选出的牌；线下 = 确认过的排面） */
  cards: DrawnCard[];
  /** 线下录入：确认前各位置的暂选 */
  picked?: DrawnCard[];
  interpretation: InterpretationPayload | null;
  savedId: string | null;
}

export function saveDraft(key: string, draft: Draft): void {
  try {
    localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    /* 隐私模式/配额不足：忽略 */
  }
}

export function loadDraft(key: string): Draft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    if (!d || typeof d !== 'object' || !Array.isArray(d.cards)) return null;
    return d;
  } catch {
    return null;
  }
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** 有恢复价值的草稿：已抽牌且尚未保存 */
export function draftIsMeaningful(d: Draft | null): boolean {
  return !!d && d.cards.length > 0 && !d.savedId;
}

/** beforeunload 提醒（只在有未保存牌面时拦截） */
export function guardUnsaved(draftKey: string): void {
  window.addEventListener('beforeunload', (e) => {
    const d = loadDraft(draftKey);
    if (!draftIsMeaningful(d)) return;
    e.preventDefault();
    e.returnValue = '';
  });
}

export function fmtDraftTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
