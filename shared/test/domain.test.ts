import { describe, expect, it } from 'vitest';
import { ALL_CARDS, cardCount, getCard, isCardId } from '../src/cards';
import { SPREAD_IDS, getSpread, listSpreads } from '../src/spreads';
import {
  validateCards,
  validateMoodTag,
  validatePassword,
  validateQuestion,
  validateTopicTag,
  validateUsername,
  parseDrawnCardsJson,
} from '../src/validate';
import { shanghaiDate, nextShanghaiMidnightISO } from '../src/shanghai-date';
import { ZODIAC_SIGNS, getZodiac } from '../src/zodiac';

describe('卡牌数据完整性', () => {
  it('共 78 张，ID 唯一', () => {
    expect(cardCount()).toBe(78);
    const ids = ALL_CARDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(78);
  });

  it('大阿卡纳 22 张 + 每花色 14 张', () => {
    expect(ALL_CARDS.filter((c) => c.arcana === 'major')).toHaveLength(22);
    for (const suit of ['wands', 'cups', 'swords', 'pentacles']) {
      expect(ALL_CARDS.filter((c) => c.suit === suit), suit).toHaveLength(14);
    }
  });

  it('每张牌都有中英文名、正逆位牌义与一致的图片路径', () => {
    for (const c of ALL_CARDS) {
      expect(c.nameZh.length, c.id).toBeGreaterThan(0);
      expect(c.name.length, c.id).toBeGreaterThan(0);
      expect(c.upright.length, c.id).toBeGreaterThan(4);
      expect(c.reversed.length, c.id).toBeGreaterThan(4);
      expect(c.image, c.id).toBe(`cards/${c.id}.webp`);
      expect(c.keywords.length, c.id).toBeGreaterThan(0);
    }
  });

  it('宫廷牌编号 11-14；Ace 编号为 1', () => {
    const wands = ALL_CARDS.filter((c) => c.suit === 'wands').map((c) => c.number);
    expect(wands).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    const king = getCard('rw-14-king-wands');
    expect(king?.nameZh).toBe('权杖国王');
  });

  it('isCardId 精确匹配', () => {
    expect(isCardId('rw-00-fool')).toBe(true);
    expect(isCardId('rw-99-fake')).toBe(false);
    expect(getCard('rw-99-fake')).toBeNull();
  });
});

describe('牌阵定义', () => {
  it('固定三种牌阵，位置数分别为 1/3/5', () => {
    expect(SPREAD_IDS).toEqual(['single', 'three-card', 'five-question']);
    expect(getSpread('single')?.positions).toHaveLength(1);
    expect(getSpread('three-card')?.positions.map((p) => p.key)).toEqual(['past', 'present', 'future']);
    expect(getSpread('five-question')?.positions.map((p) => p.key)).toEqual([
      'current',
      'obstacle',
      'subconscious',
      'advice',
      'direction',
    ]);
  });

  it('未知牌阵返回 null；listSpreads 与 SPREAD_IDS 一致', () => {
    expect(getSpread('celtic-cross')).toBeNull();
    expect(listSpreads()).toHaveLength(3);
  });
});

describe('输入校验', () => {
  const cards3 = [
    { position: 'past', card: 'rw-00-fool', orientation: 'upright' },
    { position: 'present', card: 'rw-10-wheel-of-fortune', orientation: 'reversed' },
    { position: 'future', card: 'rw-19-sun', orientation: 'upright' },
  ];

  it('合法牌面通过', () => {
    const r = validateCards('three-card', cards3);
    expect(r.ok).toBe(true);
  });

  it('张数不符/位置不符/非法牌名/非法正逆位被拒', () => {
    expect(validateCards('three-card', cards3.slice(0, 2)).ok).toBe(false);
    expect(
      validateCards('three-card', [{ ...cards3[0], position: 'future' }, cards3[1], cards3[2]]).ok
    ).toBe(false);
    expect(validateCards('three-card', [{ ...cards3[0], card: 'rw-99-fake' }, cards3[1], cards3[2]]).ok).toBe(false);
    expect(
      validateCards('three-card', [{ ...cards3[0], orientation: 'sideways' }, cards3[1], cards3[2]]).ok
    ).toBe(false);
    expect(validateCards('no-such-spread', cards3).ok).toBe(false);
    expect(validateCards('three-card', 'not-an-array').ok).toBe(false);
  });

  it('问题与账号字段边界', () => {
    expect(validateQuestion('最近的工作状态如何？')).toBe('最近的工作状态如何？');
    expect(validateQuestion('   ')).toBeNull();
    expect(validateQuestion('x'.repeat(501))).toBeNull();
    expect(validateUsername('alice_01')).toBe('alice_01');
    expect(validateUsername('ab')).toBeNull();
    expect(validateUsername('bad name!')).toBeNull();
    expect(validatePassword('longenough1')).toBe('longenough1');
    expect(validatePassword('short')).toBeNull();
  });

  it('标签必须在预设列表内', () => {
    expect(validateTopicTag('事业')).toBe('事业');
    expect(validateTopicTag('随便写的')).toBeNull();
    expect(validateMoodTag('焦虑')).toBe('焦虑');
    expect(validateMoodTag(undefined)).toBeNull();
  });

  it('parseDrawnCardsJson 容错', () => {
    expect(parseDrawnCardsJson(JSON.stringify(cards3))).toHaveLength(3);
    expect(parseDrawnCardsJson('not json')).toBeNull();
    expect(parseDrawnCardsJson('{}')).toBeNull();
  });
});

describe('Asia/Shanghai 日期', () => {
  it('UTC 16:30 属于上海次日', () => {
    expect(shanghaiDate(new Date('2026-01-01T15:59:59Z'))).toBe('2026-01-01');
    expect(shanghaiDate(new Date('2026-01-01T16:00:00Z'))).toBe('2026-01-02');
    expect(shanghaiDate(new Date('2026-06-30T20:00:00Z'))).toBe('2026-07-01');
  });

  it('重置时刻为下一次上海午夜', () => {
    // 2026-03-10T12:00:00Z = 上海 3/10 20:00，下一午夜为上海 3/11 00:00 = 2026-03-10T16:00:00Z
    const iso = nextShanghaiMidnightISO(new Date('2026-03-10T12:00:00Z'));
    expect(iso).toBe('2026-03-10T16:00:00.000Z');
    // 上海 3/10 23:30（UTC 15:30）→ 同日 24:00 = 3/10T16:00Z
    expect(nextShanghaiMidnightISO(new Date('2026-03-10T15:30:00Z'))).toBe('2026-03-10T16:00:00.000Z');
    // 上海 3/11 00:30（UTC 3/10 16:30）→ 下一午夜为 3/12 00:00 上海 = 3/11T16:00Z
    expect(nextShanghaiMidnightISO(new Date('2026-03-10T16:30:00Z'))).toBe('2026-03-11T16:00:00.000Z');
  });
});

describe('星座数据', () => {
  it('12 星座、key 唯一、内容完整', () => {
    expect(ZODIAC_SIGNS).toHaveLength(12);
    expect(new Set(ZODIAC_SIGNS.map((z) => z.key)).size).toBe(12);
    for (const z of ZODIAC_SIGNS) {
      expect(z.nameZh).toBeTruthy();
      expect(z.dateRangeZh).toContain('月');
      expect(z.elementZh).toContain('象');
      expect(z.rulerZh).toBeTruthy();
      expect(z.traitsZh.length).toBeGreaterThan(10);
      expect(z.reflectionZh.length).toBeGreaterThan(0);
    }
  });

  it('getZodiac 查询', () => {
    expect(getZodiac('leo')?.nameZh).toBe('狮子座');
    expect(getZodiac('nope')).toBeNull();
  });
});
