# 山窗 · 千年古诗文

一个**纯静态**的中文古诗文阅读站：手机优先、单页应用、零照片素材（界面全 CSS + canvas 现场绘的水墨背景）。

- 线上：[shanchuang.pages.dev](https://shanchuang.pages.dev)（Cloudflare Pages）
- 规模：**79 个集合 · 2,145,874 条**记录（全唐诗、全宋诗、全宋词、古文观止、四库、二十四史、历代诗话等）
- 能力：标题/作者/正文搜索、拼音注音、逐字平仄、脚注弹卡、译文对照、朗诵、背诵（遗忘曲线 / 隐字自测）、摘录、分享卡、每日一诗、飞花令与接龙

> 本仓库只放**源码与文档**。`site/data/` 是构建产物（2.7GB / 约 1.4 万文件），不进版本库。

## 快速开始（含数据恢复）

数据不在仓库里，克隆后从 Release 取一份（2.62 GiB / 2 卷）：

```bash
git clone git@github.com:xiangming1975/shanchuang.git shanchuang
cd shanchuang
# 从 Releases 页下载两个数据卷到当前目录（见下方「数据快照」）
# https://github.com/xiangming1975/shanchuang/releases/tag/data-20261104
7z x shanchuang-data-20261104.7z.001 -o.   # 解第一个卷即自动串接 → site/data/
npm test                                    # 408 项，约 3 秒
node server.js 3737                         # 打开 http://localhost:3737
```

- 没装 7-Zip：Windows `winget install 7zip.7zip`，macOS `brew install p7zip`，Linux `apt install p7zip-full`。
- **不想下 2.6GB 也行**：只改前端代码的话跳过解包，`npm test` 仍可全绿（仓库内已带 4 张测试用的小表），
  只是浏览器里取不到正文。
- 换 Tag 换成最新一条即可，命名规则 `data-YYYYMMDD`。

## 目录结构

```
poetry-site/
├── site/                  ★ 网站本体（部署载荷）
│   ├── index.html         单页壳
│   ├── css/style.css      全部样式
│   ├── js/               app / store / views / regu / py / inkbg …
│   ├── fonts/            楷体子集（woff2，按全库用字裁到 4.14MB）
│   ├── icons/            PWA 图标与分享卡底图
│   ├── vendor/           pinyin-pro（按需加载）
│   └── data/             ← 构建产物，不入库（只留 4 张测试用的小表）
├── etl/                  数据流水线
│   └── legacy/           一次性整理脚本存档（不参与流程，供追溯）
├── tests/                408 项断言（纯函数 / 规则 / 外壳一致性 / 状态逻辑 / 农历 / 简繁）
├── server.js             零依赖静态服务器（gzip + Range）
├── build-home-verses.cjs 首页题诗的生成脚本
├── deploy-cf.sh          Cloudflare Pages 一键发布
├── patch-wrangler.mjs    调高 wrangler 上传并发（默认 3 太慢）
├── LICENSE-DATA.md       许可（分层声明）
├── AGENTS.md             给接手的 AI 的开工手册（git 流程、禁则、常见坑）
└── HANDOFF.md            交接文档：架构、数据、踩坑与决策记录（最重要的一份）
```

`HANDOFF.md` 是理解这个项目的入口，§6 是 53 个数据源的逐条清单与许可，
§12 是按日期排列的改动日志（踩过什么坑、为什么这么选）。

## 本地跑起来

```bash
node server.js 3737        # 打开 http://localhost:3737
npm test                   # 408 项，约 3 秒，零依赖
```

不要双击 `index.html`——ES modules + fetch 会被 `file://` 拦。

## 数据从哪来（clone 后是空壳，按优先级恢复）

`site/data/`（2.7GB / 约 1.4 万文件）是构建产物，不进版本库。新克隆的仓库 `node server.js`
能起，但页面取不到数据——**按下面优先级把数据弄回来，不要一上来就 build**：

| 优先级 | 做法 | 耗时 | 前提 |
|---|---|---|---|
| **① Release 解包**（推荐） | 下载数据分卷，解第一个卷即自动串接 | 几分钟 | 见下方「数据快照」 |
| **② 本地拷贝** | 同一台机器上把 `site/data/` 直接复制过来 | 几十秒 | 手上有备份（`site/data` 或 `../backup-json-20261103/`） |
| **③ build 重建** | `bash etl/safe-build.sh`（唯一入口） | 十几分钟，产出明文 5.87GB，还要 `pack` + `gz` | **最后手段**：只在要改数据/加集合时用；本机源已齐（preflight 通过） |

`build` 只在「要改数据 / 加集合」时才需要，单纯想跑起来不必走这条路。

`npm test` 不受影响：它只读 `site/data/idx/` 下 4 张小表（约 300KB，已随仓库分发），
所以**克隆后即使没有数据，测试也能全绿**。

### 数据快照（Release）

数据以 7-Zip 分卷随 Release 分发（GitHub 单个资产上限 2 GiB，故按 1.4GB 分卷）。

当前快照：**[data-20261104](https://github.com/xiangming1975/shanchuang/releases/tag/data-20261104)**（2.62 GiB / 2 卷 / 13,953 文件）。
新快照发布后，以 [Releases 页](https://github.com/xiangming1975/shanchuang/releases) 上最新的一条为准。

```powershell
# 打包（-mx=0 = 存储模式：内部已是 .json.gz，二次压缩无收益）
# 在仓库根执行，归档内路径为 site/data/...，解压后与仓库结构一致
7z a -mx=0 -v1400m shanchuang-data-YYYYMMDD.7z site\data

# 恢复：两个卷放同目录，解第一个即自动串接；解到仓库根就得到 site/data/
7z x shanchuang-data-YYYYMMDD.7z.001 -o.

# 校验（对照 release notes 记录的 SHA256）
Get-FileHash shanchuang-data-YYYYMMDD.7z.00* -Algorithm SHA256
```

- 单卷 1.4GB：GitHub 单个 Release 资产上限 **2 GiB**，留足余量。
- 上传：网页 Releases → Draft a new release → 拖两个卷；或用 `gh release upload`（可续传）。
- **release notes 里必须写两样**：每个卷的 SHA256，以及数据许可见
  [LICENSE-DATA.md](LICENSE-DATA.md)（分层许可，整库不可整体再许可）。

### 如果要重建或改数据

**构建的唯一入口是 `bash etl/safe-build.sh`**（自带 `ops/.build.lock`、备份 `site/data`、总量校验、失败回滚）。
不要直接跑 `npm run build` 或 `node etl/build.js`——绕过锁和备份，正是 2026-11-03 把 214 万条重建成 47 万条的事故原因。

```bash
bash etl/safe-build.sh          # 锁 → preflight → 备份 → build → 校验 total → 失败回滚
npm run pack -- --go            # 文件数 29,001 → 14,000（规避托管方 2 万文件上限）
npm run gz -- --go              # 明文 5.87GB → .gz 2.7GB（前端透明解压）
```

- **构建产出的是明文 `site/data`（约 5.87GB）**，`pack` + `gz` 两步必须跑完才算回到可部署形态。
- 本机 `etl/out/` 已有 **8.6GB 源**，`node etl/preflight.mjs` 可通过，`safe-build` 会真的跑全量构建
  （十几分钟量级）。换机器时才需要从 `../poetry-site-archive-20261027/` 用 `restore.js` 搬回原料。
- 数据源共 53 个（GitHub / Hugging Face / Kaggle / ModelScope / 站点采集），
  逐条清单与许可见 `HANDOFF.md` §6，线上镜像见 `#/src` 页。

## 发布

```bash
export CLOUDFLARE_API_TOKEN=...      # Account · Cloudflare Pages · Edit
export CLOUDFLARE_ACCOUNT_ID=...
npx wrangler pages deploy site --project-name shanchuang --branch main
```

- **不要用 `wrangler login`**：它要跳 `welcome.developers.workers.dev`，国内访问超时。
  改用 API Token，全程只碰 `api.cloudflare.com`。
- Pages 按内容哈希去重，只改 js/css/html 时通常只传几个文件、几秒完成。
- 托管方硬限制：每站 **20,000 文件**、单文件 **25MiB**——`pack` 与 `gz` 就是为这两条准备的。

## 许可

**分层声明，不存在覆盖全库的单一许可**：

| 层 | 范围 | 许可 |
|---|---|---|
| 站点代码 | `site/` 的 html/css/js、`etl/`、`tests/`、`server.js` | MIT |
| 本站整理层 | 索引与分块结构、去重归并、校勘与规范化、标签体裁编排、拼音平仄派生表 | CC BY-NC-SA 4.0 |
| 第三方内容 | 古籍原文、各家译文/注释/赏析 | 保留原许可，本站不重新授权 |

整库不可按任何单一许可再分发；**商用须逐源替换**（至少替换 GPL/LGPL 成分、CC BY-NC 成分与站点自采译注）。
完整条款见 [LICENSE-DATA.md](LICENSE-DATA.md)。

## 勘误

站内每篇详情的 ☰ 菜单有「✎ 勘误」，会把定位串（如 `唐 · 陳子昂《登幽州臺歌》（#/p/1）`）写进剪贴板。
改一个错字不需要重建全库，流程见 `HANDOFF.md` §12 相关条目。
