import { getCard, getSpread, TOPIC_TAGS } from '@tarot/shared';
import type { Reading } from '@tarot/shared';
import { ApiError, api, attachImageFallback, cardImageSrc, el, fmtDate } from '../lib/api';

const list = document.getElementById('list') as HTMLDivElement;
const empty = document.getElementById('empty') as HTMLDivElement;
const moreBtn = document.getElementById('more-btn') as HTMLButtonElement;
const errBox = document.getElementById('err') as HTMLDivElement;
const filterMode = document.getElementById('filter-mode') as HTMLSelectElement;
const filterTopic = document.getElementById('filter-topic') as HTMLSelectElement;

let offset = 0;
let exhausted = false;
const allReadings: Reading[] = [];
for (const t of TOPIC_TAGS) filterTopic.appendChild(new Option(t, t));

async function load(reset: boolean): Promise<void> {
  if (reset) {
    offset = 0;
    exhausted = false;
    allReadings.length = 0;
    list.innerHTML = '';
  }
  errBox.hidden = true;
  try {
    const res = await api<{ items: Reading[]; total: number }>(
      `/api/readings?limit=20&offset=${offset}`
    );
    allReadings.push(...res.items);
    offset += res.items.length;
    exhausted = allReadings.length >= res.total;
    render();
  } catch (err) {
    errBox.textContent = err instanceof ApiError ? err.message : '加载失败';
    errBox.hidden = false;
  }
}

function visible(): Reading[] {
  const mode = filterMode.value;
  const topic = filterTopic.value;
  return allReadings.filter((r) => {
    if (mode && r.mode !== mode) return false;
    if (topic && r.topic_tag !== topic) return false;
    return true;
  });
}

function readingCard(r: Reading): HTMLElement {
  const wrap = el('div', 'panel');
  const head = el('p');
  head.appendChild(el('strong', undefined, fmtDate(r.created_at)));
  head.appendChild(document.createTextNode(' · '));
  head.appendChild(document.createTextNode(r.mode === 'online' ? '线上抽牌' : '线下录入'));
  head.appendChild(document.createTextNode(' · '));
  head.appendChild(document.createTextNode(getSpread(r.spread)?.nameZh ?? r.spread));
  if (r.topic_tag) {
    head.appendChild(document.createTextNode(' '));
    head.appendChild(el('span', 'tag', r.topic_tag));
  }
  if (r.mood_tag) {
    head.appendChild(document.createTextNode(' '));
    head.appendChild(el('span', 'tag', r.mood_tag));
  }
  wrap.appendChild(head);
  wrap.appendChild(el('p', undefined, r.question));

  // 牌面缩略
  const thumbs = el('div', 'spread-row');
  thumbs.style.justifyContent = 'flex-start';
  r.cards.forEach((drawn, i) => {
    const card = getCard(drawn.card);
    const pos = getSpread(r.spread)?.positions[i];
    const cell = el('div');
    cell.style.width = '84px';
    cell.style.textAlign = 'center';
    const img = document.createElement('img');
    const srcs = cardImageSrc(drawn.card);
    img.src = srcs.src;
    img.alt = card?.nameZh ?? drawn.card;
    img.loading = 'lazy';
    img.style.cssText = 'width:84px;height:144px;object-fit:cover;border-radius:8px;border:1px solid var(--border);';
    attachImageFallback(img, srcs.fallback);
    cell.appendChild(img);
    const cap = el('div', 'muted', `${pos?.labelZh ?? ''} ${card?.nameZh ?? ''} ${drawn.orientation === 'reversed' ? '逆' : '正'}`);
    cap.style.fontSize = '11px';
    cell.appendChild(cap);
    thumbs.appendChild(cell);
  });
  wrap.appendChild(thumbs);

  if (r.ai_interpretation) {
    const p = el('p');
    p.appendChild(el('strong', undefined, 'AI 解读：'));
    p.appendChild(document.createTextNode(r.ai_interpretation));
    wrap.appendChild(p);
  }

  // 备注编辑
  const noteArea = document.createElement('textarea');
  noteArea.value = r.user_note ?? '';
  noteArea.placeholder = '补充备注…';
  noteArea.setAttribute('maxlength', '2000');
  const saveNote = el('button', 'btn secondary', '保存备注') as HTMLButtonElement;
  saveNote.style.marginTop = '8px';
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
      const idx = allReadings.findIndex((x) => x.id === r.id);
      if (idx >= 0) allReadings.splice(idx, 1);
      render();
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
  const actions = el('div');
  actions.appendChild(saveNote);
  actions.appendChild(delBtn);
  wrap.appendChild(noteArea);
  wrap.appendChild(actions);
  return wrap;
}

function render(): void {
  list.innerHTML = '';
  const items = visible();
  empty.hidden = items.length > 0;
  for (const r of items) list.appendChild(readingCard(r));
  moreBtn.hidden = exhausted;
}

filterMode.addEventListener('change', () => render());
filterTopic.addEventListener('change', () => render());
moreBtn.addEventListener('click', () => void load(false));
void load(true);
