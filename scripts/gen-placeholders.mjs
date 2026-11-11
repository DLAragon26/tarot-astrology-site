#!/usr/bin/env node
// 生成 78 张牌 + 牌背的极简占位 SVG（无网络时保底可跑）。
// 下载到真实 WebP 后，占位图仅作为加载失败 fallback。
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '../web/public/cards/placeholders');
mkdirSync(outDir, { recursive: true });

const CARDS = [];
const MAJOR = [
  ['fool', '愚者'], ['magician', '魔术师'], ['high-priestess', '女祭司'], ['empress', '皇后'],
  ['emperor', '皇帝'], ['hierophant', '教皇'], ['lovers', '恋人'], ['chariot', '战车'],
  ['strength', '力量'], ['hermit', '隐士'], ['wheel-of-fortune', '命运之轮'], ['justice', '正义'],
  ['hanged-man', '倒吊人'], ['death', '死神'], ['temperance', '节制'], ['devil', '恶魔'],
  ['tower', '高塔'], ['star', '星星'], ['moon', '月亮'], ['sun', '太阳'], ['judgement', '审判'], ['world', '世界'],
];
MAJOR.forEach(([slug, zh], i) => CARDS.push({ id: `rw-${String(i).padStart(2, '0')}-${slug}`, zh }));
const SUITS = { wands: '权杖', cups: '圣杯', swords: '宝剑', pentacles: '星币' };
const NUMS = [
  ['ace', '首牌'], ['two', '二'], ['three', '三'], ['four', '四'], ['five', '五'], ['six', '六'],
  ['seven', '七'], ['eight', '八'], ['nine', '九'], ['ten', '十'], ['page', '侍从'], ['knight', '骑士'],
  ['queen', '王后'], ['king', '国王'],
];
for (const [suit, suitZh] of Object.entries(SUITS)) {
  NUMS.forEach(([n, nZh], i) => CARDS.push({ id: `rw-${String(i + 1).padStart(2, '0')}-${n}-${suit}`, zh: `${suitZh}${nZh}` }));
}

const ZH_FONT = "font-family='PingFang SC, Noto Sans SC, sans-serif'";

function placeholderSvg(id, zh, num) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="824" viewBox="0 0 480 824">
  <rect width="480" height="824" fill="#ffffff"/>
  <rect x="14" y="14" width="452" height="796" fill="none" stroke="#e2e2df" stroke-width="2"/>
  <rect x="40" y="46" width="400" height="640" fill="#f6f6f4"/>
  <circle cx="240" cy="330" r="110" fill="none" stroke="#5c6b5e" stroke-width="1.5"/>
  <line x1="130" y1="330" x2="350" y2="330" stroke="#5c6b5e" stroke-width="0.5"/>
  <text x="240" y="345" text-anchor="middle" ${ZH_FONT} font-size="64" fill="#111111">${num}</text>
  <text x="240" y="740" text-anchor="middle" ${ZH_FONT} font-size="34" fill="#111111">${zh}</text>
  <text x="240" y="786" text-anchor="middle" ${ZH_FONT} font-size="18" fill="#6b6b6b">${id}</text>
</svg>
`;
}

let count = 0;
for (const c of CARDS) {
  writeFileSync(path.join(outDir, `${c.id}.svg`), placeholderSvg(c.id, c.zh, String(CARDS.indexOf(c) + 1)));
  count++;
}

const cardBack = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="824" viewBox="0 0 480 824">
  <rect width="480" height="824" fill="#ffffff"/>
  <rect x="14" y="14" width="452" height="796" rx="12" fill="none" stroke="#e2e2df" stroke-width="2"/>
  <circle cx="240" cy="412" r="150" fill="none" stroke="#e2e2df" stroke-width="1.5"/>
  <circle cx="240" cy="412" r="110" fill="none" stroke="#5c6b5e" stroke-width="0.8"/>
  <circle cx="240" cy="412" r="6" fill="#5c6b5e"/>
</svg>
`;
writeFileSync(path.resolve(outDir, '../card-back.svg'), cardBack);
console.log(`generated ${count} placeholder card SVGs + card-back.svg -> ${outDir}`);
