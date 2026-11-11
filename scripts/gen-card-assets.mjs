#!/usr/bin/env node
// 生成/校验 web/src/assets/card-assets.json —— 牌面 WebP 资源清单。
// 前端据此决定 img.src：清单内有 → cards/<id>.webp；没有 → 直接给占位 SVG（首帧不打 404）。
// 清单入库（内容确定、可 diff）；下载真图后重跑本脚本即自动升级。
//   node scripts/gen-card-assets.mjs           # 重新生成
//   node scripts/gen-card-assets.mjs --check   # CI：清单与 public/cards/*.webp 不同步则 FAIL
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cardsDir = path.join(root, 'web/public/cards');
const outFile = path.join(root, 'web/src/assets/card-assets.json');

const webp = existsSync(cardsDir)
  ? readdirSync(cardsDir)
      .filter((f) => f.endsWith('.webp'))
      .map((f) => f.replace(/\.webp$/, ''))
      .sort()
  : [];

const next = { note: '由 scripts/gen-card-assets.mjs 生成；请勿手改。', webp };

const checkMode = process.argv.includes('--check');
if (checkMode) {
  if (!existsSync(outFile)) {
    console.error('check failed: web/src/assets/card-assets.json 不存在，请先运行 node scripts/gen-card-assets.mjs');
    process.exit(1);
  }
  const current = JSON.parse(readFileSync(outFile, 'utf8'));
  const a = JSON.stringify(current.webp ?? []);
  const b = JSON.stringify(webp);
  if (a !== b) {
    console.error('check failed: 清单与 web/public/cards/*.webp 不同步');
    console.error(`  清单: ${current.webp?.length ?? 0} 张；实际: ${webp.length} 张`);
    process.exit(1);
  }
  console.log(`card-assets OK: ${webp.length} 张 webp 与清单一致`);
  process.exit(0);
}

mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(next, null, 2) + '\n');
console.log(`card-assets generated: ${webp.length} webp entries -> web/src/assets/card-assets.json`);
