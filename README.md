# 山窗 · 千年古诗文

一个**纯静态**的中文古诗文阅读站：手机优先、单页应用、零照片素材（界面全 CSS + canvas 现场绘的水墨背景）。

- 线上：**https://shanchuang.pages.dev**（Cloudflare Pages）
- 规模：**79 个集合 · 2,145,874 条**记录（全唐诗、全宋诗、全宋词、古文观止、四库、二十四史、历代诗话等）
- 能力：标题/作者/正文搜索、拼音注音、逐字平仄、脚注弹卡、译文对照、朗诵、背诵（遗忘曲线 / 隐字自测）、摘录、分享卡、每日一诗、飞花令与接龙

> 本仓库只放**源码与文档**。`site/data/` 是构建产物（2.7GB / 约 1.4 万文件），不进版本库，
> 详见下面的「数据从哪来」。

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
├── tests/                407 项断言（纯函数 / 规则 / 外壳一致性 / 状态逻辑 / 农历 / 简繁）
├── server.js             零依赖静态服务器（gzip + Range）
├── build-home-verses.cjs 首页题诗的生成脚本
├── deploy-cf.sh          Cloudflare Pages 一键发布
├── patch-wrangler.mjs    调高 wrangler 上传并发（默认 3 太慢）
├── LICENSE-DATA.md       许可（分层声明）
└── HANDOFF.md            交接文档：架构、数据、踩坑与决策记录（最重要的一份）
```

`HANDOFF.md` 是理解这个项目的入口，§6 是 53 个数据源的逐条清单与许可，
§12 是按日期排列的改动日志（踩过什么坑、为什么这么选）。

## 本地跑起来

```bash
node server.js 3737        # 打开 http://localhost:3737
npm test                   # 407 项，约 3 秒，零依赖
```

不要双击 `index.html`——ES modules + fetch 会被 `file://` 拦。

## 数据从哪来（clone 后是空壳，按优先级恢复）

`site/data/`（2.7GB / 约 1.4 万文件）是构建产物，不进版本库。新克隆的仓库 `node server.js`
能起，但页面取不到数据——**按下面优先级把数据弄回来，不要一上来就 build**：

| 优先级 | 做法 | 耗时 | 前提 |
|---|---|---|---|
| **① Release 解包**（推荐） | 下载数据分卷，解第一个卷即自动串接 | 几分钟 | 见下方「数据快照」 |
| **② 本地拷贝** | 同一台机器上把 `site/data/` 直接复制过来 | 几十秒 | 手上有备份（`site/data` 或 `../backup-json-20261103/`） |
| **③ build 重建** | `npm run build` 从原始语料重新生成 | 3–7 分钟 + 恢复 3.2GB | **最后手段**：需 `../poetry-site-archive-20261027/` 的原始语料 |

`build` 只在「要改数据 / 加集合」时才需要，单纯想跑起来不必走这条路。

`npm test` 不受影响：它只读 `site/data/idx/` 下 4 张小表（约 300KB，已随仓库分发），
所以**克隆后即使没有数据，测试也能全绿**。

### 数据快照（Release）

数据以 7-Zip 分卷随 Release 分发（GitHub 单个资产上限 2 GiB，故按 1.4GB 分卷）：

```powershell
# 打包（-mx=0 = 存储模式：内部已是 .json.gz，二次压缩无收益）
7z a -mx=0 -v1400m shanchuang-data-YYYYMMDD.7z site\data
7z x shanchuang-data-YYYYMMDD.7z.001 -o.     # 恢复：解第一个卷即可
```

上传用 `gh release upload`（网页拖拽也行，但 CLI 可续传、可脚本化）。
每个卷请附 SHA256，并在 release notes 写明数据许可见 [LICENSE-DATA.md](LICENSE-DATA.md)。

### 如果要重建或改数据

```bash
npm run build   # etl/build.js      从原始语料重建 site/data（需先恢复 3.2GB 归档）
npm run pack    # etl/pack-deploy-* 文件数 29,001 → 14,000（规避托管方 2 万文件上限）
npm run gz      # etl/gzip-data-*   5.87GB → 2.7GB（.json.gz，前端透明解压）
```

- 原始语料与 ETL 中间产物在 `../poetry-site-archive-20261027/`（2.0GB + 1.27GB），
  用该目录下的 `restore.js` 搬回，`build.js` 缺输入时会直接打印恢复命令。
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
