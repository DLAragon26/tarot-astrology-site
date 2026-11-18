#!/usr/bin/env node
// 子路径部署自检：扫描 web/dist 构建产物，两类问题都会 FAIL：
//   1) 链接断链：站内 href/src 必须以 base 开头且拼接正确
//      （典型故障：Astro BASE_URL 不带尾斜杠，`${base}draw` → `/tarot-astrology-sitedraw`）
//   2) 占位符泄漏：全部文本产物（HTML/JS/CSS/JSON/SVG）里出现构建占位符
//      （REPLACE_WITH_YOUR / USERNAME.github.io）＝用户没配 Variables 时产物连不上 API，即假绿部署
// 用法：
//   node scripts/check-base-links.mjs                       # 读 PUBLIC_BASE_PATH，默认 /
//   node scripts/check-base-links.mjs --base=/my-repo        # 显式指定子路径
// 必须先完成全量构建（扫描器只能看见渲染出来的链接与打包后的文本），
// 须在 astro build 之后、上传产物之前运行。
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'web/dist');

const argBase = process.argv.find((a) => a.startsWith('--base='))?.slice('--base='.length);
const rawBase = argBase ?? process.env.PUBLIC_BASE_PATH ?? '/';
const base = rawBase === '/' ? '/' : '/' + rawBase.replace(/^\/+|\/+$/g, '');

if (!existsSync(distDir)) {
  console.error(`check-base-links FAILED: ${path.relative(root, distDir)} 不存在，请先构建（PUBLIC_BASE_PATH=${base}）`);
  process.exit(2);
}

/** 紧贴子路径 base 后接字母/数字 = 拼接缺斜杠；根路径不存在该问题。 */
const gluedRe = base === '/' ? null : new RegExp(escapeRe(base) + '[A-Za-z0-9_-]');
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const PLACEHOLDER_TOKENS = [/REPLACE_WITH_YOUR/i, /USERNAME\.github\.io/i];
const TEXT_EXT = new Set(['.html', '.js', '.css', '.json', '.mjs', '.txt', '.svg', '.webmanifest']);
const MAX_FILE = 2 * 1024 * 1024;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const problems = [];
let pages = 0;
let links = 0;
let textFiles = 0;

for (const file of walk(distDir)) {
  const rel = path.relative(root, file);
  const ext = path.extname(file).toLowerCase();
  let st;
  try {
    st = statSync(file);
  } catch {
    continue;
  }
  if (!st.isFile() || st.size > 2 * 1024 * 1024) continue;

  if (ext === '.html') {
    pages++;
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
      if (gluedRe?.test(value)) {
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
    continue;
  }

  // 规则 C：全部文本产物扫占位符（API 地址在 JS chunk 里，只扫 HTML 抓不到）
  if (TEXT_EXT.has(ext)) {
    textFiles++;
    const content = readFileSync(file, 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, i) => {
      for (const t of PLACEHOLDER_TOKENS) {
        if (t.test(line)) {
          problems.push(`[placeholder] ${rel}:${i + 1} → ${line.trim().slice(0, 120)}`);
        }
      }
    });
  }
}

if (problems.length > 0) {
  console.error(
    `check-base-links FAILED (${problems.length} issue(s), base=${base}, pages=${pages}, links=${links}, text files=${textFiles}):`
  );
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(
  `check-base-links OK: base=${base}, ${pages} html, ${links} href/src, ${textFiles} text files scanned, 0 broken links / 0 placeholder tokens`
);
