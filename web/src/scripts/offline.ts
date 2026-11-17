import { ALL_CARDS, getCard, getSpread, MOOD_TAGS, TOPIC_TAGS } from '@tarot/shared';
import type { DrawnCard, QuotaInfo, SpreadId } from '@tarot/shared';
import { api } from '../lib/api';
import { clearDraft, draftIsMeaningful, fmtDraftTime, guardUnsaved, loadDraft, saveDraft, type Draft } from '../lib/draft';
import { ProgressiveInterpretation, renderInterpretation } from '../lib/interpret-render';
import {
  createState,
  mountSpreadPicker,
  mountTagSelect,
  renderSpreadArea,
  requestInterpret,
  saveReading,
  selectSpread,
} from './tarot-core';

// 线下排面录入：手动记录实际牌面 → AI 流式解读 → 保存。
// 草稿防丢（A6，含确认前的暂选）+ 最近记录上下文（B3，默认关闭）。

const state = createState('offline');
const DRAFT_KEY = 'tq_draft_offline';

const cardsForm = document.getElementById('cards-form') as HTMLDivElement;
const positionList = document.getElementById('position-list') as HTMLDivElement;
const spreadArea = document.getElementById('spread-area') as HTMLDivElement;
const resultArea = document.getElementById('result-area') as HTMLDivElement;
const interpretErr = document.getElementById('interpret-err') as HTMLDivElement;
const interpretOut = document.getElementById('interpret-out') as HTMLDivElement;
const interpretText = document.getElementById('interpret-text') as HTMLDivElement;
const saveMsg = document.getElementById('save-msg') as HTMLDivElement;
const searchInput = document.getElementById('card-search') as HTMLInputElement;
const questionInput = document.getElementById('question') as HTMLTextAreaElement;
const topicSelect = document.getElementById('topic') as HTMLSelectElement;
const moodSelect = document.getElementById('mood') as HTMLSelectElement;
const contextConsent = document.getElementById('context-consent') as HTMLInputElement;
const draftNotice = document.getElementById('draft-notice') as HTMLDivElement;
const restoreBox = document.getElementById('restore-box') as HTMLDivElement;
const restoreText = document.getElementById('restore-text') as HTMLParagraphElement;
const restoreBtn = document.getElementById('restore-btn') as HTMLButtonElement;
const discardBtn = document.getElementById('discard-btn') as HTMLButtonElement;
const quotaLine = document.getElementById('quota-line') as HTMLDivElement;
const interpretBtn = document.getElementById('interpret-btn') as HTMLButtonElement;
const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;

let picked: DrawnCard[] = [];
let quotaAvailable = false;
let streaming: ProgressiveInterpretation | null = null;

mountTagSelect(topicSelect, TOPIC_TAGS, '不选择');
mountTagSelect(moodSelect, MOOD_TAGS, '不选择');

try {
  contextConsent.checked = localStorage.getItem('tq_context_consent') === '1';
} catch {
  /* ignore */
}
contextConsent.addEventListener('change', () => {
  try {
    localStorage.setItem('tq_context_consent', contextConsent.checked ? '1' : '0');
  } catch {
    /* ignore */
  }
});

function currentDraft(): Draft {
  return {
    ts: Date.now(),
    question: state.question ?? '',
    topic: state.topic,
    mood: state.mood,
    spread: state.spread,
    cards: state.cards,
    picked,
    interpretation: state.interpretation,
    savedId: state.savedId,
  };
}

function persistDraft(): void {
  if (state.cards.length === 0) return;
  saveDraft(DRAFT_KEY, currentDraft());
}

function resetReading(message?: string): void {
  state.cards = [];
  state.interpretation = null;
  state.question = null;
  state.topic = null;
  state.mood = null;
  state.savedId = null;
  streaming = null;
  spreadArea.innerHTML = '';
  resultArea.hidden = true;
  interpretOut.hidden = true;
  interpretText.innerHTML = '';
  interpretErr.hidden = true;
  saveMsg.hidden = true;
  saveBtn.disabled = false;
  saveBtn.textContent = '保存记录';
  interpretBtn.disabled = !quotaAvailable;
  interpretBtn.textContent = '请求 AI 解读';
  draftNotice.textContent = message ?? '';
  draftNotice.hidden = !message;
  clearDraft(DRAFT_KEY);
}

function invalidateDraft(): void {
  if (state.cards.length === 0) return;
  resetReading('问题、标签、牌面或位置已更改，请重新点击「确认牌面」。');
}

mountSpreadPicker(document.getElementById('spread-picker') as HTMLDivElement, (id: SpreadId) => {
  resetReading();
  state.spread = id;
  const spread = getSpread(id);
  if (!spread) return;
  picked = spread.positions.map((p) => ({ position: p.key, card: '', orientation: 'upright' as const }));
  renderPositionList('');
  cardsForm.hidden = false;
  spreadArea.innerHTML = '';
  resultArea.hidden = true;
});

function renderPositionList(filter: string): void {
  const spread = getSpread(state.spread ?? '');
  if (!spread) return;
  positionList.innerHTML = '';
  const f = filter.trim().toLowerCase();
  spread.positions.forEach((pos, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'panel';
    wrap.appendChild(Object.assign(document.createElement('strong'), { textContent: `${i + 1}. ${pos.labelZh}` }));

    const select = document.createElement('select');
    select.dataset.pos = pos.key;
    select.appendChild(new Option('选择这张牌…', ''));
    const cards = ALL_CARDS.filter((c) => {
      if (!f) return true;
      return c.nameZh.includes(filter.trim()) || c.name.toLowerCase().includes(f) || c.id.includes(f);
    });
    const currentCard = getCard(picked[i]?.card ?? '');
    if (currentCard && !cards.some((c) => c.id === currentCard.id)) cards.unshift(currentCard);
    for (const c of cards) select.appendChild(new Option(`${c.nameZh}（${c.name}）`, c.id));
    const current = picked[i]?.card;
    if (current) select.value = current;
    select.addEventListener('change', () => {
      picked[i] = { ...(picked[i] ?? { position: pos.key, orientation: 'upright' as const }), card: select.value };
      invalidateDraft();
    });
    wrap.appendChild(select);

    const oriWrap = document.createElement('label');
    oriWrap.className = 'field';
    oriWrap.style.display = 'flex';
    oriWrap.style.alignItems = 'center';
    oriWrap.style.gap = '8px';
    const oriCheck = document.createElement('input');
    oriCheck.type = 'checkbox';
    oriCheck.id = `ori-${pos.key}`;
    oriCheck.style.width = 'auto';
    oriCheck.checked = picked[i]?.orientation === 'reversed';
    oriCheck.addEventListener('change', () => {
      picked[i] = { ...(picked[i] ?? { position: pos.key, card: '' }), orientation: oriCheck.checked ? 'reversed' : 'upright' };
      invalidateDraft();
    });
    oriWrap.appendChild(oriCheck);
    oriWrap.appendChild(document.createTextNode('逆位'));
    wrap.appendChild(oriWrap);

    positionList.appendChild(wrap);
  });
}

searchInput.addEventListener('input', () => renderPositionList(searchInput.value));
questionInput.addEventListener('input', invalidateDraft);
topicSelect.addEventListener('change', invalidateDraft);
moodSelect.addEventListener('change', invalidateDraft);

async function loadQuota(): Promise<void> {
  try {
    const { quota } = await api<{ quota: QuotaInfo }>('/api/quota');
    quotaAvailable = quota.remaining > 0;
    quotaLine.textContent =
      quota.daily_limit === 0 && quota.used_today === 0
        ? `今日 AI 额度尚未分配（0/0）· 请联系管理员 · 全站 ${quota.global_used_today}/${quota.global_limit}`
        : `今日 AI 解读额度：已用 ${quota.used_today}/${quota.daily_limit} · 剩余 ${quota.remaining} · 全站 ${quota.global_used_today}/${quota.global_limit} · 每日午夜（Asia/Shanghai）重置`;
    interpretBtn.disabled = !quotaAvailable || state.savedId !== null;
  } catch {
    quotaAvailable = false;
    interpretBtn.disabled = true;
  }
}
void loadQuota();

document.getElementById('confirm-btn')?.addEventListener('click', () => {
  const q = questionInput.value.trim();
  if (!q) {
    interpretErr.textContent = '请先记录当时的问题。';
    interpretErr.hidden = false;
    return;
  }
  if (picked.some((p) => !p.card)) {
    interpretErr.textContent = '还有位置没有选择牌。';
    interpretErr.hidden = false;
    return;
  }
  interpretErr.hidden = true;
  saveMsg.hidden = true;
  resetReading();
  state.question = q;
  state.topic = topicSelect.value || null;
  state.mood = moodSelect.value || null;
  state.includeContext = contextConsent.checked;
  state.cards = picked.map((p) => ({ ...p }));
  // 打开卡面图校验一遍（确保牌名都能被后端接受）
  for (const c of state.cards) {
    if (!getCard(c.card)) {
      interpretErr.textContent = `存在无效牌名：${c.card}`;
      interpretErr.hidden = false;
      return;
    }
  }
  renderSpreadArea(spreadArea, state, { interactive: false });
  resultArea.hidden = false;
  persistDraft();
});

interpretBtn.addEventListener('click', (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  if (state.savedId || !quotaAvailable) return;
  btn.setAttribute('disabled', 'true');
  btn.textContent = '解读生成中…';
  interpretOut.hidden = false;
  streaming = new ProgressiveInterpretation(
    interpretText,
    state.cards.map((drawn, i) => {
      const spread = getSpread(state.spread ?? '');
      const pos = spread?.positions[i];
      const card = getCard(drawn.card);
      return {
        position: pos?.labelZh ?? drawn.position,
        name: card?.nameZh ?? drawn.card,
        orientation: drawn.orientation === 'upright' ? '正位' : '逆位',
      };
    })
  );
  void requestInterpret(state, interpretErr, (accumulated) => streaming?.push(accumulated)).then((payload) => {
    btn.removeAttribute('disabled');
    btn.textContent = '请求 AI 解读';
    if (payload !== null) {
      streaming?.finalize(payload);
      persistDraft();
    } else if (streaming) {
      streaming.fail(interpretErr.hidden ? '解读请求失败，请稍后重试。' : interpretErr.textContent || '解读请求失败。');
    }
    void loadQuota();
  });
});

saveBtn.addEventListener('click', (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  if (state.savedId) return;
  btn.setAttribute('disabled', 'true');
  void saveReading(state, interpretErr).then((reading) => {
    if (reading) {
      btn.textContent = '已保存';
      btn.disabled = true;
      interpretBtn.disabled = true;
      saveMsg.textContent = '已保存。可在「历史」页查看或补充备注。';
      saveMsg.hidden = false;
      clearDraft(DRAFT_KEY);
    } else {
      btn.removeAttribute('disabled');
    }
  });
});

// ---------- A6 草稿恢复 ----------
guardUnsaved(DRAFT_KEY);

function showRestoreBox(): void {
  const d = loadDraft(DRAFT_KEY);
  if (!draftIsMeaningful(d)) return;
  const spread = d?.spread ? getSpread(d.spread) : null;
  restoreText.textContent = `检测到未保存的排面记录（${fmtDraftTime(d!.ts)}，${spread?.nameZh ?? ''} ${d!.cards.length} 张牌${d!.interpretation ? '，含解读' : ''}）。`;
  restoreBox.hidden = false;
}

restoreBtn.addEventListener('click', () => {
  const d = loadDraft(DRAFT_KEY);
  if (!draftIsMeaningful(d)) {
    restoreBox.hidden = true;
    return;
  }
  const draft = d!;
  questionInput.value = draft.question ?? '';
  topicSelect.value = draft.topic ?? '';
  moodSelect.value = draft.mood ?? '';
  if (draft.spread) {
    state.spread = draft.spread;
    selectSpread(document.getElementById('spread-picker') as HTMLDivElement, draft.spread);
  }
  picked = (draft.picked?.length ? draft.picked : draft.cards).map((p) => ({ ...p }));
  state.question = draft.question ?? null;
  state.topic = draft.topic ?? null;
  state.mood = draft.mood ?? null;
  state.cards = draft.cards;
  state.interpretation = draft.interpretation;
  renderPositionList('');
  cardsForm.hidden = false;
  if (state.cards.length > 0) {
    renderSpreadArea(spreadArea, state, { interactive: false });
    resultArea.hidden = false;
  }
  if (state.interpretation) {
    interpretOut.hidden = false;
    streaming = null;
    renderInterpretation(interpretText, state.interpretation);
  }
  restoreBox.hidden = true;
  draftNotice.textContent = '已恢复草稿。任何修改会使草稿失效，请重新「确认牌面」。';
  draftNotice.hidden = false;
  void loadQuota();
});

discardBtn.addEventListener('click', () => {
  clearDraft(DRAFT_KEY);
  restoreBox.hidden = true;
});

void showRestoreBox();
