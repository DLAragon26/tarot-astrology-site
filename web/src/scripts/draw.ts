import type { QuotaInfo, SpreadId } from '@tarot/shared';
import { api } from '../lib/api';
import { MOOD_TAGS, TOPIC_TAGS } from '@tarot/shared';
import {
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
const draftNotice = document.getElementById('draft-notice') as HTMLDivElement;
const spreadArea = document.getElementById('spread-area') as HTMLDivElement;
const resultArea = document.getElementById('result-area') as HTMLDivElement;
const interpretErr = document.getElementById('interpret-err') as HTMLDivElement;
const interpretOut = document.getElementById('interpret-out') as HTMLDivElement;
const interpretText = document.getElementById('interpret-text') as HTMLParagraphElement;
const saveMsg = document.getElementById('save-msg') as HTMLDivElement;
const questionInput = document.getElementById('question') as HTMLTextAreaElement;
const topicSelect = document.getElementById('topic') as HTMLSelectElement;
const moodSelect = document.getElementById('mood') as HTMLSelectElement;
const interpretBtn = document.getElementById('interpret-btn') as HTMLButtonElement;
const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;

let revealTimer: number | undefined;
let quotaAvailable = false;

mountTagSelect(document.getElementById('topic') as HTMLSelectElement, TOPIC_TAGS, '不选择');
mountTagSelect(document.getElementById('mood') as HTMLSelectElement, MOOD_TAGS, '不选择');

function resetReading(message?: string): void {
  if (revealTimer !== undefined) {
    window.clearTimeout(revealTimer);
    revealTimer = undefined;
  }
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
  resetReading('问题、标签或牌阵已更改，请重新抽牌。');
}

mountSpreadPicker(document.getElementById('spread-picker') as HTMLDivElement, (id: SpreadId) => {
  resetReading();
  state.spread = id;
  actionArea.hidden = false;
});

questionInput.addEventListener('input', invalidateDraft);
topicSelect.addEventListener('change', invalidateDraft);
moodSelect.addEventListener('change', invalidateDraft);

// 额度提示（成功/失败解读后都会刷新）
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

// 首次引导登录后的改密提示：文案按角色区分（管理员自己改，成员找管理员）
api<{ user: { role: string; must_change_password: boolean } }>('/api/me')
  .then(({ user }) => {
    if (user.must_change_password) {
      mustChange.textContent =
        user.role === 'admin'
          ? '你正在使用初始密码。请在「管理」页重置自己的密码。'
          : '你正在使用初始密码。请联系管理员为你重置密码。';
      mustChange.hidden = false;
    }
  })
  .catch(() => {});

function getQuestion(): string | null {
  const q = questionInput.value.trim();
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
  resetReading();
  actionArea.hidden = false;
  resultArea.hidden = true;
  interpretOut.hidden = true;
  state.question = q;
  state.topic = topicSelect.value || null;
  state.mood = moodSelect.value || null;
  state.interpretation = null;
  state.savedId = null;
  state.cards = drawRandom(state.spread);
  renderSpreadArea(spreadArea, state, { interactive: false });
  revealTimer = window.setTimeout(() => {
    resultArea.hidden = false;
    revealTimer = undefined;
  }, 200 + state.cards.length * 450);
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
    void loadQuota(); // 成功或失败都刷新额度行
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
