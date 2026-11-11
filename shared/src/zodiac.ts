// 太阳星座基础内容：结构化数据，前端直接静态渲染，不做实时星盘、不调用 AI。

export interface ZodiacSign {
  key: string;
  nameZh: string;
  symbol: string;
  dateRangeZh: string;
  elementZh: string;
  rulerZh: string;
  keywordsZh: string[];
  /** 性格倾向（一段） */
  traitsZh: string;
  /** 通用反思建议 */
  reflectionZh: string[];
}

export const ZODIAC_SIGNS: ZodiacSign[] = [
  {
    key: 'aries', nameZh: '白羊座', symbol: '♈', dateRangeZh: '3月21日 – 4月19日',
    elementZh: '火象', rulerZh: '火星', keywordsZh: ['开创', '直率', '行动力'],
    traitsZh: '天生的启动者，反应快、热情直接，习惯以行动思考。喜欢迎接挑战，但持续性与耐性往往是功课。',
    reflectionZh: ['这周我的冲劲用在了真正重要的事上吗？', '在推开一扇门之前，我是否确认过门后是我想要的？'],
  },
  {
    key: 'taurus', nameZh: '金牛座', symbol: '♉', dateRangeZh: '4月20日 – 5月20日',
    elementZh: '土象', rulerZh: '金星', keywordsZh: ['稳定', '感官', '积累'],
    traitsZh: '重视安全与品质，节奏稳健，擅长把资源慢慢养大。对舒适与美有天然的敏感，但变化常让人迟疑。',
    reflectionZh: ['我抓住的哪些东西其实已经不再滋养我？', '如果允许一点松动，生活会出现什么新空间？'],
  },
  {
    key: 'gemini', nameZh: '双子座', symbol: '♊', dateRangeZh: '5月21日 – 6月21日',
    elementZh: '风象', rulerZh: '水星', keywordsZh: ['好奇', '交流', '灵活'],
    traitsZh: '信息与想法的枢纽，学习力强、表达灵活，靠兴趣驱动。广泛但也容易分散，深度是常修课题。',
    reflectionZh: ['我的注意力此刻被什么牵着走？', '如果只留下一件事深耕，会留下哪一件？'],
  },
  {
    key: 'cancer', nameZh: '巨蟹座', symbol: '♋', dateRangeZh: '6月22日 – 7月22日',
    elementZh: '水象', rulerZh: '月亮', keywordsZh: ['关怀', '家庭', '直觉'],
    traitsZh: '情感细腻，重视归属与照顾，对氛围的变化极其敏锐。记忆力好，也因此容易背着旧情绪生活。',
    reflectionZh: ['我在照顾谁，谁在照顾我？', '哪些旧情绪值得温柔地放下？'],
  },
  {
    key: 'leo', nameZh: '狮子座', symbol: '♌', dateRangeZh: '7月23日 – 8月22日',
    elementZh: '火象', rulerZh: '太阳', keywordsZh: ['表达', '热忱', '创造'],
    traitsZh: '自带舞台感，慷慨而有感染力，希望自己的付出被看见。自尊心强，需要在掌声与自足之间找到平衡。',
    reflectionZh: ['我渴望被认可的是作品，还是存在本身？', '今天有没有为别人真心鼓掌？'],
  },
  {
    key: 'virgo', nameZh: '处女座', symbol: '♍', dateRangeZh: '8月23日 – 9月22日',
    elementZh: '土象', rulerZh: '水星', keywordsZh: ['细致', '分析', '服务'],
    traitsZh: '擅长观察细节与优化流程，用做事表达关心。标准高，容易对自己与他人苛刻，"足够好"是需要练习的功课。',
    reflectionZh: ['今天我已经做得"足够好"的地方是哪里？', '我在担心的问题里，有多少真的会发生？'],
  },
  {
    key: 'libra', nameZh: '天秤座', symbol: '♎', dateRangeZh: '9月23日 – 10月23日',
    elementZh: '风象', rulerZh: '金星', keywordsZh: ['平衡', '关系', '审美'],
    traitsZh: '天生在意关系的和谐与公平，善于协调与权衡，审美出色。为了体面容易回避冲突，决定有时被推迟。',
    reflectionZh: ['此刻我在迁就谁，我自己的立场是什么？', '哪一次"不舒服的真话"其实值得说出口？'],
  },
  {
    key: 'scorpio', nameZh: '天蝎座', symbol: '♏', dateRangeZh: '10月24日 – 11月22日',
    elementZh: '水象', rulerZh: '冥王星（传统：火星）', keywordsZh: ['深度', '洞察', '转化'],
    traitsZh: '情感浓烈而深藏，洞察力惊人，一旦投入便是全部。信任建立慢，放手更慢，转化与重生是人生主题。',
    reflectionZh: ['我握紧的东西，是因为爱还是因为怕失去？', '最近一次彻底的放下，带给我什么？'],
  },
  {
    key: 'sagittarius', nameZh: '射手座', symbol: '♐', dateRangeZh: '11月23日 – 12月21日',
    elementZh: '火象', rulerZh: '木星', keywordsZh: ['探索', '乐观', '意义'],
    traitsZh: '向往远方与更大的图景，坦率、爱自由，靠意义感驱动。容易高估速度，把"箭"射出去之前瞄准是关键。',
    reflectionZh: ['我追求的远方，和眼前的责任如何共处？', '这次乐观判断，有没有经过最基本的核对？'],
  },
  {
    key: 'capricorn', nameZh: '摩羯座', symbol: '♑', dateRangeZh: '12月22日 – 1月19日',
    elementZh: '土象', rulerZh: '土星', keywordsZh: ['责任', '攀登', '克制'],
    traitsZh: '目标明确、执行力强，愿意为长期成果承受短期辛苦。标准严格，常把成就等同于价值，柔软是需要保留的能力。',
    reflectionZh: ['我正在爬的这座山，是我自己选的吗？', '允许自己休息一天，天不会塌。'],
  },
  {
    key: 'aquarius', nameZh: '水瓶座', symbol: '♒', dateRangeZh: '1月20日 – 2月18日',
    elementZh: '风象', rulerZh: '天王星（传统：土星）', keywordsZh: ['独立', '前瞻', '理念'],
    traitsZh: '视角独特，关心理念与群体，常有超前一步的想法。重视理智与距离感，亲密关系里的"在场"是功课。',
    reflectionZh: ['我的独立，是否有时也隔绝了支持？', '我的想法如何落地为对身边人的具体帮助？'],
  },
  {
    key: 'pisces', nameZh: '双鱼座', symbol: '♓', dateRangeZh: '2月19日 – 3月20日',
    elementZh: '水象', rulerZh: '海王星（传统：木星）', keywordsZh: ['共情', '想象', '流动'],
    traitsZh: '感受力与想象力丰富，边界柔软，艺术与直觉的天赋高。容易吸收他人情绪，需要练习分清哪些是自己的。',
    reflectionZh: ['此刻我感到的，是我的情绪还是别人的？', '今天我如何给自己一段安静的恢复时间？'],
  },
];

export function getZodiac(key: string): ZodiacSign | null {
  return ZODIAC_SIGNS.find((z) => z.key === key) ?? null;
}
