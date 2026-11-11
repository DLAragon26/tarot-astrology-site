# 安全说明

## 密钥与凭据

仓库中只有占位符。真实密钥只存在于：

- 本地：`worker/.dev.vars`（已 gitignore，由 `.dev.vars.example` 复制而来）
- 生产：Cloudflare Secrets（`wrangler secret put` 或控制台配置）

| 名称 | 存放位置 | 说明 |
| --- | --- | --- |
| `API_KEY` | Cloudflare Secret | AI 服务密钥；前端永不接触 |
| `SITE_ACCESS_KEY` | Cloudflare Secret | 登录三要素之一 |
| `SESSION_SECRET` | Cloudflare Secret | session cookie 的 HMAC 签名 |
| `ADMIN_INITIAL_PASSWORD` | Cloudflare Secret | 仅首次引导；创建管理员后建议删除 |

`PUBLIC_API_BASE_URL` 是公开的 API 地址（GitHub Pages 域名同理），不是密钥，可以出现在前端构建产物里。

## 认证与会话

- 登录必须输入站点访问密钥 + 用户名 + 密码；任一错误返回同一句 401 文案，不泄露是哪一项错。
- 无公开注册。账号只能由管理员创建，或用管理员生成的一次性邀请码激活。
- 密码用 PBKDF2-SHA256（120,000 迭代、16B 随机盐、32B 派生键）哈希存储，恒时比较防时序侧信道。
- Session：32B 随机 token；D1 只存 SHA-256 摘要；cookie 值带 HMAC 签名，篡改即失效。
- Cookie：`tq_session`，`HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`（7 天）。仅本地 http 调试可通过 `.dev.vars` 设 `COOKIE_SECURE=false`，生产强制 Secure。
- 重置密码或停用账号会立即吊销该用户全部会话。

## 权限模型

- 权限判断全部在后端，前端只做界面引导。
- 未登录访问任何数据接口 → 401。
- 所有 `/api/admin/*` 校验 admin 角色 → 否则 403。守卫双挂 `app.use('/admin', …)` + `app.use('/admin/*', …)`，精确路径与子路径都覆盖。
- 所有用户数据接口校验归属：member 读/改/删他人记录一律 404（不泄露存在性）；admin 可查全部（显式 `scope=all`）。
- AI 功能必须登录；额度检查顺序固定：登录 → 角色 → 个人额度 → 全站额度 → 输入校验 → 调用 AI。

## AI 使用边界

System prompt 固化在 `shared/src/prompts.ts`：只做心理反思、象征解读与塔罗结构解读；不做确定性预言；不提供医疗、投资、法律建议；不用宿命论语气；输出简体中文；必须引用问题、位置、牌名与正逆位；限长防模板化。额度耗尽或上游失败时返回明确错误码，绝不输出伪装解读。

## CORS

只允许 `ALLOWED_ORIGINS` 白名单（生产为你的 GitHub Pages 域名，可加 Worker 自身域），其余一律 403，含预检请求。带凭据的响应使用具体 Origin，不用 `*`。

## 数据

- 真实用户记录只存 Cloudflare D1，绝不进 Git。
- `.gitignore` 排除 `.dev.vars`、`.env*`、`*.db`、构建产物与日志。
- `npm run secret-scan` 在 `npm run check` 中自动执行：扫描密钥格式（`sk-…`、私钥块、Google key）、敏感赋值（值必须是占位符）、被 git 追踪的密钥文件与数据库导出，并覆盖 `web/dist` 构建产物。

## 已知取舍（MVP）

- 管理员首次引导密码（`ADMIN_INITIAL_PASSWORD`）在改密前是可登录凭据：创建 admin 后请立即改密并删除该 Secret。
- Session 吊销以删除 D1 记录实现，紧急情况可通过改 `SESSION_SECRET` 立即废掉全部会话。
- **登录无限流/锁定**：登录无验证码、无失败次数限制、无速率限制。私有站点 + 三要素登录（站点密钥不可猜）降低风险，但这不是硬防护；公网暴露时建议在 Worker 前加 Cloudflare WAF / Rate Limiting 规则。
- **额度检查与自增非原子**：`/api/interpret` 先检查额度、再 `INSERT … ON CONFLICT DO UPDATE count+1`、AI 失败时 `-1` 退还。单请求语义正确（失败不计次），但并发双请求下可能轻微超发（最多超出并发数）；私人站点可接受，不宣称"严格不超发"。
- **额度耗尽优先于输入校验**：检查顺序为 登录→角色→个人额度→全站额度→输入校验→调 AI，因此额度耗尽时非法输入也返回 429 而非 400（这是有意的顺序契约）。
- **secret-scan 两层机制**：自动扫描覆盖高熵格式（`sk-`/`AIza`/`AKIA`/`ghp_`/PEM 等）与配置类文件的 `key=value`；源码中自造形态的硬编码长串（非上述格式）属于扫描器盲区，发布前应配合人工 review / `git log -p` 二次检查。
- 统计在 JS 侧全表聚合（私人站点数据量小）；记录量级增大后需改为按时间窗分批。
