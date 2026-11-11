# 塔罗与星座 · 私人记录空间

仅供极少数人使用的私人塔罗记录与太阳星座参考站。前端静态部署在 GitHub Pages，API 部署在 Cloudflare Workers，数据存 Cloudflare D1。所有 AI 调用只在后端发生，密钥永远不进入前端与仓库。

## 目录结构

```
tarot-astrology-site/
├── web/          # Astro + TypeScript 静态前端（GitHub Pages）
├── worker/       # Cloudflare Worker API（Hono + D1）
├── shared/       # 前后端共享：类型、78 张牌数据、牌阵、校验、AI prompt、星座内容
├── docs/         # DEPLOYMENT / ADMIN_GUIDE / SECURITY
├── scripts/      # 资产生成、牌图下载、secret-scan
└── .github/workflows/deploy.yml   # Pages 部署
```

## 功能

- 登录（站点访问密钥 + 用户名 + 密码），无公开注册；管理员可建号或发一次性邀请码，受邀人用邀请码自设密码激活
- 线上抽牌：问题 → 可选主题/心情标签 → 三种牌阵（单张 / 过去-现在-未来 / 五张问题透视）→ 逐张翻牌 → AI 解读 → 保存
- 线下录入：手动记录实际排面（位置、牌名、正逆位）→ AI 解读 → 保存
- 历史记录：查看、备注编辑、删除（按用户隔离；管理员可看全部）
- 统计：总次数、月度趋势、线上线下比例、主题/牌阵分布、高频牌、正逆位比例、AI 用量；管理员另有全站用量与额度面板
- 太阳星座页：12 星座基础内容（静态，不调用 AI）
- Rider-Waite 78 张牌图（Wikimedia Commons 公有领域），加载失败自动回退占位 SVG

## 本地开发

要求：Node ≥ 22，npm。

```bash
npm install            # 安装全部 workspace 依赖
npm run assets:gen     # 生成占位牌图 + 星座 SVG（已提交，可跳过）

# 前端（端口 4321）
cp web/.env.example web/.env     # PUBLIC_API_BASE_URL 默认 http://localhost:8787
npm run dev:web

# Worker（端口 8787）
cp worker/.dev.vars.example worker/.dev.vars   # 填入本地值（.dev.vars 已被 gitignore）
npm run db:migrate:local
npm run dev:worker
```

打开 http://localhost:4321 ，用 `worker/.dev.vars` 里的 `SITE_ACCESS_KEY` + 用户名 `admin` + `ADMIN_INITIAL_PASSWORD` 登录（仅当用户表为空时生效，登录后请立即重置密码）。

## 命令

| 命令 | 作用 |
| --- | --- |
| `npm run check` | TypeScript 类型检查 + astro check + secret-scan |
| `npm test` | vitest：领域校验、额度、权限、记录归属、prompt、Worker API 集成 |
| `npm run build` | 前端静态构建到 `web/dist` |
| `npm run build:pages` | 按 GitHub Pages 子路径形态构建（`PUBLIC_BASE_PATH=/tarot-astrology-site`）；本地预览需先起 Worker，或显式传 `PUBLIC_API_BASE_URL` 指向你的 API 地址 |
| `npm run check:base` | 子路径断链自检（配合 `build:pages` 使用；CI 在 build 之后、上传之前跑） |
| `npm run smoke` | 本地端到端冒烟：自动起 AI stub + wrangler dev，跑 29 条断言（登录/额度/CRUD/越权/邀请码） |
| `npm run cards:download` | 从 Wikimedia Commons 下载 78 张牌图并压成 WebP |
| `npm run cards:verify` | 校验 78 个 WebP 是否齐全 |

## 部署（概述）

完整步骤见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。顺序：

1. Cloudflare：建 D1、跑 migration、`wrangler deploy`、配 Secrets（名称清单见下）
2. GitHub 仓库 Settings → Secrets and variables → Actions → **Variables** 配置三项公开值：`SITE_URL`、`PUBLIC_BASE_PATH`、`PUBLIC_API_BASE_URL`（workflow 已用 `${{ vars.* }}` 读取，未配置则用占位默认值）
3. Worker 的 `ALLOWED_ORIGINS` 加上你的 Pages 域名
4. GitHub：Settings → Pages → Source 选 "GitHub Actions"，push 即部署

## Secrets 清单（只列名称与用途，值绝不入仓库）

| Secret | 用途 |
| --- | --- |
| `API_KEY` | OpenAI-compatible AI 服务密钥（默认示例 DeepSeek） |
| `SITE_ACCESS_KEY` | 登录三要素之一：站点访问密钥 |
| `SESSION_SECRET` | 会话 cookie 的 HMAC 签名密钥 |
| `ADMIN_INITIAL_PASSWORD` | 仅首次引导：用户表为空时用 `admin` + 此密码创建管理员，登录后必须改密 |

非敏感变量（`wrangler.toml` `[vars]`）：`GLOBAL_DAILY_AI_LIMIT`（默认 200）、`ALLOWED_ORIGINS`（CORS 白名单）、`COOKIE_SECURE`（生产必须 true）。

## 环境变量总表（`worker/.dev.vars` ↔ Cloudflare Secrets）

值绝不入仓库。本地复制 `.dev.vars.example` 填写；生产用 `wrangler secret put <NAME>`（Secret）或 `wrangler.toml [vars]`（非敏感）。

| 变量 | 类型 | 用途 |
| --- | --- | --- |
| `API_BASE_URL` | Secret（推荐） | OpenAI-compatible 基址，如 `https://api.deepseek.com/v1` |
| `API_KEY` | **Secret** | AI 服务密钥；只存在于 Worker 环境 |
| `MODEL_NAME` | Secret（推荐） | 模型名，如 `deepseek-chat` |
| `MAX_TOKENS` | 可选 | 单次解读输出上限，默认 900 |
| `TEMPERATURE` | 可选 | 采样温度，默认 0.8 |
| `SITE_ACCESS_KEY` | **Secret** | 登录三要素之一：站点访问密钥 |
| `SESSION_SECRET` | **Secret** | session cookie 的 HMAC 签名密钥（随机长串） |
| `ADMIN_INITIAL_PASSWORD` | **Secret** | 仅首次引导创建 admin 用，改密后可删除 |
| `GLOBAL_DAILY_AI_LIMIT` | 非敏感 | 全站每日 AI 上限默认值（`settings` 表优先） |
| `ALLOWED_ORIGINS` | 非敏感 | CORS 白名单，逗号分隔，如 `https://USERNAME.github.io` |
| `COOKIE_SECURE` | 非敏感 | 默认 `true`；仅本地 http 调试设 `false` |

前端只有一项公开变量：`PUBLIC_API_BASE_URL`（Worker 地址，构建期注入，非密钥）。

**管理员改密**：首次引导登录后，在「管理」页对自己的行点「重置密码」，或 `PATCH /api/admin/users/<自己的 id>` 传 `new_password`（管理员不能改自己的角色/停用自己，但可以改自己的密码）。改密后建议 `wrangler secret delete ADMIN_INITIAL_PASSWORD`。

## 额度规则

- 普通成员默认每日 20 次 AI 解读；管理员个人无上限
- 全站每日上限默认 200 次（`settings` 表 `global_daily_ai_limit`，管理员接口可查）
- 重置时刻：Asia/Shanghai 午夜
- 每次解读按顺序检查：登录 → 角色 → 个人额度 → 全站额度 → 输入校验 → 才调用 AI
- AI 失败时额度自动退还，返回明确错误，绝不输出伪装解读；未登录/额度耗尽时仍可查看牌名、位置与基础牌义

## 切换 AI 供应商（如 DeepSeek → 其他 OpenAI-compatible）

改 `.dev.vars` / Cloudflare Secrets 里的 `API_BASE_URL`、`MODEL_NAME`、`API_KEY` 即可，无需改代码。示例默认 `https://api.deepseek.com/v1` + `deepseek-chat`。

## 仓库安全

- `.gitignore` 排除 `.dev.vars`、`.env*`、构建产物、数据库文件
- `npm run secret-scan` 扫描 git 文件与 `web/dist`：密钥格式、敏感赋值、被追踪的密钥文件
- 示例数据全部为 `placeholder` / test 值；真实用户记录只存在于 D1

## 许可

- 代码：MIT
- Rider-Waite 牌面图像：1909 年 Pamela Colman Smith 作品，已进入公有领域，来源与说明见 [ASSETS_LICENSE.md](ASSETS_LICENSE.md)
