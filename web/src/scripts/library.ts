import { ALL_CARDS, type Suit, type TarotCard } from '@tarot/shared';
import { attachImageFallback, cardImageSrc, el } from '../lib/api';

// D2 牌库浏览页：78 张牌正逆位速查（纯静态）。

const sections = document.getElementById('library-sections') as HTMLDivElement;
const dialog = document.getElementById('card-dialog') as HTMLDialogElement;
const detail = document.getElementById('card-detail') as HTMLDivElement;
const closeBtn = document.getElementById('card-close') as HTMLButtonElement;

const SUIT_LABELS: Record<Suit, string> = {
  wands: '权杖（火）',
  cups: '圣杯（水）',
  swords: '宝剑（风）',
  pentacles: '星币（土）',
};

const NUMBER_LABELS: Record<number, string> = {
  1: 'Ace',
  11: '侍从 Page',
  12: '骑士 Knight',
  13: '王后 Queen',
  14: '国王 King',
};

function groupTitle(card: TarotCard): string {
  if (card.arcana === 'major') return `大阿卡纳 ${card.number}`;
  const rank = NUMBER_LABELS[card.number] ?? String(card.number);
  return `${SUIT_LABELS[card.suit as Suit]} ${rank}`;
}

function cardCell(card: TarotCard): HTMLElement {
  const cell = el('button', 'library-card');
  cell.type = 'button';
  cell.setAttribute('aria-label', `查看 ${card.nameZh} 的含义`);
  const img = document.createElement('img');
  const srcs = cardImageSrc(card.id);
  img.src = srcs.src;
  img.alt = card.nameZh;
  img.loading = 'lazy';
  attachImageFallback(img, srcs.fallback);
  cell.appendChild(img);
  cell.appendChild(el('span', undefined, card.nameZh));
  cell.addEventListener('click', () => openDetail(card));
  return cell;
}

function addSection(title: string, cards: TarotCard[]): void {
  if (cards.length === 0) return;
  const wrap = document.createElement('div');
  const h2 = el('h2', undefined, title);
  wrap.appendChild(h2);
  const grid = el('div', 'library-grid');
  for (const card of cards) grid.appendChild(cardCell(card));
  wrap.appendChild(grid);
  sections.appendChild(wrap);
}

function openDetail(card: TarotCard): void {
  detail.innerHTML = '';
  const head = el('div', 'library-detail-head');
  const img = document.createElement('img');
  const srcs = cardImageSrc(card.id);
  img.src = srcs.src;
  img.alt = card.nameZh;
  attachImageFallback(img, srcs.fallback);
  head.appendChild(img);

  const info = el('div');
  info.appendChild(el('p', undefined, card.nameZh));
  const en = el('p', 'muted', `${card.name} · ${groupTitle(card)}`);
  info.appendChild(en);
  const kw = el('p');
  kw.appendChild(el('strong', undefined, '关键词：'));
  kw.appendChild(document.createTextNode(card.keywords.join(' · ')));
  info.appendChild(kw);
  head.appendChild(info);
  detail.appendChild(head);

  const upPanel = el('div', 'panel');
  upPanel.appendChild(el('p', undefined, '正位'));
  upPanel.appendChild(el('p', undefined, card.upright));
  detail.appendChild(upPanel);

  const revPanel = el('div', 'panel');
  revPanel.appendChild(el('p', undefined, '逆位'));
  revPanel.appendChild(el('p', undefined, card.reversed));
  detail.appendChild(revPanel);

  dialog.showModal();
}

closeBtn.addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (e) => {
  if (e.target === dialog) dialog.close();
});

addSection('大阿卡纳', ALL_CARDS.filter((c) => c.arcana === 'major'));
for (const suit of ['wands', 'cups', 'swords', 'pentacles'] as Suit[]) {
  const suitCards = ALL_CARDS.filter((c) => c.suit === suit).sort((a, b) => a.number - b.number);
  addSection(SUIT_LABELS[suit], suitCards);
}
