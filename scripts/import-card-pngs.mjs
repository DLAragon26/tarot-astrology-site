#!/usr/bin/env node
// 将已经通过 Commons 浏览器页面下载的 RWS Tarot 1910 PNG 导入为项目 WebP。
// 用途：网络路由无法让 Node 直连 Wikimedia 时，仍可通过浏览器断点下载后离线转换。
// 用法：node scripts/import-card-pngs.mjs --from /path/to/downloads
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { expectedCardTitles } from './card-file-map.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'web/public/cards');
const sourceDirArg = process.argv.find((arg) => arg.startsWith('--from='));
const sourceDir =
  sourceDirArg?.slice('--from='.length) ??
  (() => {
    const i = process.argv.indexOf('--from');
    return i >= 0 ? process.argv[i + 1] : '';
  })();

if (!sourceDir || !existsSync(sourceDir)) {
  console.error('用法：node scripts/import-card-pngs.mjs --from /path/to/downloads');
  process.exit(2);
}

const EXPECTED = new Map(expectedCardTitles().map((card) => [card.id, card.title]));

const files = readdirSync(sourceDir).filter((name) => /\.png$/i.test(name));
const byTitle = new Map(files.map((name) => [`File:${name.replace(/_/g, ' ')}`, path.join(sourceDir, name)]));
const missing = [];
const imported = [];

mkdirSync(outDir, { recursive: true });
for (const [id, sourceTitle] of EXPECTED) {
  const sourcePath = byTitle.get(sourceTitle);
  if (!sourcePath) {
    missing.push(sourceTitle);
    continue;
  }
  const outPath = path.join(outDir, `${id}.webp`);
  await sharp(sourcePath)
    .resize({ width: 480, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(outPath);
  imported.push({
    id,
    file: sourceTitle.replace(/^File:/, ''),
    commons_url: `https://commons.wikimedia.org/wiki/${encodeURIComponent(sourceTitle).replace(/%3A/i, ':')}`,
  });
  process.stdout.write('.');
}
process.stdout.write('\n');

if (missing.length > 0) {
  console.error(`缺少 ${missing.length} 张源图：`);
  for (const title of missing) console.error('  ' + title);
  process.exit(1);
}

writeFileSync(
  path.join(root, 'scripts/card-sources.json'),
  JSON.stringify(
    {
      source: 'Wikimedia Commons — Category:Rider-Waite tarot deck',
      license: 'Public domain (Rider-Waite Tarot, 1909/1910)',
      cards: imported.sort((a, b) => a.id.localeCompare(b.id)),
    },
    null,
    2
  ) + '\n'
);
console.log(`imported ${imported.length}/78 WebP + scripts/card-sources.json`);
