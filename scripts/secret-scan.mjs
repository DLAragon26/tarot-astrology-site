#!/usr/bin/env node
// Secret scan：扫描仓库文件与构建产物，确保没有真实密钥被提交或打包。
// 规则：
//  1) 常见密钥格式（sk- 开头的 API key、私钥块）
//  2) key=value 形式的敏感赋值，值必须是明确的占位符
//  3) .dev.vars / .env 真实文件 / 数据库导出文件不得被 git 追踪
//  4) 构建产物 dist/ 中不得出现 API_KEY 等 secret 变量值
// 占位符判定：值含 placeholder / your- / your_ / changeme / xxx / REPLACE / test-only / example 即视为安全。
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const SAFE_VALUE_RE = /(placeholder|your[-_]|changeme|^x+$|REPLACE|test-only|example|dummy)/i;
const SECRET_KEY_RE =
  /^\s*(?:export\s+)?[A-Za-z0-9_-]*(?:api[_-]?key|apikey|secret|passwd|password|access[_-]?key|token)[A-Za-z0-9_-]*\s*[:=]\s*["']?([^"'\s]{8,})["']?\s*$/i;
const PATTERNS = [
  { name: 'openai-style key', re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'google api key', re: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
];

const IGNORE_DIRS = new Set(['.git', 'node_modules', '.wrangler', '.astro', 'coverage', '.hermes']);
const TEXT_EXT = new Set(['.ts', '.tsx', '.astro', '.mjs', '.js', '.cjs', '.json', '.md', '.toml', '.yaml', '.yml', '.sql', '.css', '.html', '.txt', '.example', '.vars']);
const MAX_FILE = 2 * 1024 * 1024;

const problems = [];

function listGitFiles() {
  try {
    const out = execSync('git ls-files', { cwd: root, encoding: 'utf8' });
    return out.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (IGNORE_DIRS.has(name)) continue;
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function isPlaceholderValue(value) {
  return SAFE_VALUE_RE.test(value);
}

const gitFiles = new Set(listGitFiles());

// 1) git 追踪文件里的敏感文件
for (const f of gitFiles) {
  const base = path.basename(f);
  if (base === '.dev.vars' || /^\.env(\..+)?$/.test(base)) {
    problems.push(`[tracked-secret-file] ${f}`);
  }
  if (/\.(db|sqlite|sqlite3|dump)$/.test(base)) {
    problems.push(`[tracked-db-file] ${f}`);
  }
}

// 2) 扫描 git 文件 + 构建产物内容
const filesToScan = new Set(gitFiles);
for (const f of walk(path.join(root, 'web/dist'))) filesToScan.add(path.relative(root, f));

for (const rel of filesToScan) {
  const abs = path.join(root, rel);
  const ext = path.extname(rel).toLowerCase();
  const base = path.basename(rel);
  let st;
  try {
    st = statSync(abs);
  } catch {
    continue;
  }
  if (!st.isFile() || st.size > MAX_FILE) continue;
  if (!TEXT_EXT.has(ext) && !rel.startsWith('web/dist')) continue;
  let content;
  try {
    content = readFileSync(abs, 'utf8');
  } catch {
    continue;
  }
  const lines = content.split('\n');
  lines.forEach((line, i) => {
    for (const { name, re } of PATTERNS) {
      if (re.test(line)) {
        problems.push(`[${name}] ${rel}:${i + 1}`);
      }
    }
    const m = line.match(SECRET_KEY_RE);
    if (m && !isPlaceholderValue(m[1])) {
      problems.push(`[secret-assignment] ${rel}:${i + 1} (key value not a placeholder)`);
    }
  });
}

// 3) .dev.vars 本地文件存在不算错误（不提交即可），但提醒
if (existsSync(path.join(root, 'worker/.dev.vars'))) {
  console.log('note: worker/.dev.vars exists locally (gitignored, OK)');
}

if (problems.length > 0) {
  console.error(`secret-scan FAILED (${problems.length}):`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`secret-scan OK: ${filesToScan.size} files scanned, no secrets found`);
