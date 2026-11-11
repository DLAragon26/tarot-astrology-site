import type { TarotCard } from './types';

// 大阿卡纳 22 张。Rider-Waite（1909，Pamela Colman Smith，公有领域）。
// 图片 ID 规则：rw-<NN>-<slug>，与 scripts/card-manifest.json 一致。

export const MAJOR_CARDS: TarotCard[] = [
  {
    id: 'rw-00-fool', name: 'The Fool', nameZh: '愚者', arcana: 'major', suit: null, number: 0,
    keywords: ['新开始', '自由', '冒险'], image: 'cards/rw-00-fool.webp',
    upright: '新的开始与可能性，带着信任踏出第一步；保持开放的探索心态。',
    reversed: '缺乏准备或方向，冲动行事；出发前需要停下来确认脚下是否踩实。',
  },
  {
    id: 'rw-01-magician', name: 'The Magician', nameZh: '魔术师', arcana: 'major', suit: null, number: 1,
    keywords: ['显化', '资源', '行动力'], image: 'cards/rw-01-magician.webp',
    upright: '具备所需的工具与能力，把想法落地的时刻；专注并主动发起。',
    reversed: '能力未被善用，或偏离本心；警惕自我怀疑与言行不一。',
  },
  {
    id: 'rw-02-high-priestess', name: 'The High Priestess', nameZh: '女祭司', arcana: 'major', suit: null, number: 2,
    keywords: ['直觉', '内在智慧', '静观'], image: 'cards/rw-02-high-priestess.webp',
    upright: '答案在内在，倾听直觉与尚未言说的部分；先静观再行动。',
    reversed: '与内在声音失联，或回避已有察觉的真相；给自己一点安静的时间。',
  },
  {
    id: 'rw-03-empress', name: 'The Empress', nameZh: '皇后', arcana: 'major', suit: null, number: 3,
    keywords: ['丰饶', '滋养', '感官'], image: 'cards/rw-03-empress.webp',
    upright: '创造力与滋养的能量，事物自然生长；照顾自己与身边的关系。',
    reversed: '过度付出或忽视自身需求；成长需要空间，而非不断加压。',
  },
  {
    id: 'rw-04-emperor', name: 'The Emperor', nameZh: '皇帝', arcana: 'major', suit: null, number: 4,
    keywords: ['秩序', '边界', '担当'], image: 'cards/rw-04-emperor.webp',
    upright: '建立结构与规则，以稳定和责任感推进事务。',
    reversed: '控制欲或僵硬的规则压住了弹性；权威也可能是逃避柔性沟通的方式。',
  },
  {
    id: 'rw-05-hierophant', name: 'The Hierophant', nameZh: '教皇', arcana: 'major', suit: null, number: 5,
    keywords: ['传统', '学习', '引导'], image: 'cards/rw-05-hierophant.webp',
    upright: '从传统、体系或导师处获得指引；遵循成熟路径有其价值。',
    reversed: '质疑既定教条，寻找属于自己的信念；不必被惯例绑架。',
  },
  {
    id: 'rw-06-lovers', name: 'The Lovers', nameZh: '恋人', arcana: 'major', suit: null, number: 6,
    keywords: ['结合', '选择', '价值观'], image: 'cards/rw-06-lovers.webp',
    upright: '深层的联结与吸引，基于共同价值观的结合；一次重要的选择。',
    reversed: '关系或选择中的失衡与犹疑；先校准自己的价值观再决定。',
  },
  {
    id: 'rw-07-chariot', name: 'The Chariot', nameZh: '战车', arcana: 'major', suit: null, number: 7,
    keywords: ['意志', '推进', '掌控'], image: 'cards/rw-07-chariot.webp',
    upright: '以明确的意志驱动局面，集中力量朝目标前进。',
    reversed: '方向感涣散，动力内耗；先统一目标再踩油门。',
  },
  {
    id: 'rw-08-strength', name: 'Strength', nameZh: '力量', arcana: 'major', suit: null, number: 8,
    keywords: ['内在力量', '温和', '驯服'], image: 'cards/rw-08-strength.webp',
    upright: '以温柔与耐心驾驭本能与恐惧，内在的韧性胜过蛮力。',
    reversed: '自我怀疑或情绪失控；力量此刻在于接纳而非压制。',
  },
  {
    id: 'rw-09-hermit', name: 'The Hermit', nameZh: '隐士', arcana: 'major', suit: null, number: 9,
    keywords: ['内省', '独处', '寻找'], image: 'cards/rw-09-hermit.webp',
    upright: '退一步向内看，独处带来清晰；答案需要安静才能浮现。',
    reversed: '过度孤立或拒绝他人的指引；内省之后记得回到人群。',
  },
  {
    id: 'rw-10-wheel-of-fortune', name: 'Wheel of Fortune', nameZh: '命运之轮', arcana: 'major', suit: null, number: 10,
    keywords: ['转折', '周期', '流动'], image: 'cards/rw-10-wheel-of-fortune.webp',
    upright: '局势出现周期性转折，顺势而为；变化本身是中性的。',
    reversed: '抗拒变化或感到被外力推着走；看清哪些在自己掌控之内。',
  },
  {
    id: 'rw-11-justice', name: 'Justice', nameZh: '正义', arcana: 'major', suit: null, number: 11,
    keywords: ['公正', '因果', '责任'], image: 'cards/rw-11-justice.webp',
    upright: '诚实地权衡与承担后果，事情趋向公平的解决。',
    reversed: '回避责任或偏颇的判断；诚实面对失衡的部分。',
  },
  {
    id: 'rw-12-hanged-man', name: 'The Hanged Man', nameZh: '倒吊人', arcana: 'major', suit: null, number: 12,
    keywords: ['换视角', '暂停', '沉淀'], image: 'cards/rw-12-hanged-man.webp',
    upright: '暂停与等待反而是进展；换个角度，意义会重新排列。',
    reversed: '无意义的拖延或为停滞寻找借口；该落地的决定就落地。',
  },
  {
    id: 'rw-13-death', name: 'Death', nameZh: '死神', arcana: 'major', suit: null, number: 13,
    keywords: ['结束', '转化', '重生'], image: 'cards/rw-13-death.webp',
    upright: '一个阶段自然结束，为新生腾出空间；放手是过程的一部分。',
    reversed: '抗拒必要的告别，拖着不结束；转变被延迟但不会消失。',
  },
  {
    id: 'rw-14-temperance', name: 'Temperance', nameZh: '节制', arcana: 'major', suit: null, number: 14,
    keywords: ['平衡', '调和', '耐心'], image: 'cards/rw-14-temperance.webp',
    upright: '不同元素之间的调和与中道，慢工出细活。',
    reversed: '失衡与极端，过与不及；找回自己的节奏。',
  },
  {
    id: 'rw-15-devil', name: 'The Devil', nameZh: '恶魔', arcana: 'major', suit: null, number: 15,
    keywords: ['束缚', '欲望', '觉察'], image: 'cards/rw-15-devil.webp',
    upright: '看见绑住自己的模式或依赖；锁链往往是自己戴上的。',
    reversed: '开始挣脱束缚，觉察带来松动的可能。',
  },
  {
    id: 'rw-16-tower', name: 'The Tower', nameZh: '高塔', arcana: 'major', suit: null, number: 16,
    keywords: ['骤变', '崩解', '真相'], image: 'cards/rw-16-tower.webp',
    upright: '意外的变化瓦解旧结构，暴露真实的基底；震荡之后是重建。',
    reversed: '危机被延迟或以较缓的方式到来；趁早主动拆掉隐患。',
  },
  {
    id: 'rw-17-star', name: 'The Star', nameZh: '星星', arcana: 'major', suit: null, number: 17,
    keywords: ['希望', '疗愈', '指引'], image: 'cards/rw-17-star.webp',
    upright: '风雨后的希望与平静，信念慢慢恢复；保持真实的期待。',
    reversed: '信心流失或理想化幻灭；允许自己被照顾一段时间。',
  },
  {
    id: 'rw-18-moon', name: 'The Moon', nameZh: '月亮', arcana: 'major', suit: null, number: 18,
    keywords: ['潜意识', '不安', '迷雾'], image: 'cards/rw-18-moon.webp',
    upright: '事实被情绪与想象笼罩，梦境与直觉信息丰富；不急于下定论。',
    reversed: '迷雾渐散，恐惧开始退潮；借一点光看清来路。',
  },
  {
    id: 'rw-19-sun', name: 'The Sun', nameZh: '太阳', arcana: 'major', suit: null, number: 19,
    keywords: ['喜悦', '活力', '清晰'], image: 'cards/rw-19-sun.webp',
    upright: '清晰、温暖与生命力，事情向着明亮处生长。',
    reversed: '暂时的阴霾或过度乐观；核心仍在，让光再进来一点。',
  },
  {
    id: 'rw-20-judgement', name: 'Judgement', nameZh: '审判', arcana: 'major', suit: null, number: 20,
    keywords: ['觉醒', '召唤', '复盘'], image: 'cards/rw-20-judgement.webp',
    upright: '对过往的复盘与觉醒，听到内在的召唤并回应它。',
    reversed: '自我苛责或逃避该做的决定；宽恕自己也是答案的一部分。',
  },
  {
    id: 'rw-21-world', name: 'The World', nameZh: '世界', arcana: 'major', suit: null, number: 21,
    keywords: ['圆满', '完成', '整合'], image: 'cards/rw-21-world.webp',
    upright: '一个周期完整地收束，整合经验并获得成就感。',
    reversed: '差一步的完成感，收尾处仍有悬而未决；补上最后一块。',
  },
];
