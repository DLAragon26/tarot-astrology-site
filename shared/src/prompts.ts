import { getCard } from './cards';
import { getSpread } from './spreads';
import type { DrawnCard, ReadingMode, SpreadId } from './types';

// AI prompt：固定边界，任何 /api/interpret 都必须经由这两个函数构造。
// 边界：心理反思 / 象征解读 / 塔罗结构解读；不做预言、医疗、投资、法律建议；
// 不用宿命论语气；输出简体中文；引用问题、位置、牌名与正逆位；控制长度。

export const INTERPRET_SYSTEM_PROMPT = `你是一位塔罗牌解读引导者，为一次私人塔罗记录提供解读文字。你必须严格遵守以下边界：

1. 定位：只做心理反思、象征解读与塔罗结构解读。你的文字帮助提问者整理思绪、看见不同角度，不预测、不预言任何确定发生的事。
2. 禁区：不提供医疗诊断或治疗建议、不提供投资理财建议、不提供法律建议。若问题涉及这些领域，说明解读仅供参考，重要决定请咨询对应领域的专业人士。
3. 语气：不使用宿命论语气。避免"注定""必然会""逃不掉"等表述，强调可能性、选择与提问者的自主性。
4. 语言：全文使用简体中文。
5. 引用要求：解读必须明确引用提问的问题、每张牌的牌阵位置、牌名（中文）以及正位或逆位，将牌义与问题情境结合起来，不得泛泛而谈。
6. 篇幅：正文控制在 300 至 600 字，分 2 至 4 个自然段。结尾可用一两句开放式反思收束，不要写空洞的模板祝福。
7. 若牌面与问题之间的联结确实牵强，如实说明牌面提供了哪种角度的参照即可，不要编造强解读。`;

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

export function buildInterpretUserPrompt(input: PromptInput): string {
  const spread = getSpread(input.spread);
  const lines: string[] = [];
  lines.push(`问题：${input.question}`);
  if (input.topic_tag) lines.push(`主题标签：${input.topic_tag}`);
  if (input.mood_tag) lines.push(`当前心情：${input.mood_tag}`);
  lines.push(`来源：${input.mode === 'online' ? '线上抽牌' : '线下手动录入的排面'}`);
  lines.push(`牌阵：${spread ? spread.nameZh : input.spread}`);
  lines.push('牌面：');
  for (const drawn of input.cards) {
    const card = getCard(drawn.card);
    const pos = spread?.positions.find((p) => p.key === drawn.position);
    const orientationZh = drawn.orientation === 'upright' ? '正位' : '逆位';
    const base = card ? `基础牌义：${drawn.orientation === 'upright' ? card.upright : card.reversed}` : '';
    lines.push(
      `- 位置「${pos ? pos.labelZh : drawn.position}」：${card ? `${card.nameZh}（${card.name}）` : drawn.card}，${orientationZh}。${base}`
    );
  }
  lines.push('请依据以上信息，按照系统提示中的边界与要求，给出解读。');
  return lines.join('\n');
}
