# 部署手册

从零到线上：Cloudflare Worker + D1 → GitHub Pages。全程不需要在仓库中放任何密钥。

## 0. 前置

- Cloudflare 账号（免费版即可）
- GitHub 账号
- 本地已装 Node ≥ 22、`npx wrangler`（本仓库 devDependencies 已含 wrangler）

## 1. Cloudflare D1

```bash
cd worker
npx wrangler d1 create tarot-astrology
```

把输出的 `database_id` 填入 `worker/wrangler.toml`（这是资源 ID，不是密钥）。然后建表：

```bash
npx wrangler d1 migrations apply tarot-astrology --remote
```

D1 里只有表结构和 `settings` 基础配置（全站额度默认 200），没有任何用户数据。

## 2. 配置 Secrets

```bash
cd worker
npx wrangler secret put API_KEY              # AI 服务密钥
npx wrangler secret put API_BASE_URL         # AI 服务基址，如 https://api.deepseek.com/v1（必需，缺失则解读一律 502）
npx wrangler secret put MODEL_NAME           # 模型名，如 deepseek-chat（必需）
npx wrangler secret put SITE_ACCESS_KEY      # 站点访问密钥（自定一个强随机串）
npx wrangler secret put SESSION_SECRET       # 随机长字符串
npx wrangler secret put ADMIN_INITIAL_PASSWORD  # 首次引导用，创建 admin 后可删除此 secret
```

`wrangler.toml` 的 `[vars]` 里改两处非敏感值：

- `ALLOWED_ORIGINS`：加你的 Pages 域名，如 `https://USERNAME.github.io`（逗号分隔多个）
- `GLOBAL_DAILY_AI_LIMIT`：全站每日 AI 上限，默认 200

## 3. 部署 Worker

```bash
cd worker
npm run deploy   # 即 npx wrangler deploy
```

记下输出的地址，如 `https://tarot-astrology-api.<你的子域>.workers.dev`。

## 4. 初始化管理员

用 curl 或浏览器确认 Worker 活着：

```bash
curl https://<worker地址>/api/health   # {"ok":true}
```

此时 `users` 表为空。打开前端登录页（或 curl POST /api/login），输入：

- 站点访问密钥 = `SITE_ACCESS_KEY`
- 用户名 = `admin`
- 密码 = `ADMIN_INITIAL_PASSWORD`

系统创建首个管理员（`must_change_password=true`）。之后：

1. 用 `PATCH /api/admin/users/<admin_id>` 的 `new_password` 或让管理员账号尽快改密；
2. 改密后可 `wrangler secret delete ADMIN_INITIAL_PASSWORD`。

## 5. 创建用户 / 邀请码

两种方式（详见 [ADMIN_GUIDE.md](ADMIN_GUIDE.md)）：

- 管理页直接创建用户（用户名 + 初始密码）
- 管理页生成一次性邀请码发给受邀人，对方在登录页「使用邀请码激活账号」自设密码

## 6. GitHub Pages

1. 把仓库推到 GitHub（public / private 均可；Pages Actions 部署对 private 仓库需 Pro）。
2. 仓库 Settings → Secrets and variables → Actions → **Variables** 新建三项（都是公开值）：
   - `SITE_URL` = `https://<username>.github.io`
   - `PUBLIC_BASE_PATH` = `/<repo-name>`
   - `PUBLIC_API_BASE_URL` = 第 3 步的 Worker 地址
   workflow 通过 `${{ vars.* }}` 注入，未配置时使用文件内占位默认值（构建仍成功，但前端会连错 API）。
3. GitHub 仓库 Settings → Pages → Build and deployment → Source 选 **GitHub Actions**。
4. push 到 `main` 触发部署；Actions 全绿后访问 `https://USERNAME.github.io/<repo>/`。
5. 回到 Worker 配置，确认 `ALLOWED_ORIGINS` 包含该域名（否则浏览器会被 CORS 拒绝）。

## 7. 牌面图像（可选但推荐）

仓库内已含极简占位 SVG，无网络也能跑。下载真实 Rider-Waite 图：

```bash
npm run cards:download   # Wikimedia Commons 公有领域，压成 WebP
npm run cards:verify     # 校验 78 张齐全
git add web/public/cards && git commit -m "assets: rider-waite webp"
```

## 8. 验证清单

- [ ] 未登录打开任何页面 → 只见登录页
- [ ] 登录需要站点访问密钥 + 用户名 + 密码
- [ ] 抽牌 → AI 解读 → 保存 → 历史可见
- [ ] 成员看不到「管理」入口；直接调 `/api/admin/*` 返回 403
- [ ] 额度耗尽时 AI 解读返回明确原因（429）
- [ ] `npm run check`、`npm test`、`npm run build` 全绿

## 附录：API 端点总表（与 worker/src 实际路由一致）

所有路由前缀 `/api`（Hono `basePath('/api')`）。

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/health` | 公开 | 健康检查 `{ok:true}` |
| POST | `/api/login` | 公开 | 站点访问密钥 + 用户名 + 密码；首次引导创建 admin |
| POST | `/api/logout` | 公开 | 吊销当前 session |
| POST | `/api/redeem` | 公开 | 邀请码 + 站点密钥 + 用户名 + 自设密码 |
| GET | `/api/me` | 登录 | 当前用户信息 |
| GET | `/api/readings` | 登录 | 列表；`?scope=all` 仅 admin 生效 |
| POST | `/api/readings` | 登录 | 新建记录（含可选 ai_interpretation） |
| GET | `/api/readings/:id` | 登录 | 本人或 admin，否则 404 |
| PATCH | `/api/readings/:id` | 登录 | 改问题/备注/标签；本人或 admin |
| DELETE | `/api/readings/:id` | 登录 | 本人或 admin |
| POST | `/api/interpret` | 登录 | 登录→角色→个人额度→全站额度→校验→AI |
| GET | `/api/stats` | 登录 | 本人统计；`?scope=all` 仅 admin |
| GET | `/api/quota` | 登录 | 个人与全站额度、重置时间 |
| GET | `/api/admin/users` | admin | 用户列表 + 今日用量 |
| POST | `/api/admin/users` | admin | 创建用户 |
| PATCH | `/api/admin/users/:id` | admin | 角色/额度/启停/重置密码；不能改自己的角色或停用自己 |
| GET | `/api/admin/invite-codes` | admin | 邀请码列表与状态 |
| POST | `/api/admin/invite-codes` | admin | 生成一次性邀请码 |
| GET | `/api/admin/stats` | admin | 全站统计、各用户用量、邀请码 |

## 9. 常见问题

- **CORS 报错**：`ALLOWED_ORIGINS` 没包含 Pages 域名，或带末尾斜杠不一致（配置不带斜杠）。
- **401 循环跳登录**：cookie 被浏览器丢弃 —— 生产环境 `COOKIE_SECURE` 必须为 true 且站点是 HTTPS（Pages 天然满足）；本地调试用 `.dev.vars` 里 `COOKIE_SECURE=false`。
- **AI 无响应**：`API_KEY`/`API_BASE_URL`/`MODEL_NAME` 配置错误时，/api/interpret 返回 502 且不扣额度。
