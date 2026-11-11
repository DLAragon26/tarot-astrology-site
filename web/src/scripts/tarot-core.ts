import { ALL_CARDS, getCard, getSpread, SPREAD_IDS, TOPIC_TAGS, MOOD_TAGS } from '@tarot/shared';
import type { DrawnCard, InterpretResponse, Reading, ReadingMode, SpreadId } from '@tarot/shared';
import { ApiError, api, attachImageFallback, cardImageSrc, el, SITE_BASE } from '../lib/api';

// 抽牌 / 线下录入共用的核心交互：洗牌、翻牌、AI 解读、保存。

export interface SessionState {
  mode: ReadingMode;
  spread: SpreadId | null;
  cards: DrawnCard[];
  interpretation: string | null;
  question: string | null;
  topic: string | null;
  mood: string | null;
  savedId: string | null;
}

export function createState(mode: ReadingMode): SessionState {
  return { mode, spread: null, cards: [], interpretation: null, question: null, topic: null, mood: null, savedId: null };
}

/** 78 张里随机抽 n 张不重复，正逆位各 50% */
export function drawRandom(spreadId: SpreadId): DrawnCard[] {
  const spread = getSpread(spreadId);
  if (!spread) return [];
  const pool = [...ALL_CARDS];
  const picked: DrawnCard[] = [];
  for (let i = 0; i < spread.positions.length; i++) {
    const idx = crypto.getRandomValues(new Uint32Array(1))[0] % pool.length;
    const card = pool.splice(idx, 1)[0];
    if (!card) break;
    const orientation = crypto.getRandomValues(new Uint32Array(1))[0] % 2 === 0 ? 'upright' : 'reversed';
    picked.push({ position: spread.positions[i].key, card: card.id, orientation });
  }
  return picked;
}

export function renderSpreadArea(
  container: HTMLElement,
  state: SessionState,
  opts: { interactive: boolean }
): void {
  container.innerHTML = '';
  if (!state.spread || state.cards.length === 0) return;
  const spread = getSpread(state.spread);
  if (!spread) return;
  const row = el('div', 'spread-row');
  state.cards.forEach((drawn, i) => {
    const card = getCard(drawn.card);
    const pos = spread.positions[i];
    const wrap = el('div', 'tcard');
    wrap.dataset.index = String(i);
    const flip = el('div', 'flip');
    const backFace = el('div', 'face');
    const backImg = document.createElement('img');
    backImg.src = `${SITE_BASE}cards/card-back.svg`;
    backImg.alt = '牌背';
    backFace.appendChild(backImg);
    const frontFace = el('div', 'face back-face');
    const frontImg = document.createElement('img');
    const srcs = cardImageSrc(drawn.card);
    frontImg.src = srcs.src;
    frontImg.alt = card ? `${card.nameZh}` : drawn.card;
    // 牌面在翻转容器里初始不可见（backface-visibility:hidden），lazy 会被判"不可见"而永不触发加载；
    // 一屏最多 5 张，直接 eager。
    frontImg.loading = 'eager';
    attachImageFallback(frontImg, srcs.fallback);
    frontFace.appendChild(frontImg);
    flip.appendChild(backFace);
    flip.appendChild(frontFace);
    wrap.appendChild(flip);

    const cap = el('div', 'cap');
    const posSpan = el('span', 'pos', pos?.labelZh ?? drawn.position);
    cap.appendChild(posSpan);
    cap.appendChild(document.createTextNode(card ? card.nameZh : drawn.card));
    cap.appendChild(document.createElement('br'));
    const ori = el('span', `orientation-tag${drawn.orientation === 'reversed' ? ' reversed' : ''}`, drawn.orientation === 'upright' ? '正位' : '逆位');
    cap.appendChild(ori);
    wrap.appendChild(cap);

    if (opts.interactive) {
      wrap.classList.add('clickable');
      wrap.addEventListener('click', () => wrap.classList.add('flipped'));
    } else {
      // 逐张自动翻开
      setTimeout(() => wrap.classList.add('flipped'), 200 + i * 450);
    }
    row.appendChild(wrap);
  });
  container.appendChild(row);

  // 牌义明细
  const detail = el('div');
  state.cards.forEach((drawn, i) => {
    const card = getCard(drawn.card);
    const pos = spread.positions[i];
    const p = el('div', 'panel');
    const head = el('p');
    head.appendChild(el('strong', undefined, `${pos?.labelZh ?? drawn.position} · ${card?.nameZh ?? drawn.card}（${card?.name ?? ''}）`));
    head.appendChild(document.createTextNode('  '));
    head.appendChild(el('span', `orientation-tag${drawn.orientation === 'reversed' ? ' reversed' : ''}`, drawn.orientation === 'upright' ? '正位' : '逆位'));
    p.appendChild(head);
    if (card) {
      const kw = el('p', 'muted', `关键词：${card.keywords.join(' · ')}`);
      p.appendChild(kw);
      const meaning = drawn.orientation === 'upright' ? card.upright : card.reversed;
      p.appendChild(el('p', undefined, meaning));
    }
    detail.appendChild(p);
  });
  container.appendChild(detail);
}

export function buildPayloadFromState(state: SessionState): Record<string, unknown> {
  return {
    mode: state.mode,
    question: state.question,
    spread: state.spread,
    cards: state.cards,
    topic_tag: state.topic,
    mood_tag: state.mood,
  };
}

export async function requestInterpret(state: SessionState, errBox: HTMLElement): Promise<string | null> {
  errBox.hidden = true;
  try {
    const res = await api<InterpretResponse>('/api/interpret', {
      method: 'POST',
      body: JSON.stringify(buildPayloadFromState(state)),
    });
    state.interpretation = res.interpretation;
    return res.interpretation;
  } catch (err) {
    const message =
      err instanceof ApiError
        ? err.detail
          ? `${err.message}（${err.detail}）`
          : err.message
        : '解读请求失败，请稍后重试';
    errBox.textContent = message;
    errBox.hidden = false;
    return null;
  }
}

export async function saveReading(state: SessionState, errBox: HTMLElement): Promise<Reading | null> {
  errBox.hidden = true;
  try {
    const payload = buildPayloadFromState(state) as Record<string, unknown>;
    if (state.interpretation) payload.ai_interpretation = state.interpretation;
    const res = await api<{ reading: Reading }>('/api/readings', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    state.savedId = res.reading.id;
    return res.reading;
  } catch (err) {
    const message = err instanceof ApiError ? err.message : '保存失败，请稍后重试';
    errBox.textContent = message;
    errBox.hidden = false;
    return null;
  }
}

/** 填充牌阵选择与标签下拉 */
export function mountSpreadPicker(container: HTMLElement, onPick: (id: SpreadId) => void): void {
  container.innerHTML = '';
  for (const id of SPREAD_IDS) {
    const spread = getSpread(id);
    if (!spread) continue;
    const b = el('button', 'btn secondary');
    b.type = 'button';
    b.style.margin = '0 8px 8px 0';
    b.textContent = `${spread.nameZh}（${spread.positions.length} 张）`;
    b.title = spread.descriptionZh;
    b.addEventListener('click', () => {
      for (const other of Array.from(container.children)) (other as HTMLButtonElement).style.borderColor = '';
      b.style.borderColor = 'var(--accent)';
      onPick(id);
    });
    container.appendChild(b);
  }
}

export function mountTagSelect(select: HTMLSelectElement, values: readonly string[], placeholder: string): void {
  select.innerHTML = '';
  select.appendChild(new Option(placeholder, ''));
  for (const v of values) select.appendChild(new Option(v, v));
}

export { TOPIC_TAGS, MOOD_TAGS };
