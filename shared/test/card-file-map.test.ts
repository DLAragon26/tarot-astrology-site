import { describe, expect, it } from 'vitest';
import { expectedCardTitles, mapCommonsTitleToCardId } from '../../scripts/card-file-map.mjs';

describe('Commons 牌图文件名映射', () => {
  it('生成 78 个唯一稳定 ID 和当前 Commons 标题', () => {
    const cards = expectedCardTitles();
    expect(cards).toHaveLength(78);
    expect(new Set(cards.map((card) => card.id)).size).toBe(78);
    expect(new Set(cards.map((card) => card.title)).size).toBe(78);
    for (const card of cards) {
      expect(mapCommonsTitleToCardId(card.title), card.title).toBe(card.id);
    }
  });

  it('兼容当前 PNG 和旧版 JPG 命名', () => {
    expect(mapCommonsTitleToCardId('File:RWS Tarot 1910 - 00 The Fool.png')).toBe('rw-00-fool');
    expect(mapCommonsTitleToCardId('File:RWS Tarot 1910 - Cups 01 (Ace).png')).toBe('rw-01-ace-cups');
    expect(mapCommonsTitleToCardId('File:00 Fool.png')).toBe('rw-00-fool');
    expect(mapCommonsTitleToCardId('RWS_Tarot_12_Wands.jpg')).toBe('rw-12-knight-wands');
    expect(mapCommonsTitleToCardId('File:unrelated.jpg')).toBeNull();
  });
});
