#!/usr/bin/env node
// 生成 12 个极简星座 SVG 图标（自制，无外部素材）：圆环 + 星座符号。
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '../web/public/zodiac');
mkdirSync(outDir, { recursive: true });

const SIGNS = [
  ['aries', '♈'], ['taurus', '♉'], ['gemini', '♊'], ['cancer', '♋'],
  ['leo', '♌'], ['virgo', '♍'], ['libra', '♎'], ['scorpio', '♏'],
  ['sagittarius', '♐'], ['capricorn', '♑'], ['aquarius', '♒'], ['pisces', '♓'],
];

for (const [key, symbol] of SIGNS) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <circle cx="48" cy="48" r="44" fill="none" stroke="#5c6b5e" stroke-width="2"/>
  <circle cx="48" cy="48" r="36" fill="none" stroke="#e2e2df" stroke-width="1"/>
  <text x="48" y="62" text-anchor="middle" font-size="40" fill="#111111">${symbol}</text>
</svg>
`;
  writeFileSync(path.join(outDir, `${key}.svg`), svg);
}
console.log(`generated ${SIGNS.length} zodiac SVGs -> ${outDir}`);
