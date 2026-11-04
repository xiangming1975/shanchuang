# etl/legacy —— 一次性脚本存档

这里放的是 2026-10 ~ 11 月间为**单次数据整理**写的脚本（清洗、去重、对齐、校验、抓取、探测），
原先散落在仓库根目录，2026-11-04 统一收进此处。

## 它们不是流水线的一部分

现行流水线只有四个入口（`package.json` 的 scripts）：

```bash
npm run build   # etl/build.js      重建 site/data
npm run pack    # etl/pack-deploy-* 文件数瘦身
npm run gz      # etl/gzip-data-*   压缩为 .json.gz
npm test        # tests/*.test.mjs
```

`legacy/` 里的脚本**不会被任何流程调用**，保留的目的只有一个：**追溯这批数据是怎么来的**。
遇到「某条正文为什么少了某某段」「某个集合的 id 为什么从这里开始」这类问题，
答案往往就埋在这些脚本的注释与判定条件里。

## 使用注意

- 这些脚本写于仓库根目录，内部的相对路径（`./site/...`、`../downloads/...`）**假定当前目录是仓库根**。
  直接 `node etl/legacy/xxx.cjs` 会找不到文件；要复跑，先 `cd` 到仓库根并临时把路径改对，或把它复制回根目录。
- 多数脚本带 `--go` 之类的开关，默认只打印计划，不写盘。
- 部分脚本依赖 `etl/out/`、`downloads/` 下的中间产物或原始语料，这些都不在仓库里（见 `.gitignore`）。
- 脚本里的判定条件与当时的库状态绑定（集合数、id 跨度、字段名）。库里数据一变，判定可能失配——
  复跑前先看清它读什么、写什么。

## 分类速查

| 前缀 | 用途 |
|---|---|
| `dl_*` / `fetch_*` | 从各数据源拉取 |
| `convert_*` / `extract_v*` | 格式转换、EPUB/HTML 提取 |
| `merge_*` / `import_*` / `dedup*` | 合并、导入、去重 |
| `align_*` / `zt_*` | 简繁/注疏对齐与回写 |
| `audit*` / `check_*` / `verify_*` / `scan_*` / `inspect_*` | 审计与校验 |
| `reindex-*` / `postprocess` / `clean_*` | 重建索引、后处理、清理 |
| `probe_env.py` | 环境探测（一次性） |
