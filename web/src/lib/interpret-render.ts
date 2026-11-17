import type { CardAnalysis, InterpretationPayload } from '@tarot/shared';

// 解读渲染（A5/B2）与流式渐进渲染（A4）。
// 结构化解读 = 逐张牌分析 + 综合解读 + 反思问题；text 为模型未按 JSON 返回时的降级。

export function parseStoredInterpretation(raw: string | null): InterpretationPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      ((parsed as { format?: string }).format === 'structured' || (parsed as { format?: string }).format === 'text')
    ) {
      return parsed as InterpretationPayload;
    }
  } catch {
    /* 旧数据：纯文本 */
  }
  return { format: 'text', text: raw };
}

function heading(text: string): HTMLElement {
  const h = document.createElement('p');
  const s = document.createElement('strong');
  s.textContent = text;
  h.appendChild(s);
  return h;
}

function cardPanel(card: CardAnalysis): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'panel interp-card';
  const head = document.createElement('p');
  const strong = document.createElement('strong');
  strong.textContent = `${card.position} · ${card.name}（${card.orientation}）`;
  head.appendChild(strong);
  panel.appendChild(head);
  const p = document.createElement('p');
  p.textContent = card.analysis;
  panel.appendChild(p);
  return panel;
}

/** 结构化解读的最终渲染：逐张牌 + 综合 + 反思 */
export function renderInterpretation(container: HTMLElement, payload: InterpretationPayload): void {
  container.innerHTML = '';
  if (payload.format === 'text') {
    const p = document.createElement('p');
    p.textContent = payload.text;
    container.appendChild(p);
    return;
  }

  const cardsWrap = document.createElement('div');
  cardsWrap.className = 'interp-section';
  cardsWrap.appendChild(heading('逐张解读'));
  for (const card of payload.cards) cardsWrap.appendChild(cardPanel(card));
  container.appendChild(cardsWrap);

  const synthesis = document.createElement('div');
  synthesis.className = 'panel interp-synthesis';
  synthesis.appendChild(heading('综合解读'));
  for (const para of payload.synthesis.split(/\n{2,}/)) {
    const t = para.trim();
    if (!t) continue;
    const p = document.createElement('p');
    p.textContent = t;
    synthesis.appendChild(p);
  }
  container.appendChild(synthesis);

  if (payload.reflection.length > 0) {
    const refl = document.createElement('div');
    refl.className = 'panel interp-reflection';
    refl.appendChild(heading('反思问题'));
    const ul = document.createElement('ul');
    for (const q of payload.reflection) {
      const li = document.createElement('li');
      li.textContent = q;
      ul.appendChild(li);
    }
    refl.appendChild(ul);
    container.appendChild(refl);
  }
}

// ---------- 流式渐进渲染 ----------

/** 解析 JSON 字符串字面量（含转义）；未闭合返回 null */
function scanString(buf: string, startQuote: number): { value: string; end: number } | null {
  let out = '';
  for (let i = startQuote + 1; i < buf.length; i++) {
    const ch = buf[i];
    if (ch === '\\') {
      const next = buf[i + 1];
      if (next === undefined) return null;
      switch (next) {
        case 'n':
          out += '\n';
          break;
        case 't':
          out += '\t';
          break;
        case '"':
          out += '"';
          break;
        case '\\':
          out += '\\';
          break;
        case 'u': {
          const hex = buf.slice(i + 2, i + 6);
          if (hex.length < 4) return null;
          const code = Number.parseInt(hex, 16);
          if (Number.isNaN(code)) return null;
          out += String.fromCharCode(code);
          i += 4;
          break;
        }
        default:
          out += next;
      }
      i++;
    } else if (ch === '"') {
      return { value: out, end: i + 1 };
    } else {
      out += ch;
    }
  }
  return null;
}

interface PartialState {
  cards: (CardAnalysis | null)[];
  synthesis: string;
  synthesisComplete: boolean;
}

/**
 * 从不完整的 JSON 流缓冲中增量提取：
 * - cards[].index + analysis（对象按 {"index":n,"analysis":"..."} 顺序，key 顺序颠倒时以已闭合的为准）；
 * - synthesis 部分文本（未闭合也展示）。
 * 提取失败不影响正确性：最终 finalize 用权威解析结果重渲染。
 */
function extractPartial(buf: string, cardCount: number): PartialState {
  const state: PartialState = { cards: new Array(cardCount).fill(null), synthesis: '', synthesisComplete: false };
  let searchFrom = 0;
  for (;;) {
    const keyAt = buf.indexOf('"index"', searchFrom);
    if (keyAt < 0) break;
    const colonAt = buf.indexOf(':', keyAt + 7);
    if (colonAt < 0) break;
    const idxMatch = /^\s*(\d+)/.exec(buf.slice(colonAt + 1, colonAt + 8));
    const idx = idxMatch ? Number(idxMatch[1]) : NaN;
    if (!Number.isInteger(idx) || idx < 0 || idx >= cardCount || state.cards[idx]) {
      searchFrom = keyAt + 7;
      continue;
    }
    const analysisKeyAt = buf.indexOf('"analysis"', colonAt);
    if (analysisKeyAt < 0) break;
    const aColon = buf.indexOf(':', analysisKeyAt + 10);
    if (aColon < 0) break;
    const quoteAt = buf.indexOf('"', aColon);
    if (quoteAt < 0) break;
    const scanned = scanString(buf, quoteAt);
    if (scanned) {
      state.cards[idx] = { position: '', name: '', orientation: '', analysis: scanned.value };
      searchFrom = scanned.end;
    } else {
      break; // 该 analysis 未闭合：等待更多增量
    }
  }

  const synKeyAt = buf.indexOf('"synthesis"');
  if (synKeyAt >= 0) {
    const aColon = buf.indexOf(':', synKeyAt + 11);
    if (aColon >= 0) {
      const quoteAt = buf.indexOf('"', aColon);
      if (quoteAt >= 0) {
        const scanned = scanString(buf, quoteAt);
        if (scanned) {
          state.synthesis = scanned.value;
          state.synthesisComplete = true;
        } else {
          state.synthesis = buf.slice(quoteAt + 1);
        }
      }
    }
  }
  return state;
}

/**
 * 流式渲染器：push 增量 → 逐步呈现；finalize(payload) 用权威结果替换。
 * 若流内容不是 JSON（模型降级），直接原样渐进展示。
 */
export class ProgressiveInterpretation {
  private buffer = '';
  private meta: { position: string; name: string; orientation: string }[];

  constructor(
    private container: HTMLElement,
    cardsMeta: { position: string; name: string; orientation: string }[]
  ) {
    this.meta = cardsMeta;
    this.container.classList.add('streaming');
  }

  push(delta: string): void {
    this.buffer += delta;
    this.render();
  }

  private render(): void {
    const buf = this.buffer.trimStart();
    if (!buf.startsWith('{')) {
      // 非流式 JSON：原样文本渐进展示
      this.container.innerHTML = '';
      const p = document.createElement('p');
      p.className = 'stream-text';
      p.textContent = this.buffer;
      this.container.appendChild(p);
      return;
    }
    const state = extractPartial(buf, this.meta.length);
    const hasAny =
      state.cards.some((c) => c !== null) || state.synthesis.length > 0 || this.buffer.trim().length > 0;
    if (!hasAny) return;
    this.container.innerHTML = '';

    const doneCards = state.cards
      .map((c, i) => (c ? { ...c, position: this.meta[i]?.position ?? '', name: this.meta[i]?.name ?? '', orientation: this.meta[i]?.orientation ?? '' } : null))
      .filter((c): c is CardAnalysis => c !== null);
    if (doneCards.length > 0) {
      const wrap = document.createElement('div');
      wrap.className = 'interp-section';
      wrap.appendChild(heading('逐张解读'));
      for (const card of doneCards) wrap.appendChild(cardPanel(card));
      this.container.appendChild(wrap);
    }
    if (state.synthesis.length > 0 || state.synthesisComplete) {
      const panel = document.createElement('div');
      panel.className = 'panel interp-synthesis';
      panel.appendChild(heading('综合解读'));
      const p = document.createElement('p');
      p.className = 'stream-text';
      p.textContent = state.synthesis;
      panel.appendChild(p);
      this.container.appendChild(panel);
    }
  }

  finalize(payload: InterpretationPayload): void {
    this.container.classList.remove('streaming');
    renderInterpretation(this.container, payload);
  }

  fail(message: string): void {
    this.container.classList.remove('streaming');
    this.container.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'notice error';
    box.textContent = message;
    this.container.appendChild(box);
  }
}
