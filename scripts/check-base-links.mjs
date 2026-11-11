#!/usr/bin/env node
// 子路径部署自检：扫描 web/dist 全部 HTML，断言站内链接/资源路径都以 base 开头且拼接正确。
// 典型故障：Astro BASE_URL 不带尾斜杠，`${base}draw` 生成 `/tarot-astrology-sitedraw`（紧贴字母）。
// 用法：
//   node scripts/check-base-links.mjs                      # 读 PUBLIC_BASE_PATH，默认 /tarot-astrology-site
//   node scripts/check-base-links.mjs --base=/my-repo       # 显式指定
// 必须先构建（dist 存在），须在 astro build 之后、上传产物之前运行。
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'web/dist');

const argBase = process.argv.find((a) => a.startsWith('--base='))?.slice('--base='.length);
const rawBase = argBase ?? process.env.PUBLIC_BASE_PATH ?? '/tarot-astrology-site';
const base = rawBase === '/' ? '/' : '/' + rawBase.replace(/^\/+|\/+$/g, '');

if (!existsSync(distDir)) {
  console.error(`check-base-links FAILED: ${path.relative(root, distDir)} 不存在，请先构建（PUBLIC_BASE_PATH=${base}）`);
  process.exit(2);
}

/** 紧贴 base 后接字母/数字 = 拼接缺斜杠 */
const gluedRe = new RegExp(escapeRe(base) + '[A-Za-z0-9_-]');
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (p.endsWith('.html')) yield p;
  }
}

const problems = [];
let pages = 0;
let links = 0;

for (const file of walk(distDir)) {
  pages++;
  const rel = path.relative(root, file);
  const content = readFileSync(file, 'utf8');
  const re = /(?:href|src)="([^"]*)"/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const value = m[1];
    links++;
    if (!value) continue;
    if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('//')) continue;
    if (value.startsWith('#') || value.startsWith('data:') || value.startsWith('mailto:')) continue;

    // 规则 A：base 后紧贴字母（拼接缺少斜杠）
    if (gluedRe.test(value)) {
      const line = content.slice(0, m.index).split('\n').length;
      problems.push(`[glued] ${rel}:${line} → ${value}`);
      continue;
    }

    // 规则 B：以 / 开头的站内绝对路径，base 不是 '/' 时必须落在 base 之下
    if (base !== '/' && value.startsWith('/') && !value.startsWith(base)) {
      const line = content.slice(0, m.index).split('\n').length;
      problems.push(`[outside-base] ${rel}:${line} → ${value}`);
    }
  }
}

if (problems.length > 0) {
  console.error(`check-base-links FAILED (${problems.length} issue(s), base=${base}, pages=${pages}, links=${links}):`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`check-base-links OK: base=${base}, ${pages} html, ${links} href/src, 0 broken links`);
