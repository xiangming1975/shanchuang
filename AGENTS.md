# AGENTS.md — 给接手的 AI 的开工手册

> 你在一台 Windows 机器上，目录 `C:\Users\xiang\Downloads\poetry-site`（Git Bash 下 `/c/Users/xiang/Downloads/poetry-site`）。
> 这是一个**纯静态**中文古诗文站，线上 https://shanchuang.pages.dev（Cloudflare Pages）。
> 仓库只放代码与文档，**数据不在仓库里**。你的任务通常是：改代码或文档 → 跑测试 → 提交 → 推送。

---

## 0. 三条铁律

1. **不要自行发起构建。** 构建的**唯一入口**是 `bash etl/safe-build.sh`（自带 `ops/.build.lock`、备份 `site/data`、总量校验、失败回滚）。
   **禁止直接跑 `npm run build`，更禁止直接 `node etl/build.js`**——绕过锁与备份，正是 2026-11-03 把 214 万条重建丢成 47 万条、差点覆盖线上的事故原因。
   另注意：构建产出的是**明文** `site/data`（约 5.87GB），要部署必须再跑 `npm run pack -- --go && npm run gz -- --go` 才回到 `.gz` 形态（2.7GB）。
   要不要构建，永远由用户决定；`HANDOFF.md` §0 与 `ops/state.json` 是这条规约的原始出处。

   **用户已明确要求（2026-11-04，强制）：重建数据必须先问他，并说清为什么要 build。**
   - 他**不再打算增加数据集容量**，容量维持 **214 万 / 79 集合**。
   - 勘误改为**每几个月集中一次**，只在那一批集中勘误时才 build。
   - 因此「build 一下更保险」「顺手重建」都不是理由。说不出具体必要性，就不要提这件事。
   - 单篇改错字仍按 §5 的办法做（改 `.gz` 里那条记录 + bump `manifest.v`），**不要**为改一个错字就 build。
2. **不要把 `site/data` 放进 git**。`.gitignore` 已经挡住，**不要用 `git add -f` 绕过**。
3. **不要 `git push --force`、不要删 `.git`、不要改写历史**。这个仓库只有一条 `main` 分支，没有需要强推的场景。

---

## 1. 环境事实（先记住，省得撞墙）

| 项 | 值 |
|---|---|
| 远程 | `git@github.com:xiangming1975/shanchuang.git`（已配好，`main` 跟踪 `origin/main`） |
| 网络现实 | `github.com:443`、`api.github.com`、`github.com:22` **都不通**；只有 **`ssh.github.com:443`** 可达 |
| 解决方式 | `~/.ssh/config` 已把 `Host github.com` 映射到 `ssh.github.com:443`，所以**直接 `git push` 即可，不要加任何参数** |
| Node | v22（若终端找不到 `node`，PATH 里加 `C:\Users\xiang\.workbuddy\binaries\node\versions\22.22.2-6`） |
| 身份 | 仓库级 `xiangming1975 <xiangming1975@users.noreply.github.com>` |

**如果 push 报 `Permission denied (publickey)`**：SSH 私钥没了或未登记。执行 `ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519`，把 `~/.ssh/id_ed25519.pub` 的内容**原样交给用户**，请他在 https://github.com/settings/keys 添加。不要尝试 `wrangler login` 或任何浏览器 OAuth，那些域名一样不通，也帮不上 Git。

---

## 2. 开工先读三样

1. `HANDOFF.md` — 交接文档，**最重要**。§0 是多会话协作规约（构建/发布的独占规则），§6 是 53 个数据源与许可，§12 是按日期的改动日志（踩过什么坑、为什么这么选）。
2. `README.md` — 结构、许可、发布、数据恢复。
3. `ops/state.json` — 上一次 build / deploy 的记录与数据基线（`manifest.total` 应为 **2,145,874 / 79 集合**，低于此值视为事故）。
4. `site/js/` — 前端源码；`tests/` — 测试（当前 408 项，零依赖，3 秒跑完）。**这个数字会随测试增删而变，一律以 `npm test` 的实际输出为准**，不要拿本手册的数字当断言。

---

## 3. 日常流程（只改代码/文档）

```bash
cd /c/Users/xiang/Downloads/poetry-site
npm test                     # 必须全绿，红了先修再提交
git add -A
git status --short           # 逐行看一眼，确认没有意外的文件
git commit -m "一句话说清改了什么"
git push                     # 走 ssh-443，几秒钟
```

- 提交信息用**中文、一句话、动词开头**，例如：`阅读页：修复长句换行断字`。
- `git add -A` 之后，若 `git status` 里出现 `site/data/` 下**多于 4 个**文件，立刻停下——说明 `.gitignore` 被人改过，先查原因。

---

## 4. 什么该进 git，什么不该

| 进 | 不进 |
|---|---|
| `site/` 的 html / css / js / fonts / icons / vendor | `site/data/` 其余全部（2.7GB 产物） |
| `etl/`（管线脚本与配置）、`etl/legacy/`（一次性脚本存档） | `etl/out/`、`etl/node_modules/`、`etl/downloads/` |
| `tests/`（含 4 张测试依赖的小表，约 300KB） | `archive/`、`backup-*/`、`_data_backup_*`、`audit-*` |
| `README.md`、`HANDOFF.md`、`LICENSE-DATA.md`、`AGENTS.md`、`Review-*.md` | `node_modules/`、`*.log`、`*.zip`、根目录散落 `*.json` |
| `server.js`、`package.json`、`deploy-cf.sh`、`.gitignore`、`.gitattributes` | `cf-token.txt`（凭据，**绝不能入库**） |

`site/data/` 里**只有 4 个文件**允许入库：`idx/pingze.json`、`idx/t2s.json.gz`、`idx/s2t.json.gz`、`idx/s2td.json.gz`。它们是测试要读的。

---

## 5. 数据相关的三种任务

| 任务 | 要不要 build | 说明 |
|---|---|---|
| **改某篇正文的一个错字** | 不要 | 改 `site/data/poems/<集合>-<NNNN>.json.gz` 里那条记录，并 bump `manifest.json` 的 `v`（否则读者缓存不失效）。要写成幂等脚本放 `etl/`，详细做法见 `HANDOFF.md` §12 |
| **加新集合 / 重建全库** | 要，且只能 `bash etl/safe-build.sh` | 先跑 `node etl/preflight.mjs` 自检（当前可通过）。构建后必须 `npm run pack -- --go && npm run gz -- --go`。**必须用户明确要求，不要自行发起** |
| **出新数据快照到 Release** | 不要 | `7z a -mx=0 -v1400m ... site/data` 分卷，然后由**用户手动**在网页上传（`api.github.com` 不通） |

> 现状提醒：`etl/out/` 现有 **8.6GB 源**（`poems3/poems4/poems-extra79` 等），`node etl/preflight.mjs` **当前是通过的**。
> 也就是说 `safe-build.sh` **会真的跑起一次全量构建**（十几分钟量级，脚本已设 10GB 堆），不是空跑保护。
> 它跑完 `site/data` 会变成**明文 5.87GB**，必须 `pack → gz` 才回到 2.7GB 的可部署形态、才能上线。
> 所以这条命令只在用户明确要求重建时用；跑之前请先确认 `HANDOFF.md` §0 的独占规则（同一时刻只允许一个会话构建）。

数据恢复（新克隆的仓库）见 `README.md` 的「快速开始」。

---

## 6. 发布到线上（只有用户要发布时才做）

```bash
cd /c/Users/xiang/Downloads/poetry-site
export CLOUDFLARE_API_TOKEN=$(tr -d ' \r\n\t' < /c/Users/xiang/Downloads/cf-token.txt)
export CLOUDFLARE_ACCOUNT_ID=ff00756871f02220c9ab555b616143b5
npx --yes wrangler@latest pages deploy site --project-name shanchuang --branch main --commit-dirty=true
```

- **绝不要用 `wrangler login`**：它要跳 `welcome.developers.workers.dev`，国内超时。用上面的 API Token。
- `bash deploy-cf.sh --skip-build` 是等价入口（`wrangler pages deploy` + 同步 CloudBase 镜像）。`HANDOFF.md` §0 说的「只改代码一律 `--skip-build`」即指此路。但 CloudBase 体验版 3GB 已用约 2.62GB，**通常不必同步镜像**，直接用上面的 wrangler 命令即可。
- 只改 js/css/html 时通常只传几个文件、几秒完成（Pages 按内容哈希去重）；全套数据只在首次上传时需要 11 分钟。
- Token 失效时：请用户在控制台重建一个 `Account · Cloudflare Pages · Edit` 的 Token，存回 `cf-token.txt`。用完可提醒他吊销。
- 托管方硬限制：每站 **20,000 文件**、单文件 **25MiB**。`pack` 与 `gz` 就是为这两条准备的。

---

## 7. 常见坑（都真实踩过）

| 现象 | 原因 | 处理 |
|---|---|---|
| 页面某处一直「加载中」，详情页说「作品不存在」 | Cloudflare Pages 对缺失路径会回 `index.html` + **200**，前端把 HTML 当 JSON | 站根已有 `site/404.html`；`store.js` 的 `cachedText` 用 `content-type` 判真假。改取数逻辑时别只判 `resp.ok` |
| 首屏卡死不报错 | 某些 Edge 配置下 `indexedDB.open` 永不返回 | `store.js` 已给 `openDB`/`idbGet` 加 3 秒 `withTimeout`，不要移除 |
| `wrangler` 上传巨慢或 `HeadersTimeoutError` | 默认并发 3；大文件单请求超时 | 见 `patch-wrangler.mjs`；数据已压成 `.gz`，最大 ~7MB |
| commit 时满屏 `LF will be replaced by CRLF` | 系统级 `core.autocrlf=true` | 已有 `.gitattributes`（`* text=auto eol=lf`），忽略即可 |
| `.gz` 文件被改坏 | 被当文本做了换行转换 | `.gitattributes` 已标 `*.gz binary`，不要删这条 |

---

## 8. 完工标准（四项都满足才算做完）

1. `npm test` 全绿（当前 408 项；**数量以实际输出为准**，只要 0 失败即可）。
2. `git status` 干净，没有遗漏或多余文件。
3. 远端与本地一致：`git ls-remote origin | grep main` 与 `git rev-parse HEAD` 相同。
4. 若改了站点行为，线上抽查一次（用浏览器或 curl，看目标页真的变对了）。

---

## 9. 什么时候停下来问用户

- 要动数据（改正文、加集合、重建）——**先问**。
- 要发布上线——**先问**。
- `npm test` 红了但原因不在你这次的改动——先报告，不要顺手改别的。
- 需要 Token / 密钥 / 网页操作（创建仓库、上传 Release、加 SSH key）——这些 AI 做不了，**给用户精确步骤**，别自己试。
