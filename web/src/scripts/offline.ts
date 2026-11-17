import { ALL_CARDS, getCard, getSpread, MOOD_TAGS, TOPIC_TAGS } from '@tarot/shared';
import type { DrawnCard, QuotaInfo, SpreadId } from '@tarot/shared';
import { api } from '../lib/api';
import {
  createState,
  mountSpreadPicker,
  mountTagSelect,
  renderSpreadArea,
  requestInterpret,
  saveReading,
} from './tarot-core';

const state = createState('offline');

const cardsForm = document.getElementById('cards-form') as HTMLDivElement;
const positionList = document.getElementById('position-list') as HTMLDivElement;
const spreadArea = document.getElementById('spread-area') as HTMLDivElement;
const resultArea = document.getElementById('result-area') as HTMLDivElement;
const interpretErr = document.getElementById('interpret-err') as HTMLDivElement;
const interpretOut = document.getElementById('interpret-out') as HTMLDivElement;
const interpretText = document.getElementById('interpret-text') as HTMLParagraphElement;
const saveMsg = document.getElementById('save-msg') as HTMLDivElement;
const searchInput = document.getElementById('card-search') as HTMLInputElement;
const questionInput = document.getElementById('question') as HTMLTextAreaElement;
const topicSelect = document.getElementById('topic') as HTMLSelectElement;
const moodSelect = document.getElementById('mood') as HTMLSelectElement;
const draftNotice = document.getElementById('draft-notice') as HTMLDivElement;
const quotaLine = document.getElementById('quota-line') as HTMLDivElement;
const interpretBtn = document.getElementById('interpret-btn') as HTMLButtonElement;
const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;

let picked: DrawnCard[] = [];
let quotaAvailable = false;

mountTagSelect(document.getElementById('topic') as HTMLSelectElement, TOPIC_TAGS, '不选择');
mountTagSelect(document.getElementById('mood') as HTMLSelectElement, MOOD_TAGS, '不选择');

function resetReading(message?: string): void {
  state.cards = [];
  state.interpretation = null;
  state.question = null;
  state.topic = null;
  state.mood = null;
  state.savedId = null;
  spreadArea.innerHTML = '';
  resultArea.hidden = true;
  interpretOut.hidden = true;
  interpretText.textContent = '';
  interpretErr.hidden = true;
  saveMsg.hidden = true;
  saveBtn.disabled = false;
  saveBtn.textContent = '保存记录';
  interpretBtn.disabled = !quotaAvailable;
  interpretBtn.textContent = '请求 AI 解读';
  draftNotice.textContent = message ?? '';
  draftNotice.hidden = !message;
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
    const currentCard = getCard(picked[i].card);
    if (currentCard && !cards.some((c) => c.id === currentCard.id)) cards.unshift(currentCard);
    for (const c of cards) select.appendChild(new Option(`${c.nameZh}（${c.name}）`, c.id));
    const current = picked[i].card;
    if (current) select.value = current;
    select.addEventListener('change', () => {
      picked[i].card = select.value;
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
    oriCheck.checked = picked[i].orientation === 'reversed';
    oriCheck.addEventListener('change', () => {
      picked[i].orientation = oriCheck.checked ? 'reversed' : 'upright';
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
  state.interpretation = null;
  state.savedId = null;
  state.cards = picked.map((p) => ({ ...p }));
  renderSpreadArea(spreadArea, state, { interactive: false });
  // 打开卡面图校验一遍（确保牌名都能被后端接受）
  for (const c of state.cards) {
    if (!getCard(c.card)) {
      interpretErr.textContent = `存在无效牌名：${c.card}`;
      interpretErr.hidden = false;
      return;
    }
  }
  resultArea.hidden = false;
});

interpretBtn.addEventListener('click', (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  if (state.savedId || !quotaAvailable) return;
  btn.setAttribute('disabled', 'true');
  btn.textContent = '解读中…';
  requestInterpret(state, interpretErr).then((text) => {
    btn.removeAttribute('disabled');
    btn.textContent = '请求 AI 解读';
    if (text !== null) {
      interpretText.textContent = text;
      interpretOut.hidden = false;
    }
    void loadQuota();
  });
});

saveBtn.addEventListener('click', (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  if (state.savedId) return;
  btn.setAttribute('disabled', 'true');
  saveReading(state, interpretErr).then((reading) => {
    if (reading) {
      btn.textContent = '已保存';
      btn.disabled = true;
      interpretBtn.disabled = true;
      saveMsg.textContent = '已保存。可在「历史」页查看或补充备注。';
      saveMsg.hidden = false;
    } else {
      btn.removeAttribute('disabled');
    }
  });
});
