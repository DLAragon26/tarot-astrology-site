import { getCard } from './cards';
import { getSpread } from './spreads';
import type { DrawnCard, ReadingMode, SpreadId } from './types';

// AI prompt：固定边界，任何 /api/interpret 都必须经由这两个函数构造。
// 边界：心理反思 / 象征解读 / 塔罗结构解读；不做预言、医疗、投资、法律建议；
// 不用宿命论语气；输出简体中文；引用问题、位置、牌名与正逆位；控制长度；
// 输出必须是严格 JSON（由后端解析校验，解析失败降级为纯文本）。

export const INTERPRET_SYSTEM_PROMPT = `你是一位塔罗牌解读引导者，为一次私人塔罗记录提供解读文字。你必须严格遵守以下边界：

1. 定位：只做心理反思、象征解读与塔罗结构解读。你的文字帮助提问者整理思绪、看见不同角度，不预测、不预言任何确定发生的事。
2. 禁区：不提供医疗诊断或治疗建议、不提供投资理财建议、不提供法律建议。若问题涉及这些领域，在综合解读中说明仅供参考，重要决定请咨询对应领域的专业人士。
3. 语气：不使用宿命论语气。避免"注定""必然会""逃不掉"等表述，强调可能性、选择与提问者的自主性。
4. 语言：全文使用简体中文。
5. 引用要求：每张牌的分析必须结合它的牌阵位置、牌名（中文）与正位或逆位，把牌义与问题情境结合起来；综合解读必须明确回应提问的问题，不得泛泛而谈。
6. 篇幅：每张牌的分析 60 至 180 字；综合解读 200 至 450 字，可用两个换行分段；反思问题 1 至 3 个。
7. 若牌面与问题之间的联结确实牵强，如实说明牌面提供了哪种角度的参照即可，不要编造强解读。

输出格式（严格遵守）：只输出一个 JSON 对象，不要输出 JSON 以外的任何文字、说明或代码块标记。结构：
{"cards":[{"index":0,"analysis":"第 0 张牌的逐张分析（index 对应输入牌面列表的序号，从 0 开始）"},{"index":1,"analysis":"…"}],"synthesis":"综合解读","reflection":["开放式反思问题"]}
要求：cards 必须覆盖输入牌面的每一张牌，index 从 0 开始、不重复、不越界；reflection 最多 3 项。`;

export function buildInterpretSystemPrompt(): string {
  return INTERPRET_SYSTEM_PROMPT;
}

export interface PromptInput {
  mode: ReadingMode;
  question: string;
  spread: SpreadId;
  cards: DrawnCard[];
  mood_tag?: string | null;
  topic_tag?: string | null;
}

/**
 * @param recentContext 该用户最近记录的问题/主题摘要（每行一条）。
 *   只有请求显式 include_context 时后端才会传入；注入内容只作呼应参考。
 */
export function buildInterpretUserPrompt(input: PromptInput, recentContext?: string[]): string {
  const spread = getSpread(input.spread);
  const lines: string[] = [];
  lines.push(`问题：${input.question}`);
  if (input.topic_tag) lines.push(`主题标签：${input.topic_tag}`);
  if (input.mood_tag) lines.push(`当前心情：${input.mood_tag}`);
  lines.push(`来源：${input.mode === 'online' ? '线上抽牌' : '线下手动录入的排面'}`);
  lines.push(`牌阵：${spread ? spread.nameZh : input.spread}`);
  lines.push('牌面（index 从 0 开始）：');
  for (let i = 0; i < input.cards.length; i++) {
    const drawn = input.cards[i]!;
    const card = getCard(drawn.card);
    const pos = spread?.positions[i];
    const orientationZh = drawn.orientation === 'upright' ? '正位' : '逆位';
    const base = card ? `基础牌义：${drawn.orientation === 'upright' ? card.upright : card.reversed}` : '';
    lines.push(
      `- index ${i}，位置「${pos ? pos.labelZh : drawn.position}」：${card ? `${card.nameZh}（${card.name}）` : drawn.card}，${orientationZh}。${base}`
    );
  }
  if (recentContext && recentContext.length > 0) {
    lines.push('最近记录背景（提问者此前关注的问题与主题，仅供呼应参考，不要逐条复述）：');
    for (const line of recentContext) lines.push(`- ${line}`);
  }
  lines.push('请依据以上信息，按系统提示的边界与 JSON 格式给出解读。');
  return lines.join('\n');
}
