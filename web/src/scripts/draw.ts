import type { QuotaInfo, SpreadId } from '@tarot/shared';
import { api } from '../lib/api';
import { MOOD_TAGS, TOPIC_TAGS } from '@tarot/shared';
import { clearDraft, draftIsMeaningful, fmtDraftTime, guardUnsaved, loadDraft, saveDraft, type Draft } from '../lib/draft';
import { ProgressiveInterpretation } from '../lib/interpret-render';
import { getCard, getSpread } from '@tarot/shared';
import {
  createState,
  mountSpreadPicker,
  mountTagSelect,
  renderCardPool,
  renderSpreadArea,
  requestInterpret,
  saveReading,
  selectSpread,
  shuffleDeck,
} from './tarot-core';

// 线上抽牌：手动选牌（A1）→ 逐张翻牌 → AI 流式解读（A4）→ 保存。
// 草稿防丢（A6）+ 最近记录上下文（B3，默认关闭）。

const state = createState('online');
const DRAFT_KEY = 'tq_draft_online';

const quotaLine = document.getElementById('quota-line') as HTMLDivElement;
const mustChange = document.getElementById('must-change') as HTMLDivElement;
const actionArea = document.getElementById('action-area') as HTMLDivElement;
const draftNotice = document.getElementById('draft-notice') as HTMLDivElement;
const restoreBox = document.getElementById('restore-box') as HTMLDivElement;
const restoreText = document.getElementById('restore-text') as HTMLParagraphElement;
const restoreBtn = document.getElementById('restore-btn') as HTMLButtonElement;
const discardBtn = document.getElementById('discard-btn') as HTMLButtonElement;
const spreadArea = document.getElementById('spread-area') as HTMLDivElement;
const poolArea = document.getElementById('pool-area') as HTMLDivElement;
const resultArea = document.getElementById('result-area') as HTMLDivElement;
const interpretErr = document.getElementById('interpret-err') as HTMLDivElement;
const interpretOut = document.getElementById('interpret-out') as HTMLDivElement;
const interpretText = document.getElementById('interpret-text') as HTMLDivElement;
const saveMsg = document.getElementById('save-msg') as HTMLDivElement;
const questionInput = document.getElementById('question') as HTMLTextAreaElement;
const topicSelect = document.getElementById('topic') as HTMLSelectElement;
const moodSelect = document.getElementById('mood') as HTMLSelectElement;
const contextConsent = document.getElementById('context-consent') as HTMLInputElement;
const interpretBtn = document.getElementById('interpret-btn') as HTMLButtonElement;
const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;

let quotaAvailable = false;
let streaming: ProgressiveInterpretation | null = null;

mountTagSelect(topicSelect, TOPIC_TAGS, '不选择');
mountTagSelect(moodSelect, MOOD_TAGS, '不选择');

// B3 勾选状态持久化（仅记住偏好，勾选即视为对该次解读的明示同意）
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
  poolArea.innerHTML = '';
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
  resetReading('问题、标签或牌阵已更改，请重新选牌。');
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

// A1：洗牌 → 牌背池 → 手动选牌
document.getElementById('draw-btn')?.addEventListener('click', () => {
  const q = getQuestion();
  if (!q) {
    interpretErr.textContent = '请先写下你想问的问题。';
    interpretErr.hidden = false;
    return;
  }
  if (!state.spread) return;
  const spread = getSpread(state.spread);
  if (!spread) return;
  interpretErr.hidden = true;
  saveMsg.hidden = true;
  resetReading();
  state.question = q;
  state.topic = topicSelect.value || null;
  state.mood = moodSelect.value || null;
  state.includeContext = contextConsent.checked;
  actionArea.hidden = true;
  renderCardPool(
    poolArea,
    spread.positions.length,
    shuffleDeck(),
    (picked) => {
      // 确认选牌：进入翻牌阶段
      poolArea.innerHTML = '';
      state.cards = picked;
      renderSpreadArea(spreadArea, state, { interactive: true });
      resultArea.hidden = false;
      resultArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
      persistDraft();
    },
    state.spread
  );
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
    void loadQuota(); // 成功或失败都刷新额度行
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
  restoreText.textContent = `检测到未保存的抽牌记录（${fmtDraftTime(d!.ts)}，${spread?.nameZh ?? ''} ${d!.cards.length} 张牌${d!.interpretation ? '，含解读' : ''}）。`;
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
    actionArea.hidden = false;
  }
  state.question = draft.question ?? null;
  state.topic = draft.topic ?? null;
  state.mood = draft.mood ?? null;
  state.cards = draft.cards;
  state.interpretation = draft.interpretation;
  renderSpreadArea(spreadArea, state, { interactive: true });
  resultArea.hidden = false;
  if (state.interpretation) {
    interpretOut.hidden = false;
    streaming = null;
    import('../lib/interpret-render').then(({ renderInterpretation }) => {
      renderInterpretation(interpretText, state.interpretation!);
    });
  }
  restoreBox.hidden = true;
  draftNotice.textContent = '已恢复草稿。问题或标签的修改会使草稿失效。';
  draftNotice.hidden = false;
  void loadQuota();
});

discardBtn.addEventListener('click', () => {
  clearDraft(DRAFT_KEY);
  restoreBox.hidden = true;
});

void showRestoreBox();
