import { ZODIAC_SIGNS } from '@tarot/shared';
import type { ZodiacSign } from '@tarot/shared';
import { el, SITE_BASE } from '../lib/api';

const grid = document.getElementById('grid') as HTMLDivElement;
const detail = document.getElementById('detail') as HTMLDivElement;

function renderDetail(sign: ZodiacSign): void {
  detail.innerHTML = '';
  const panel = el('div', 'panel');
  const head = el('p');
  head.appendChild(el('strong', undefined, `${sign.nameZh} ${sign.symbol}`));
  panel.appendChild(head);
  panel.appendChild(el('p', 'muted', `${sign.dateRangeZh} · ${sign.elementZh} · 守护星：${sign.rulerZh}`));
  panel.appendChild(el('p', undefined, `关键词：${sign.keywordsZh.join(' · ')}`));
  panel.appendChild(el('p', undefined, sign.traitsZh));
  const tipTitle = el('p');
  tipTitle.appendChild(el('strong', undefined, '通用反思建议'));
  panel.appendChild(tipTitle);
  for (const tip of sign.reflectionZh) {
    const li = el('p', 'muted', `· ${tip}`);
    panel.appendChild(li);
  }
  detail.appendChild(panel);
}

for (const sign of ZODIAC_SIGNS) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.key = sign.key;
  const img = document.createElement('img');
  img.src = `${SITE_BASE}zodiac/${sign.key}.svg`;
  img.alt = sign.nameZh;
  btn.appendChild(img);
  btn.appendChild(el('span', undefined, sign.nameZh));
  btn.addEventListener('click', () => {
    for (const other of Array.from(grid.children)) (other as HTMLElement).classList.remove('active');
    btn.classList.add('active');
    renderDetail(sign);
    location.hash = sign.key;
  });
  grid.appendChild(btn);
}

// 支持 /zodiac#leo 直达
const initial = location.hash.replace('#', '');
if (initial) {
  const sign = ZODIAC_SIGNS.find((z) => z.key === initial);
  if (sign) {
    (grid.querySelector(`[data-key="${sign.key}"]`) as HTMLElement | null)?.classList.add('active');
    renderDetail(sign);
  }
}
