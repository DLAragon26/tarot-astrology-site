import type { Suit, TarotCard } from './types';

// 小阿卡纳 56 张：四花色 × 14（1=Ace … 10 … 11=侍从 12=骑士 13=王后 14=国王）。
// 元组：[num, slug, name, nameZh, keywords, upright, reversed]
type Row = [number, string, string, string, string, string, string];

const WANDS: Row[] = [
  [1, 'ace-wands', 'Ace of Wands', '权杖首牌', '灵感', '创造力的火种，新计划或新热情点燃；顺势开启。', '热情延迟或方向未明；火苗需要呵护而非硬吹。'],
  [2, 'two-wands', 'Two of Wands', '权杖二', '规划', '立足已有成果眺望未来，做出全局性的规划。', '计划悬而未决，对未知的担心大于期待。'],
  [3, 'three-wands', 'Three of Wands', '权杖三', '扩张', '布局开始回报，视野向外扩展；与远方协作。', '进展受阻或视野受限，等待的船晚点了。'],
  [4, 'four-wands', 'Four of Wands', '权杖四', '欢庆', '阶段性成果与庆祝，关系与家园的稳定感。', '过渡期的动荡，安全感暂时缺席。'],
  [5, 'five-wands', 'Five of Wands', '权杖五', '竞争', '观点碰撞与良性竞争，混乱中练出能力。', '回避冲突或内耗持续；让分歧摊开来说。'],
  [6, 'six-wands', 'Six of Wands', '权杖六', '认可', '胜利与公开的认可，自信心上扬。', '期待的目光成为压力，或认可迟迟未到。'],
  [7, 'seven-wands', 'Seven of Wands', '权杖七', '坚守', '守住阵地，逐一应对挑战；你的立场有价值。', '疲惫防守或顾此失彼；必要时收缩战线。'],
  [8, 'eight-wands', 'Eight of Wands', '权杖八', '加速', '事情突然提速，消息与进展接踵而至。', '延误或忙乱；快不等于有效率。'],
  [9, 'nine-wands', 'Nine of Wands', '权杖九', '坚韧', '接近终点的疲惫与坚持，最后的防线值得守住。', '耗竭感袭来，警惕变成防御过度。'],
  [10, 'ten-wands', 'Ten of Wands', '权杖十', '重负', '责任堆积过载，扛起一切并非唯一选项。', '开始放下与委派，负担可以变轻。'],
  [11, 'page-wands', 'Page of Wands', '权杖侍从', '试探', '对新领域的好奇与热情试水，行动力初生。', '三分钟热度或行动毛躁；让好奇心落地一点。'],
  [12, 'knight-wands', 'Knight of Wands', '权杖骑士', '冲劲', '大胆推进，行动带来势能与感染力。', '冲动与虎头蛇尾；出发前确认目的地。'],
  [13, 'queen-wands', 'Queen of Wands', '权杖王后', '自信', '温暖而有力量，清楚自己的魅力与边界。', '不安全感转化为控制或比较；回到自己的光。'],
  [14, 'king-wands', 'King of Wands', '权杖国王', '远见', '有远见的领导力，把愿景变成可执行的方向。', '独断或固执行事；领导也包含倾听。'],
];

const CUPS: Row[] = [
  [1, 'ace-cups', 'Ace of Cups', '圣杯首牌', '情感新生', '情感或创意的新泉涌起，心的容器被注满。', '情感表达受阻或内心封闭；先温柔对待自己。'],
  [2, 'two-cups', 'Two of Cups', '圣杯二', '联结', '对等的吸引与相互认可，一段关系的美好开端。', '关系中的失衡或错位；重新校准彼此的期待。'],
  [3, 'three-cups', 'Three of Cups', '圣杯三', '友谊', '友谊与共同庆祝，社群带来支持。', '圈子里的是非或被排斥感；筛选值得的联结。'],
  [4, 'four-cups', 'Four of Cups', '圣杯四', '倦怠', '对眼前事物提不起兴趣，机会在旁边未被看见。', '从倦怠中抬头，重新对生活说愿意。'],
  [5, 'five-cups', 'Five of Cups', '圣杯五', '失落', '为失去而悲伤，但身后仍有站着的杯子。', '接受与释怀，转身看见还拥有的部分。'],
  [6, 'six-cups', 'Six of Cups', '圣杯六', '怀旧', '回忆与纯真带来的温柔，旧人或旧事的善意。', '困在过去的美化滤镜里；带着它前进即可。'],
  [7, 'seven-cups', 'Seven of Cups', '圣杯七', '迷惘', '选项多得像雾，幻想与现实混在一起。', '雾散了，该基于现实做出选择。'],
  [8, 'eight-cups', 'Eight of Cups', '圣杯八', '离开', '主动离开不再滋养的境况，去寻找更深的意义。', '想走又没走成的停滞；承认想离开已是开端。'],
  [9, 'nine-cups', 'Nine of Cups', '圣杯九', '满足', '愿望成真的满足感，身心安顿。', '表面满足之下的不满足；诚实面对真实欲望。'],
  [10, 'ten-cups', 'Ten of Cups', '圣杯十', '圆满', '情感关系的圆满图景，家庭与归属的幸福感。', '理想图景出现裂痕；关系需要修补而非神话。'],
  [11, 'page-cups', 'Page of Cups', '圣杯侍从', '敏感', '细腻的感受力与创意的火花，心的消息正在到来。', '情绪化或自我保护过度；给感受一点出口。'],
  [12, 'knight-cups', 'Knight of Cups', '圣杯骑士', '邀约', '带着心意的行动与邀约，浪漫而真挚的推进。', '理想化的承诺与现实脱节；看行动不只看姿态。'],
  [13, 'queen-cups', 'Queen of Cups', '圣杯王后', '共情', '深沉的共情与情绪智慧，接住自己也接住他人。', '情绪的漩涡或过度牺牲；共情需要边界。'],
  [14, 'king-cups', 'King of Cups', '圣杯国王', '包容', '情绪的成熟与稳健，深水行舟的定力。', '压抑情感或以温柔包装操控；让情绪有真实的表达。'],
];

const SWORDS: Row[] = [
  [1, 'ace-swords', 'Ace of Swords', '宝剑首牌', '清晰', '思维的突破与真相的显影，一句话说清一切。', '思绪混乱或言语伤人；先理清再开口。'],
  [2, 'two-swords', 'Two of Swords', '宝剑二', '僵局', '蒙眼的权衡，暂时回避那个必须做的决定。', '眼罩摘下，僵局松动；决定终于被面对。'],
  [3, 'three-swords', 'Three of Swords', '宝剑三', '心碎', '言语或真相带来的刺痛，悲伤需要被承认。', '疼痛开始结痂，释怀与复原在发生。'],
  [4, 'four-swords', 'Four of Swords', '宝剑四', '休整', '主动休息与静养，恢复是策略不是偷懒。', '被迫中断后的焦躁；休息的债要还。'],
  [5, 'five-swords', 'Five of Swords', '宝剑五', '代价', '赢了争论输了关系，冲突的代价值得计算。', '放下输赢，和解或撤退都是止损。'],
  [6, 'six-swords', 'Six of Swords', '宝剑六', '过渡', '带着经验离开旧水域，渐行渐稳的迁移。', '对过去的执念拖住船锚；允许自己真的离开。'],
  [7, 'seven-swords', 'Seven of Swords', '宝剑七', '策略', '绕路的策略或信息的隐瞒，独自行动的得与失。', '坦白与自欺的暴露；透明的成本更低。'],
  [8, 'eight-swords', 'Eight of Swords', '宝剑八', '受困', '自我设限的思维把路堵死，束缚多来自解读。', '看清限制是想象出来的，松动由此开始。'],
  [9, 'nine-swords', 'Nine of Swords', '宝剑九', '忧思', '深夜的焦虑与反复回放，担心常大于现实。', '说出口的恐惧开始缩小；寻求支持。'],
  [10, 'ten-swords', 'Ten of Swords', '宝剑十', '终结', '一个局面的彻底落幕，谷底亦是地面。', '最坏的时刻过去，天色将明。'],
  [11, 'page-swords', 'Page of Swords', '宝剑侍从', '求索', '敏锐的好奇与观察，快速学习新的思路。', '言语轻率或情报误用；先求证再传播。'],
  [12, 'knight-swords', 'Knight of Swords', '宝剑骑士', '果决', '迅捷直接的推进，思想如利刃出鞘。', '鲁莽与树敌；速度需要加上判断。'],
  [13, 'queen-swords', 'Queen of Swords', '宝剑王后', '明辨', '清醒独立的判断，一针见血又心存公平。', '刻薄或情感抽离；锋利之外留一点温度。'],
  [14, 'king-swords', 'King of Swords', '宝剑国王', '公正', '理性与原则的权威，以逻辑建立秩序。', '冷酷独裁或教条化；规则要服务于人。'],
];

const PENTACLES: Row[] = [
  [1, 'ace-pentacles', 'Ace of Pentacles', '星币首牌', '机会', '务实的机遇落地，种子与土壤都已具备。', '机会错付或根基未稳；别急着催收成。'],
  [2, 'two-pentacles', 'Two of Pentacles', '星币二', '平衡', '多线并行的灵活调度，在摇摆中找节奏。', '顾此失彼的失衡；先做减法。'],
  [3, 'three-pentacles', 'Three of Pentacles', '星币三', '协作', '分工清晰的协作与专业打磨，作品成形。', '各行其是或标准下滑；重建共识。'],
  [4, 'four-pentacles', 'Four of Pentacles', '星币四', '守成', '紧握已有的资源与控制感，安全优先。', '匮乏感主导的过度紧握；松手才拿得到新的。'],
  [5, 'five-pentacles', 'Five of Pentacles', '星币五', '困顿', '匮乏与孤立的体感，忽视了就在近旁的援手。', '转机出现，接受帮助不丢人。'],
  [6, 'six-pentacles', 'Six of Pentacles', '星币六', '给予', '给予与接受之间的流动，慷慨有其分寸。', '施受失衡或附带条件的给予；回到对等。'],
  [7, 'seven-pentacles', 'Seven of Pentacles', '星币七', '耐心', '长线投入后的停顿评估，果实需要时间。', '急于求成或对回报失去耐心；再等一个周期。'],
  [8, 'eight-pentacles', 'Eight of Pentacles', '星币八', '精进', '专注手艺的重复与打磨，技艺在细节里生长。', '机械化或完美主义；抬头看看方向。'],
  [9, 'nine-pentacles', 'Nine of Pentacles', '星币九', '自足', '靠自己挣得的丰裕与从容，享受成果。', '外在丰裕内在不安；允许自己享受。'],
  [10, 'ten-pentacles', 'Ten of Pentacles', '星币十', '传承', '长期积累的稳固结构与根基，家族或体系的延续。', '根基动摇或短视决策；修复结构而非只看眼前。'],
  [11, 'page-pentacles', 'Page of Pentacles', '星币侍从', '学习', '务实的学习与新的目标，脚踏实地起步。', '目标涣散或学习浮于表面；一次学好一件事。'],
  [12, 'knight-pentacles', 'Knight of Pentacles', '星币骑士', '稳健', '可靠与勤勉的稳步推进，慢但每步都算数。', '停滞或枯燥的重复；给 routine 加一点变化。'],
  [13, 'queen-pentacles', 'Queen of Pentacles', '星币王后', '滋养', '务实的照料与生活管理，把日子过成土壤。', '工作与生活失衡；先照顾好照顾者本人。'],
  [14, 'king-pentacles', 'King of Pentacles', '星币国王', '丰足', '事业与资源的成熟掌控，稳健的丰盛。', '僵化或唯利是从；财富是工具不是答案。'],
];

const SUITS: { suit: Suit; zh: string; rows: Row[] }[] = [
  { suit: 'wands', zh: '权杖', rows: WANDS },
  { suit: 'cups', zh: '圣杯', rows: CUPS },
  { suit: 'swords', zh: '宝剑', rows: SWORDS },
  { suit: 'pentacles', zh: '星币', rows: PENTACLES },
];

function toCard(suit: Suit, r: Row): TarotCard {
  const [number, slug, name, nameZh, keywords, upright, reversed] = r;
  return {
    id: `rw-${String(number).padStart(2, '0')}-${slug}`,
    name,
    nameZh,
    arcana: 'minor',
    suit,
    number,
    keywords: keywords.split(/[，,]/),
    upright,
    reversed,
    image: `cards/rw-${String(number).padStart(2, '0')}-${slug}.webp`,
  };
}

export const MINOR_CARDS: TarotCard[] = SUITS.flatMap((s) => s.rows.map((r) => toCard(s.suit, r)));
