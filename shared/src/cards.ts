import { MAJOR_CARDS } from './cards-major';
import { MINOR_CARDS } from './cards-minor';
import type { TarotCard } from './types';

// 78 张 Rider-Waite 全集与查询工具。

export const ALL_CARDS: TarotCard[] = [...MAJOR_CARDS, ...MINOR_CARDS];

const CARD_BY_ID = new Map<string, TarotCard>(ALL_CARDS.map((c) => [c.id, c]));

export function getCard(id: string): TarotCard | null {
  return CARD_BY_ID.get(id) ?? null;
}

export function isCardId(id: string): boolean {
  return CARD_BY_ID.has(id);
}

export function cardCount(): number {
  return ALL_CARDS.length;
}
