import { ALL_CARDS, getCard, getSpread, MOOD_TAGS, TOPIC_TAGS } from '@tarot/shared';
import type { DrawnCard, SpreadId } from '@tarot/shared';
import { api } from '../lib/api';
import {
  buildPayloadFromState,
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

let picked: DrawnCard[] = [];

mountTagSelect(document.getElementById('topic') as HTMLSelectElement, TOPIC_TAGS, '不选择');
mountTagSelect(document.getElementById('mood') as HTMLSelectElement, MOOD_TAGS, '不选择');

mountSpreadPicker(document.getElementById('spread-picker') as HTMLDivElement, (id: SpreadId) => {
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
    for (const c of cards) select.appendChild(new Option(`${c.nameZh}（${c.name}）`, c.id));
    const current = picked[i].card;
    if (current) select.value = current;
    select.addEventListener('change', () => {
      picked[i].card = select.value;
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
    oriCheck.addEventListener('change', () => {
      picked[i].orientation = oriCheck.checked ? 'reversed' : 'upright';
    });
    oriWrap.appendChild(oriCheck);
    oriWrap.appendChild(document.createTextNode('逆位'));
    wrap.appendChild(oriWrap);

    positionList.appendChild(wrap);
  });
}

searchInput.addEventListener('input', () => renderPositionList(searchInput.value));

document.getElementById('confirm-btn')?.addEventListener('click', () => {
  const q = (document.getElementById('question') as HTMLTextAreaElement).value.trim();
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
  resultArea.hidden = true;
  interpretOut.hidden = true;
  state.question = q;
  state.topic = (document.getElementById('topic') as HTMLSelectElement).value || null;
  state.mood = (document.getElementById('mood') as HTMLSelectElement).value || null;
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
  void api; // 保持 api 引用（构建器消除未用提示）
});

document.getElementById('interpret-btn')?.addEventListener('click', (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  btn.setAttribute('disabled', 'true');
  btn.textContent = '解读中…';
  requestInterpret(state, interpretErr).then((text) => {
    btn.removeAttribute('disabled');
    btn.textContent = '请求 AI 解读';
    if (text !== null) {
      interpretText.textContent = text;
      interpretOut.hidden = false;
    }
  });
});

document.getElementById('save-btn')?.addEventListener('click', (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  btn.setAttribute('disabled', 'true');
  void buildPayloadFromState(state);
  saveReading(state, interpretErr).then((reading) => {
    btn.removeAttribute('disabled');
    if (reading) {
      saveMsg.textContent = '已保存。可在「历史」页查看或补充备注。';
      saveMsg.hidden = false;
    }
  });
});
