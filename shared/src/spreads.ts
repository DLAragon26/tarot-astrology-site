import type { Spread, SpreadId } from './types';

// MVP 固定三种牌阵，前端与后端共用同一份定义。

export const SPREADS: Record<SpreadId, Spread> = {
  single: {
    id: 'single',
    nameZh: '单张牌',
    descriptionZh: '一张牌，聚焦当下最直接的信息。',
    positions: [{ index: 0, key: 'focus', labelZh: '核心信息' }],
  },
  'three-card': {
    id: 'three-card',
    nameZh: '时间之流（三张）',
    descriptionZh: '过去 / 现在 / 未来，看清事情的走向。',
    positions: [
      { index: 0, key: 'past', labelZh: '过去' },
      { index: 1, key: 'present', labelZh: '现在' },
      { index: 2, key: 'future', labelZh: '未来' },
    ],
  },
  'five-question': {
    id: 'five-question',
    nameZh: '问题透视（五张）',
    descriptionZh: '从现状到方向，逐层拆解一个问题。',
    positions: [
      { index: 0, key: 'current', labelZh: '现状' },
      { index: 1, key: 'obstacle', labelZh: '障碍或压力' },
      { index: 2, key: 'subconscious', labelZh: '潜意识或隐藏因素' },
      { index: 3, key: 'advice', labelZh: '建议行动' },
      { index: 4, key: 'direction', labelZh: '可能发展方向' },
    ],
  },
};

export const SPREAD_IDS = Object.keys(SPREADS) as SpreadId[];

export function getSpread(id: string): Spread | null {
  return (SPREAD_IDS as string[]).includes(id) ? SPREADS[id as SpreadId] : null;
}

export function listSpreads(): Spread[] {
  return SPREAD_IDS.map((id) => SPREADS[id]);
}
