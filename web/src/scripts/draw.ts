import type { QuotaInfo, SpreadId } from '@tarot/shared';
import { api } from '../lib/api';
import { MOOD_TAGS, TOPIC_TAGS } from '@tarot/shared';
import {
  buildPayloadFromState,
  createState,
  drawRandom,
  mountSpreadPicker,
  mountTagSelect,
  renderSpreadArea,
  requestInterpret,
  saveReading,
} from './tarot-core';

const state = createState('online');

const quotaLine = document.getElementById('quota-line') as HTMLDivElement;
const mustChange = document.getElementById('must-change') as HTMLDivElement;
const actionArea = document.getElementById('action-area') as HTMLDivElement;
const spreadArea = document.getElementById('spread-area') as HTMLDivElement;
const resultArea = document.getElementById('result-area') as HTMLDivElement;
const interpretErr = document.getElementById('interpret-err') as HTMLDivElement;
const interpretOut = document.getElementById('interpret-out') as HTMLDivElement;
const interpretText = document.getElementById('interpret-text') as HTMLParagraphElement;
const saveMsg = document.getElementById('save-msg') as HTMLDivElement;

mountTagSelect(document.getElementById('topic') as HTMLSelectElement, TOPIC_TAGS, '不选择');
mountTagSelect(document.getElementById('mood') as HTMLSelectElement, MOOD_TAGS, '不选择');

mountSpreadPicker(document.getElementById('spread-picker') as HTMLDivElement, (id: SpreadId) => {
  state.spread = id;
  actionArea.hidden = false;
  spreadArea.innerHTML = '';
  resultArea.hidden = true;
});

// 额度提示
api<{ quota: QuotaInfo }>('/api/quota')
  .then(({ quota }) => {
    quotaLine.textContent =
      quota.daily_limit === -1
        ? `管理员账号 · AI 解读无个人上限 · 今日全站 ${quota.global_used_today}/${quota.global_limit} · 每日午夜（Asia/Shanghai）重置`
        : `今日 AI 解读额度：已用 ${quota.used_today}/${quota.daily_limit} · 全站 ${quota.global_used_today}/${quota.global_limit} · 每日午夜（Asia/Shanghai）重置`;
  })
  .catch(() => {});

if (sessionStorage.getItem('must_change_password')) {
  mustChange.hidden = false;
  sessionStorage.removeItem('must_change_password');
}

function getQuestion(): string | null {
  const q = (document.getElementById('question') as HTMLTextAreaElement).value.trim();
  return q.length > 0 ? q : null;
}

document.getElementById('draw-btn')?.addEventListener('click', () => {
  const q = getQuestion();
  if (!q) {
    interpretErr.textContent = '请先写下你想问的问题。';
    interpretErr.hidden = false;
    return;
  }
  if (!state.spread) return;
  interpretErr.hidden = true;
  saveMsg.hidden = true;
  resultArea.hidden = true;
  interpretOut.hidden = true;
  state.question = q;
  state.topic = (document.getElementById('topic') as HTMLSelectElement).value || null;
  state.mood = (document.getElementById('mood') as HTMLSelectElement).value || null;
  state.interpretation = null;
  state.savedId = null;
  state.cards = drawRandom(state.spread);
  renderSpreadArea(spreadArea, state, { interactive: false });
  setTimeout(() => {
    resultArea.hidden = false;
  }, 200 + state.cards.length * 450);
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
  if (!getQuestion()) {
    interpretErr.textContent = '请先填写问题再保存。';
    interpretErr.hidden = false;
    return;
  }
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
