#!/usr/bin/env node
// 从 Wikimedia Commons 下载 78 张 Rider-Waite（1909，Pamela Colman Smith，公有领域）牌图，
// 统一压成 WebP，命名稳定 ID（rw-XX-slug.webp）到 web/public/cards/。
// - 数据源：Category:Rider-Waite tarot deck（Commons API），文件名规则 RWS_Tarot_XX_*.jpg
// - sharp 缺失时跳过转换并明确警告（占位 SVG 仍然可用，不阻塞）
// - --verify：只校验 web/public/cards/ 下 78 个 webp 是否齐全
// - 可重跑：已存在的文件默认跳过（--force 全量重下）
import { mkdirSync, existsSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '../web/public/cards');
const UA = 'tarot-astrology-site-asset-fetcher/1.0 (local build script)';

const MAJOR = [
  ['00', 'fool'], ['01', 'magician'], ['02', 'high-priestess'], ['03', 'empress'],
  ['04', 'emperor'], ['05', 'hierophant'], ['06', 'lovers'], ['07', 'chariot'],
  ['08', 'strength'], ['09', 'hermit'], ['10', 'wheel-of-fortune'], ['11', 'justice'],
  ['12', 'hanged-man'], ['13', 'death'], ['14', 'temperance'], ['15', 'devil'],
  ['16', 'tower'], ['17', 'star'], ['18', 'moon'], ['19', 'sun'], ['20', 'judgement'], ['21', 'world'],
];
const NUM_SLUG = [
  'ace', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'page', 'knight', 'queen', 'king',
];
const SUIT_MAP = { Wands: 'wands', Cups: 'cups', Swords: 'swords', Pentacles: 'pentacles', Pents: 'pentacles' };

const EXPECTED = new Map(); // cardId -> {num}
for (const [num, slug] of MAJOR) EXPECTED.set(`rw-${num}-${slug}`, { num: Number(num) });
for (const suit of Object.values(SUIT_MAP)) {
  NUM_SLUG.forEach((slug, i) => {
    const num = String(i + 1).padStart(2, '0');
    EXPECTED.set(`rw-${num}-${slug}-${suit}`, { num: i + 1 });
  });
}

async function listCategoryMembers(category) {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&list=categorymembers&cmtitle=${encodeURIComponent(
    category
  )}&cmlimit=500&format=json&formatversion=2`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Commons API ${res.status}`);
  const data = await res.json();
  return (data?.query?.categorymembers ?? []).map((m) => m.title).filter((t) => /\.jpe?g$/i.test(t));
}

function mapFileToCardId(title) {
  const m = title.match(/^RWS_Tarot_(\d{2})_([^/]+)\.(?:jpe?g)$/i);
  if (!m) return null;
  const fileNum = Number(m[1]);
  const tail = m[2].trim();
  // 大阿卡纳：编号 00-21 且 tail 不是花色名
  const major = MAJOR.find(([num]) => Number(num) === fileNum);
  if (major && !/Wands|Cups|Swords|Pents/i.test(tail)) {
    return `rw-${major[0]}-${major[1]}`;
  }
  // 小阿卡纳：RWS_Tarot_NN_Suit.jpg（NN: 01-14）
  const suitKey = Object.keys(SUIT_MAP).find((s) => tail.toLowerCase() === s.toLowerCase());
  if (suitKey && fileNum >= 1 && fileNum <= 14) {
    const slug = NUM_SLUG[fileNum - 1];
    return `rw-${String(fileNum).padStart(2, '0')}-${slug}-${SUIT_MAP[suitKey]}`;
  }
  return null;
}

async function downloadOne(cardId, title, sharp) {
  const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(title)}?width=560`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${cardId}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const outPath = path.join(outDir, `${cardId}.webp`);
  if (sharp) {
    const webp = await sharp(buf)
      .resize({ width: 480, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    writeFileSync(outPath, webp);
  } else {
    throw new Error('sharp 不可用，无法生成 WebP');
  }
  return outPath;
}

async function verify() {
  let found = 0;
  const missing = [];
  for (const id of EXPECTED.keys()) {
    const p = path.join(outDir, `${id}.webp`);
    if (existsSync(p)) found++;
    else missing.push(id);
  }
  console.log(`verify: ${found}/${EXPECTED.size} webp present`);
  if (missing.length > 0) {
    console.log('missing:', missing.join(', '));
    process.exitCode = 1;
  }
}

const force = process.argv.includes('--force');
if (process.argv.includes('--verify')) {
  await verify();
  process.exit(process.exitCode ?? 0);
}

mkdirSync(outDir, { recursive: true });

let sharp = null;
try {
  sharp = (await import('sharp')).default;
  console.log('sharp loaded');
} catch {
  console.warn('WARN: sharp 未安装，跳过下载（占位 SVG 仍可用）。运行 npm install 安装 optionalDependencies 后重试。');
}

console.log('fetching Commons category members…');
const titles = await listCategoryMembers('Category:Rider-Waite tarot deck');
console.log(`category members: ${titles.length}`);
const byCardId = new Map();
for (const t of titles) {
  const id = mapFileToCardId(t);
  if (id && !byCardId.has(id)) byCardId.set(id, t);
}
console.log(`mapped: ${byCardId.size}/${EXPECTED.size}`);
const unmapped = [...EXPECTED.keys()].filter((id) => !byCardId.has(id));
if (unmapped.length > 0) {
  console.warn('unmapped cards:', unmapped.join(', '));
}

// 兜底：对未映射到的卡用已知命名模式直接尝试（RWS_Tarot_NN_Suit.jpg）
if (unmapped.length > 0 && sharp) {
  for (const id of unmapped) {
    const m = id.match(/^rw-(\d{2})-([a-z-]+)$/);
    if (m && Number(m[1]) <= 21) continue;
    // 小阿卡纳文件名模式补猜
    const mm = id.match(/^rw-(\d{2})-([a-z-]+)-(wands|cups|swords|pentacles)$/);
    if (!mm) continue;
    const suitName = Object.keys(SUIT_MAP).find((k) => SUIT_MAP[k] === mm[3]);
    for (const candidate of [`RWS_Tarot_${mm[1]}_${suitName}.jpg`]) {
      byCardId.set(id, candidate);
    }
  }
}

let ok = 0;
const failed = [];
const sources = [];
for (const [cardId, title] of byCardId) {
  const outPath = path.join(outDir, `${cardId}.webp`);
  if (!force && existsSync(outPath) && statSync(outPath).size > 1000) {
    ok++;
    sources.push({ id: cardId, file: title });
    continue;
  }
  if (!sharp) break;
  try {
    await downloadOne(cardId, title, sharp);
    ok++;
    sources.push({ id: cardId, file: title });
    process.stdout.write(`.`);
  } catch (e) {
    failed.push(`${e.message}`);
  }
}
console.log('');
console.log(`downloaded/kept: ${ok}/${EXPECTED.size}`);
if (failed.length > 0) console.log('failed:', failed.slice(0, 10).join(' | '));
writeFileSync(
  path.resolve(here, 'card-sources.json'),
  JSON.stringify({ source: 'Wikimedia Commons — Category:Rider-Waite tarot deck', cards: sources.sort((a, b) => a.id.localeCompare(b.id)) }, null, 2)
);
console.log('sources written to scripts/card-sources.json');
await verify();
