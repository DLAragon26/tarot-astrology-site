import { getCard, getSpread, TOPIC_TAGS } from '@tarot/shared';
import type { Reading } from '@tarot/shared';
import { ApiError, api, attachImageFallback, cardImageSrc, el, fmtDate } from '../lib/api';
import { parseStoredInterpretation, renderInterpretation } from '../lib/interpret-render';

// 历史记录（A7）：关键词搜索 + 紧凑列表 + 详情弹窗 + JSON/Markdown 导出。

const list = document.getElementById('list') as HTMLDivElement;
const empty = document.getElementById('empty') as HTMLDivElement;
const moreBtn = document.getElementById('more-btn') as HTMLButtonElement;
const errBox = document.getElementById('err') as HTMLDivElement;
const filterMode = document.getElementById('filter-mode') as HTMLSelectElement;
const filterTopic = document.getElementById('filter-topic') as HTMLSelectElement;
const filterScope = document.getElementById('filter-scope') as HTMLSelectElement;
const scopeWrap = document.getElementById('scope-wrap') as HTMLDivElement;
const searchInput = document.getElementById('search-input') as HTMLInputElement;
const exportJsonBtn = document.getElementById('export-json') as HTMLButtonElement;
const exportMdBtn = document.getElementById('export-md') as HTMLButtonElement;
const detailDialog = document.getElementById('detail-dialog') as HTMLDialogElement;
const detailBody = document.getElementById('detail-body') as HTMLDivElement;
const detailClose = document.getElementById('detail-close') as HTMLButtonElement;

let offset = 0;
let exhausted = false;
let requestSeq = 0;
let searchTimer: number | undefined;
const allReadings: Reading[] = [];
for (const t of TOPIC_TAGS) filterTopic.appendChild(new Option(t, t));

function currentParams(limit: number, offsetValue: number): string {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offsetValue),
    scope: filterScope.value,
  });
  if (filterMode.value) params.set('mode', filterMode.value);
  if (filterTopic.value) params.set('topic', filterTopic.value);
  const q = searchInput.value.trim();
  if (q) params.set('q', q);
  return params.toString();
}

async function load(reset: boolean): Promise<void> {
  if (reset) {
    offset = 0;
    exhausted = false;
    allReadings.length = 0;
    list.innerHTML = '';
  }
  const seq = ++requestSeq;
  errBox.hidden = true;
  try {
    const res = await api<{ items: Reading[]; total: number }>(`/api/readings?${currentParams(20, offset)}`);
    if (seq !== requestSeq) return;
    allReadings.push(...res.items);
    offset += res.items.length;
    exhausted = allReadings.length >= res.total;
    render();
  } catch (err) {
    errBox.textContent = err instanceof ApiError ? err.message : '加载失败';
    errBox.hidden = false;
  }
}

/** 紧凑列表项：头部信息 + 问题 + 小图缩略；点击打开详情弹窗 */
function readingCard(r: Reading): HTMLElement {
  const wrap = el('div', 'panel history-item');
  wrap.tabIndex = 0;
  wrap.setAttribute('role', 'button');
  wrap.setAttribute('aria-label', '查看记录详情');
  const head = el('p');
  head.appendChild(el('strong', undefined, fmtDate(r.created_at)));
  head.appendChild(document.createTextNode(' · '));
  head.appendChild(document.createTextNode(r.mode === 'online' ? '线上抽牌' : '线下录入'));
  head.appendChild(document.createTextNode(' · '));
  head.appendChild(document.createTextNode(getSpread(r.spread)?.nameZh ?? r.spread));
  if (r.topic_tag) head.appendChild(document.createTextNode(' '));
  if (r.topic_tag) head.appendChild(el('span', 'tag', r.topic_tag));
  if (r.mood_tag) head.appendChild(document.createTextNode(' '));
  if (r.mood_tag) head.appendChild(el('span', 'tag', r.mood_tag));
  wrap.appendChild(head);
  wrap.appendChild(el('p', undefined, r.question));

  const thumbs = el('div', 'spread-row history-thumbs');
  r.cards.forEach((drawn) => {
    const card = getCard(drawn.card);
    const img = document.createElement('img');
    const srcs = cardImageSrc(drawn.card);
    img.src = srcs.src;
    img.alt = card?.nameZh ?? drawn.card;
    img.loading = 'lazy';
    if (drawn.orientation === 'reversed') img.classList.add('rev');
    attachImageFallback(img, srcs.fallback);
    thumbs.appendChild(img);
    const cap = el('div', 'muted', `${card?.nameZh ?? drawn.card} ${drawn.orientation === 'reversed' ? '逆' : '正'}`);
    cap.style.fontSize = '11px';
    cap.style.textAlign = 'center';
    thumbs.appendChild(cap);
  });
  wrap.appendChild(thumbs);

  if (r.user_note) {
    const note = el('p', 'muted', `备注：${r.user_note.length > 80 ? `${r.user_note.slice(0, 80)}…` : r.user_note}`);
    wrap.appendChild(note);
  }

  const open = (): void => openDetail(r);
  wrap.addEventListener('click', open);
  wrap.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  });
  return wrap;
}

function render(): void {
  list.innerHTML = '';
  empty.textContent =
    filterMode.value || filterTopic.value || searchInput.value.trim()
      ? '没有符合筛选条件的记录。'
      : '还没有记录。';
  empty.hidden = allReadings.length > 0;
  for (const r of allReadings) list.appendChild(readingCard(r));
  moreBtn.hidden = exhausted;
}

// ---------- 详情弹窗 ----------

function openDetail(r: Reading): void {
  detailBody.innerHTML = '';
  const head = el('p');
  head.appendChild(el('strong', undefined, fmtDate(r.created_at)));
  head.appendChild(document.createTextNode(' · '));
  head.appendChild(document.createTextNode(r.mode === 'online' ? '线上抽牌' : '线下录入'));
  head.appendChild(document.createTextNode(' · '));
  head.appendChild(document.createTextNode(getSpread(r.spread)?.nameZh ?? r.spread));
  if (r.topic_tag) head.appendChild(el('span', 'tag', r.topic_tag));
  if (r.mood_tag) head.appendChild(document.createTextNode(' '));
  if (r.mood_tag) head.appendChild(el('span', 'tag', r.mood_tag));
  detailBody.appendChild(head);

  const q = el('p');
  q.appendChild(el('strong', undefined, '问题：'));
  q.appendChild(document.createTextNode(r.question));
  detailBody.appendChild(q);

  const spread = getSpread(r.spread);
  const thumbs = el('div', 'spread-row detail-thumbs');
  r.cards.forEach((drawn, i) => {
    const card = getCard(drawn.card);
    const cell = el('div');
    cell.style.width = '110px';
    cell.style.textAlign = 'center';
    const img = document.createElement('img');
    const srcs = cardImageSrc(drawn.card);
    img.src = srcs.src;
    img.alt = card?.nameZh ?? drawn.card;
    if (drawn.orientation === 'reversed') img.classList.add('rev');
    attachImageFallback(img, srcs.fallback);
    cell.appendChild(img);
    const cap = el('div', 'muted', `${spread?.positions[i]?.labelZh ?? ''} ${card?.nameZh ?? drawn.card} ${drawn.orientation === 'reversed' ? '逆位' : '正位'}`);
    cap.style.fontSize = '11px';
    cell.appendChild(cap);
    thumbs.appendChild(cell);
  });
  detailBody.appendChild(thumbs);

  // 牌义
  r.cards.forEach((drawn, i) => {
    const card = getCard(drawn.card);
    const pos = spread?.positions[i];
    const p = el('div', 'panel');
    const headP = el('p');
    headP.appendChild(el('strong', undefined, `${pos?.labelZh ?? drawn.position} · ${card?.nameZh ?? drawn.card}（${drawn.orientation === 'upright' ? '正位' : '逆位'}）`));
    p.appendChild(headP);
    if (card) p.appendChild(el('p', undefined, drawn.orientation === 'upright' ? card.upright : card.reversed));
    detailBody.appendChild(p);
  });

  const stored = parseStoredInterpretation(r.ai_interpretation);
  if (stored) {
    const interpWrap = document.createElement('div');
    interpWrap.className = 'interp-section';
    renderInterpretation(interpWrap, stored);
    detailBody.appendChild(interpWrap);
  }

  // 备注编辑
  const noteLabel = el('label', 'field', '备注');
  detailBody.appendChild(noteLabel);
  const noteArea = document.createElement('textarea');
  noteArea.value = r.user_note ?? '';
  noteArea.placeholder = '补充备注…';
  noteArea.setAttribute('maxlength', '2000');
  detailBody.appendChild(noteArea);

  const actions = el('div');
  actions.style.marginTop = '12px';
  const saveNote = el('button', 'btn secondary', '保存备注') as HTMLButtonElement;
  const delBtn = el('button', 'btn secondary', '删除记录') as HTMLButtonElement;
  delBtn.style.marginLeft = '8px';
  delBtn.style.color = 'var(--danger)';
  let confirmDelete = false;
  delBtn.addEventListener('click', async () => {
    if (!confirmDelete) {
      confirmDelete = true;
      delBtn.textContent = '确认删除？';
      setTimeout(() => {
        confirmDelete = false;
        delBtn.textContent = '删除记录';
      }, 3000);
      return;
    }
    try {
      await api(`/api/readings/${r.id}`, { method: 'DELETE' });
      detailDialog.close();
      void load(true);
    } catch (err) {
      errBox.textContent = err instanceof ApiError ? err.message : '删除失败';
      errBox.hidden = false;
    }
  });
  saveNote.addEventListener('click', async () => {
    saveNote.setAttribute('disabled', 'true');
    try {
      await api<{ reading: Reading }>(`/api/readings/${r.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ user_note: noteArea.value }),
      });
      r.user_note = noteArea.value.trim() || null;
      saveNote.textContent = '已保存';
      setTimeout(() => (saveNote.textContent = '保存备注'), 1500);
    } catch (err) {
      errBox.textContent = err instanceof ApiError ? err.message : '保存失败';
      errBox.hidden = false;
    } finally {
      saveNote.removeAttribute('disabled');
    }
  });
  actions.appendChild(saveNote);
  actions.appendChild(delBtn);
  detailBody.appendChild(actions);

  detailDialog.showModal();
}

detailClose.addEventListener('click', () => detailDialog.close());
detailDialog.addEventListener('click', (e) => {
  if (e.target === detailDialog) detailDialog.close();
});

// ---------- 导出 ----------

async function fetchAll(): Promise<Reading[]> {
  const out: Reading[] = [];
  let off = 0;
  for (;;) {
    const res = await api<{ items: Reading[]; total: number }>(`/api/readings?${currentParams(200, off)}`);
    out.push(...res.items);
    off += res.items.length;
    if (out.length >= res.total || res.items.length === 0) break;
  }
  return out;
}

function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function dateStamp(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function readingToMarkdown(r: Reading): string {
  const spread = getSpread(r.spread);
  const lines: string[] = [];
  lines.push(`## ${fmtDate(r.created_at)} · ${r.mode === 'online' ? '线上抽牌' : '线下录入'} · ${spread?.nameZh ?? r.spread}`);
  if (r.topic_tag) lines.push(`主题：${r.topic_tag}`);
  if (r.mood_tag) lines.push(`心情：${r.mood_tag}`);
  lines.push('');
  lines.push(`**问题**：${r.question}`);
  lines.push('');
  lines.push('**牌面**：');
  r.cards.forEach((drawn, i) => {
    const card = getCard(drawn.card);
    lines.push(
      `- ${spread?.positions[i]?.labelZh ?? drawn.position}：${card?.nameZh ?? drawn.card}（${drawn.orientation === 'upright' ? '正位' : '逆位'}）`
    );
  });
  const stored = parseStoredInterpretation(r.ai_interpretation);
  if (stored) {
    lines.push('');
    lines.push('**AI 解读**：');
    if (stored.format === 'text') {
      lines.push(stored.text);
    } else {
      lines.push('');
      for (const c of stored.cards) lines.push(`- **${c.position} · ${c.name}（${c.orientation}）**：${c.analysis}`);
      lines.push('');
      lines.push(stored.synthesis);
      if (stored.reflection.length > 0) {
        lines.push('');
        lines.push('反思问题：');
        for (const q of stored.reflection) lines.push(`- ${q}`);
      }
    }
  }
  if (r.user_note) {
    lines.push('');
    lines.push(`**备注**：${r.user_note}`);
  }
  lines.push('');
  return lines.join('\n');
}

async function doExport(format: 'json' | 'md'): Promise<void> {
  const btn = format === 'json' ? exportJsonBtn : exportMdBtn;
  btn.setAttribute('disabled', 'true');
  errBox.hidden = true;
  try {
    const items = await fetchAll();
    if (items.length === 0) {
      errBox.textContent = '没有可导出的记录。';
      errBox.hidden = false;
      return;
    }
    const suffix = filterScope.value === 'all' ? '-all' : '';
    if (format === 'json') {
      download(`tarot-readings${suffix}-${dateStamp()}.json`, JSON.stringify(items, null, 2), 'application/json');
    } else {
      const md = [`# 塔罗记录导出（${fmtDate(new Date().toISOString())}，共 ${items.length} 条）`, '', ...items.map(readingToMarkdown)].join('\n');
      download(`tarot-readings${suffix}-${dateStamp()}.md`, md, 'text/markdown');
    }
  } catch (err) {
    errBox.textContent = err instanceof ApiError ? err.message : '导出失败';
    errBox.hidden = false;
  } finally {
    btn.removeAttribute('disabled');
  }
}

exportJsonBtn.addEventListener('click', () => void doExport('json'));
exportMdBtn.addEventListener('click', () => void doExport('md'));

// ---------- 筛选 / 搜索 ----------

filterMode.addEventListener('change', () => void load(true));
filterTopic.addEventListener('change', () => void load(true));
filterScope.addEventListener('change', () => void load(true));
moreBtn.addEventListener('click', () => void load(false));
searchInput.addEventListener('input', () => {
  if (searchTimer !== undefined) window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => void load(true), 300);
});

api<{ user: { role: string } }>('/api/me')
  .then(({ user }) => {
    scopeWrap.hidden = user.role !== 'admin';
  })
  .catch(() => {
    /* api 会在 401 时统一跳转登录页 */
  });

void load(true);
