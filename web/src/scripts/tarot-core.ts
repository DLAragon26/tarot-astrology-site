import { ALL_CARDS, getCard, getSpread, SPREAD_IDS, TOPIC_TAGS, MOOD_TAGS } from '@tarot/shared';
import type { DrawnCard, InterpretationPayload, InterpretResponse, ReadingMode, SpreadId, TarotCard } from '@tarot/shared';
import { ApiError, api, attachImageFallback, cardImageSrc, el, redirectToLogin, API_BASE, SITE_BASE } from '../lib/api';

// 抽牌 / 线下录入共用的核心交互：洗牌、手动选牌（A1）、翻牌、逆位旋转（A2）、
// AI 流式解读（A4）、结构化渲染（A5）、保存。

export interface SessionState {
  mode: ReadingMode;
  spread: SpreadId | null;
  cards: DrawnCard[];
  interpretation: InterpretationPayload | null;
  question: string | null;
  topic: string | null;
  mood: string | null;
  savedId: string | null;
  /** B3：本次解读是否允许参考最近记录主题 */
  includeContext: boolean;
}

export function createState(mode: ReadingMode): SessionState {
  return {
    mode,
    spread: null,
    cards: [],
    interpretation: null,
    question: null,
    topic: null,
    mood: null,
    savedId: null,
    includeContext: false,
  };
}

// ---------- 随机：crypto + 拒绝采样（消除模偏差） ----------

function randInt(maxExclusive: number): number {
  if (maxExclusive <= 1) return 0;
  const limit = Math.floor(0xffffffff / maxExclusive) * maxExclusive;
  for (;;) {
    const v = crypto.getRandomValues(new Uint32Array(1))[0]!;
    if (v < limit) return v % maxExclusive;
  }
}

/** Fisher–Yates 洗牌：返回一副随机顺序的牌（背面朝上，供用户挑选） */
export function shuffleDeck(): TarotCard[] {
  const deck = [...ALL_CARDS];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    const a = deck[i]!;
    deck[i] = deck[j]!;
    deck[j] = a;
  }
  return deck;
}

/** 正逆位 50/50 */
function randomOrientation(): 'upright' | 'reversed' {
  return randInt(2) === 0 ? 'upright' : 'reversed';
}

// ---------- A1 手动选牌池 ----------

/**
 * 渲染 78 张牌背的选择池：用户点选 count 张 → 确认。
 * deck 为已洗匀的牌序；选择第 i 格即取出 deck[i]（随机性来自洗牌而非格位）。
 */
export function renderCardPool(
  container: HTMLElement,
  count: number,
  deck: TarotCard[],
  onConfirm: (picked: DrawnCard[]) => void,
  spreadId: SpreadId
): void {
  container.innerHTML = '';
  const spread = getSpread(spreadId);
  if (!spread || deck.length < count) return;

  const hint = el('p', 'muted pool-hint', `凭直觉点选 ${count} 张牌（点选后可再次点击取消）`);
  container.appendChild(hint);

  const grid = el('div', 'card-pool');
  const selected = new Set<number>();

  const status = el('p', 'muted pool-status');
  const confirmBtn = el('button', 'btn accent pool-confirm', `确认这 ${count} 张牌`) as HTMLButtonElement;
  confirmBtn.type = 'button';
  confirmBtn.disabled = true;
  confirmBtn.hidden = true;

  const autoBtn = el('button', 'btn secondary pool-auto', '让系统随机代选') as HTMLButtonElement;
  autoBtn.type = 'button';

  const updateStatus = (): void => {
    status.textContent = `已选 ${selected.size} / ${count}`;
    const ready = selected.size === count;
    confirmBtn.disabled = !ready;
    confirmBtn.hidden = !ready;
    hint.textContent = ready
      ? '就是它们了。点击「确认选牌」进入翻牌。'
      : `凭直觉点选 ${count} 张牌（点选后可再次点击取消）`;
  };

  deck.forEach((_card, i) => {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'pool-card';
    cell.dataset.index = String(i);
    cell.setAttribute('aria-label', `第 ${i + 1} 张牌背，未选择`);
    const img = document.createElement('img');
    img.src = `${SITE_BASE}cards/card-back.svg`;
    img.alt = '';
    img.loading = 'lazy';
    cell.appendChild(img);
    cell.addEventListener('click', () => {
      if (selected.has(i)) {
        selected.delete(i);
        cell.classList.remove('selected');
        cell.setAttribute('aria-label', `第 ${i + 1} 张牌背，未选择`);
      } else if (selected.size < count) {
        selected.add(i);
        cell.classList.add('selected');
        cell.setAttribute('aria-label', `第 ${i + 1} 张牌背，已选择`);
      }
      updateStatus();
    });
    grid.appendChild(cell);
  });

  autoBtn.addEventListener('click', () => {
    for (const node of Array.from(grid.children)) {
      const cell = node as HTMLButtonElement;
      cell.classList.remove('selected');
    }
    selected.clear();
    while (selected.size < count) selected.add(randInt(deck.length));
    for (const i of selected) {
      const cell = grid.children[i] as HTMLButtonElement | undefined;
      cell?.classList.add('selected');
    }
    updateStatus();
  });

  confirmBtn.addEventListener('click', () => {
    if (selected.size !== count) return;
    const indices = [...selected].sort((a, b) => a - b);
    const picked: DrawnCard[] = indices.map((idx, pos) => ({
      position: spread.positions[pos]?.key ?? `pos${pos}`,
      card: deck[idx]!.id,
      orientation: randomOrientation(),
    }));
    onConfirm(picked);
  });

  container.appendChild(grid);
  const actions = el('div', 'pool-actions');
  actions.appendChild(status);
  actions.appendChild(autoBtn);
  actions.appendChild(confirmBtn);
  container.appendChild(actions);
  updateStatus();
}

// ---------- 牌面渲染 ----------

export function renderSpreadArea(container: HTMLElement, state: SessionState, opts: { interactive: boolean }): void {
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
    frontImg.alt = card ? `${card.nameZh}（${drawn.orientation === 'upright' ? '正位' : '逆位'}）` : drawn.card;
    // 牌面在翻转容器里初始不可见（backface-visibility:hidden），lazy 会被判"不可见"而永不触发加载；
    // 一屏最多 5 张，直接 eager。
    frontImg.loading = 'eager';
    if (drawn.orientation === 'reversed') frontImg.classList.add('rev'); // A2：逆位牌图旋转 180°
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
      wrap.tabIndex = 0;
      wrap.setAttribute('role', 'button');
      wrap.setAttribute('aria-label', `翻开${pos?.labelZh ?? drawn.position}位置的牌`);
      const open = (): void => wrap.classList.add('flipped');
      wrap.addEventListener('click', open);
      wrap.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      });
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

// ---------- 请求构造 ----------

export function buildPayloadFromState(state: SessionState): Record<string, unknown> {
  return {
    mode: state.mode,
    question: state.question,
    spread: state.spread,
    cards: state.cards,
    topic_tag: state.topic,
    mood_tag: state.mood,
    include_context: state.includeContext,
  };
}

// ---------- A4 流式解读（失败自动回退非流式） ----------

function fallbackInterpret(state: SessionState, errBox: HTMLElement): Promise<InterpretationPayload | null> {
  return (async () => {
    try {
      const res = await api<InterpretResponse>('/api/interpret', {
        method: 'POST',
        body: JSON.stringify(buildPayloadFromState(state)),
      });
      state.interpretation = res.interpretation;
      return res.interpretation;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : '解读请求失败，请稍后重试';
      errBox.textContent = message;
      errBox.hidden = false;
      return null;
    }
  })();
}

/**
 * POST /api/interpret/stream（SSE）。
 * onDelta 收到累积文本（供 ProgressiveInterpretation 渐进渲染）。
 * 仅在「连一个事件都没收到」的传输失败时才回退到非流式端点，避免重复扣额度。
 */
export async function requestInterpret(
  state: SessionState,
  errBox: HTMLElement,
  onProgress: (accumulated: string) => void
): Promise<InterpretationPayload | null> {
  errBox.hidden = true;
  let body: ReadableStream<Uint8Array>;
  try {
    const res = await fetch(`${API_BASE}/api/interpret/stream`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayloadFromState(state)),
    });
    if (res.status === 401) {
      redirectToLogin();
      return null;
    }
    if (!res.ok || !res.body) {
      // 429/502 等错误体是 JSON，交给统一错误处理（不回退重试，防止重复扣额度）
      let payload: { error?: { message?: string } } | null = null;
      try {
        payload = (await res.json()) as { error?: { message?: string } };
      } catch {
        /* ignore */
      }
      errBox.textContent = payload?.error?.message ?? `解读请求失败（${res.status}）`;
      errBox.hidden = false;
      return null;
    }
    body = res.body;
  } catch {
    return fallbackInterpret(state, errBox);
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let accumulated = '';
  let donePayload: InterpretResponse | null = null;
  let errorMsg: string | null = null;
  let sawEvent = false;

  const handleEvent = (rawEvent: string): void => {
    const lines = rawEvent.split('\n');
    const eventLine = lines.find((l) => l.startsWith('event:'));
    const dataLine = lines.find((l) => l.startsWith('data:'));
    if (!dataLine) return;
    let data: unknown;
    try {
      data = JSON.parse(dataLine.slice(5).trim()) as unknown;
    } catch {
      return;
    }
    sawEvent = true;
    const ev = eventLine ? eventLine.slice(6).trim() : 'message';
    if (ev === 'delta' && typeof (data as { t?: unknown }).t === 'string') {
      accumulated += (data as { t: string }).t;
      onProgress(accumulated);
    } else if (ev === 'done') {
      donePayload = data as InterpretResponse;
    } else if (ev === 'error') {
      errorMsg = (data as { error?: { message?: string } }).error?.message ?? '解读请求失败，请稍后重试';
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = pending.indexOf('\n\n')) >= 0) {
        const rawEvent = pending.slice(0, idx);
        pending = pending.slice(idx + 2);
        handleEvent(rawEvent);
      }
    }
    if (pending.trim().length > 0) handleEvent(pending);
  } catch {
    if (!sawEvent) return fallbackInterpret(state, errBox);
    errorMsg = errorMsg ?? '连接中断，请稍后重试';
  }

  if (donePayload) {
    state.interpretation = (donePayload as InterpretResponse).interpretation;
    return (donePayload as InterpretResponse).interpretation;
  }
  if (errorMsg) {
    errBox.textContent = errorMsg;
    errBox.hidden = false;
    return null;
  }
  if (!sawEvent) return fallbackInterpret(state, errBox);
  errBox.textContent = '解读流意外结束，请稍后重试';
  errBox.hidden = false;
  return null;
}

// ---------- 保存 ----------

export async function saveReading(state: SessionState, errBox: HTMLElement): Promise<{ reading: { id: string } } | null> {
  errBox.hidden = true;
  try {
    const payload = buildPayloadFromState(state) as Record<string, unknown>;
    if (state.interpretation) payload.ai_interpretation = JSON.stringify(state.interpretation);
    const res = await api<{ reading: { id: string } }>('/api/readings', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    state.savedId = res.reading.id;
    return res;
  } catch (err) {
    const message = err instanceof ApiError ? err.message : '保存失败，请稍后重试';
    errBox.textContent = message;
    errBox.hidden = false;
    return null;
  }
}

// ---------- 牌阵选择 / 标签 ----------

export function mountSpreadPicker(container: HTMLElement, onPick: (id: SpreadId) => void): void {
  container.innerHTML = '';
  for (const id of SPREAD_IDS) {
    const spread = getSpread(id);
    if (!spread) continue;
    const b = el('button', 'btn secondary');
    b.type = 'button';
    b.style.margin = '0 8px 8px 0';
    b.dataset.spread = id;
    b.textContent = `${spread.nameZh}（${spread.positions.length} 张）`;
    b.title = spread.descriptionZh;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      selectSpread(container, id);
      onPick(id);
    });
    container.appendChild(b);
  }
}

/** 高亮指定牌阵（恢复草稿时程序化选中） */
export function selectSpread(container: HTMLElement, id: SpreadId): void {
  for (const other of Array.from(container.children)) {
    const button = other as HTMLButtonElement;
    button.style.borderColor = '';
    button.setAttribute('aria-pressed', 'false');
  }
  const target = container.querySelector<HTMLButtonElement>(`[data-spread="${id}"]`);
  if (target) {
    target.style.borderColor = 'var(--accent)';
    target.setAttribute('aria-pressed', 'true');
  }
}

export function mountTagSelect(select: HTMLSelectElement, values: readonly string[], placeholder: string): void {
  select.innerHTML = '';
  select.appendChild(new Option(placeholder, ''));
  for (const v of values) select.appendChild(new Option(v, v));
}

export { TOPIC_TAGS, MOOD_TAGS };
