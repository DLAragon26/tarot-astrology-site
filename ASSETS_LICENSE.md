# 资产来源与许可

## Rider-Waite 塔罗牌面

- **作品**：Rider-Waite Tarot Deck（1909），由 Pamela Colman Smith 绘制，Arthur Edward Waite 指导。
- **版权状态**：该作品于 1909 年出版，作者（Smith 1951 年逝世）创作年代远早于适用保护期，已进入**公有领域**（Public Domain）。
- **图源**：Wikimedia Commons「Rider-Waite tarot deck」分类：
  https://commons.wikimedia.org/wiki/Category:Rider-Waite_tarot_deck
- **获取方式**：优先使用 `npm run cards:download` 经 Commons API 下载；网络只能通过浏览器访问时，使用 `npm run cards:import -- --from <目录>` 导入官方 PNG。两种方式都会压缩为 WebP（宽 480px，质量 80），命名规则 `rw-<NN>-<slug>.webp`，与 `shared/src/cards.ts` 中的数据一一对应。
- **具体文件对应关系**：见 `scripts/card-sources.json`（下载脚本自动生成，记录每张 webp 对应的 Commons 文件名）。
- **使用方式**：图片已随仓库静态分发（不热链外部地址）；加载失败时回退到自制占位 SVG（`web/public/cards/placeholders/`）。

### 各主要文件的典型 Commons 来源（示例）

| 本仓库文件 ID | Commons 文件 | 许可 |
| --- | --- | --- |
| rw-00-fool.webp | RWS_Tarot_00_Fool.jpg | Public domain |
| rw-13-death.webp | RWS_Tarot_13_Death.jpg | Public domain |
| rw-14-ace-pentacles.webp（小阿卡纳同理） | RWS_Tarot_01_Pents.jpg 等 | Public domain |

完整映射以 `scripts/card-sources.json` 为准。

## 占位牌图与卡背

`web/public/cards/placeholders/*.svg` 与 `card-back.svg` 为本项目自制（极简几何线条），随项目以 MIT 许可发布。

## 星座图标

`web/public/zodiac/*.svg` 为本项目自制（圆环 + Unicode 占星符号渲染），随项目以 MIT 许可发布。

## 字体

前端使用系统无衬线字体栈（system-ui / PingFang SC / Noto Sans SC 等），不分发字体文件，无额外许可义务。
