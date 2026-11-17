#!/usr/bin/env node
// Secret scan：确保仓库与构建产物里没有真实密钥。
// 规则分层（严格但不误报）：
//   A. 高熵/格式特征：对所有被检查文件生效（含 md、源码、dist）
//      - OpenAI 风格 sk- 长串、Google AIza、AWS AKIA、GitHub token、Slack token、PEM 私钥块
//   B. key=value 严格校验：仅对配置类文件（.env* / .dev.vars* / *.example / *.toml / *.yaml）
//      - 变量名含 key/secret/password/token/credential 时，值必须是明确占位符
//      - 源码里的 `token: vars.X`、TS 类型 `password: boolean` 不属于配置值，不参与 B 类
//   C. 仓库卫生：真实 .dev.vars / .env 文件、数据库导出不得被 git 跟踪（*.example 豁免）
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const HIGH_ENTROPY_PATTERNS = [
  { name: 'openai-style key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'google api key', re: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
  { name: 'aws access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'github token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: 'slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
];

/** 只有配置类文件才做 key=value 严格校验 */
const CONFIG_FILE_RE = /(^|\/)\.env(\.[^/]+)?$|(^|\/)\.dev\.vars(\.[^/]+)?$|\.example$|\.toml$|\.ya?ml$/;
const SECRET_NAME_RE = /(api[_-]?key|apikey|secret|passwd|password|access[_-]?key|token|credential)/i;
const SAFE_VALUE_RE =
  /(placeholder|your[-_]|changeme|^x+$|REPLACE|test-only|example|dummy|^null$|^true$|^false$|^<.*>$|^\$\{.*\}$)/i;

const IGNORE_DIRS = new Set(['.git', 'node_modules', '.wrangler', '.astro', 'coverage']);
const TEXT_EXT = new Set([
  '.ts', '.tsx', '.astro', '.mjs', '.js', '.cjs', '.json', '.md', '.toml', '.yaml', '.yml',
  '.sql', '.css', '.html', '.txt', '.example', '.vars', '.sh',
]);
const MAX_FILE = 2 * 1024 * 1024;

const problems = [];

function listGitFiles() {
  try {
    return execSync('git ls-files --cached --others --exclude-standard', { cwd: root, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
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

const gitFiles = new Set(listGitFiles());

// C. 仓库卫生：这些文件不得被跟踪（*.example 豁免）
for (const f of gitFiles) {
  const base = path.basename(f);
  const isExample = f.endsWith('.example');
  if (!isExample && (base === '.dev.vars' || /^\.env(\..+)?$/.test(base))) {
    problems.push(`[tracked-secret-file] ${f}`);
  }
  if (/\.(db|sqlite|sqlite3|dump)$/i.test(base) || /\.sql\.gz$/i.test(base)) {
    problems.push(`[tracked-db-file] ${f}`);
  }
}

// A + B：检查已跟踪、未忽略的未跟踪文件 + 构建产物
const filesToScan = new Set(gitFiles);
for (const f of walk(path.join(root, 'web/dist'))) filesToScan.add(path.relative(root, f));

function scanConfigKeyValues(rel, content) {
  const lines = content.split('\n');
  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const eq = t.indexOf('=');
    if (eq <= 0) return;
    const key = t.slice(0, eq).trim().replace(/^export\s+/, '');
    let value = t.slice(eq + 1).trim();
    value = value.replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '');
    if (!SECRET_NAME_RE.test(key)) return;
    if (!value) return;
    if (SAFE_VALUE_RE.test(value)) return;
    if (value.length < 8) return;
    problems.push(`[secret-value] ${rel}:${i + 1} — ${key} 的值不是明确占位符`);
  });
}

for (const rel of filesToScan) {
  const abs = path.join(root, rel);
  const ext = path.extname(rel).toLowerCase();
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

  // A：格式特征（全文件）
  const lines = content.split('\n');
  lines.forEach((line, i) => {
    for (const { name, re } of HIGH_ENTROPY_PATTERNS) {
      if (re.test(line)) problems.push(`[${name}] ${rel}:${i + 1}`);
    }
  });

  // B：配置类文件才做 key=value 严格校验
  if (CONFIG_FILE_RE.test(rel)) scanConfigKeyValues(rel, content);
}

// 提示（不失败）：本地存在未提交的 .dev.vars 属正常
if (existsSync(path.join(root, 'worker/.dev.vars'))) {
  console.log('note: worker/.dev.vars exists locally (gitignored, OK)');
}

if (problems.length > 0) {
  console.error(`secret-scan FAILED (${problems.length}):`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`secret-scan OK: ${filesToScan.size} files scanned (source tree + web/dist), no secrets found`);
