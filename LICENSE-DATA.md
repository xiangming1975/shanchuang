# 山窗 · 千年古诗文 —— 许可说明（分层）

本仓库同时包含两类东西：**站点代码** 与 **数据**。数据继承自 53 个许可各异的来源，
因此**不存在一个能覆盖全库的单一许可**。本文件按层声明，线上同一说明见
<https://shanchuang.pages.dev/#/src>。

> 这是来源与许可的事实说明，不构成法律意见。

## 1. 站点代码 —— MIT

范围：`site/` 下的 html / css / js（**不含** `site/data/`）、`etl/`、`tests/`、`server.js`。

```
MIT License

Copyright (c) 2026 山窗

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 2. 本站整理层 —— CC BY-NC-SA 4.0

范围（本站原创、不含第三方原文与译注）：

- 索引与分块结构：`idx/names`、`idx/ft`、`idx/chunkmap.json`、manifest 的 `span` / `chunks` / `start`
- 两轮去重归并的结果与 `dedup-remap.json`
- 校勘、繁简归一、词牌题名规范化等规范化结果
- 标签 / 体裁 / 朝代 / 名句的编排与分类
- 拼音、平仄、词同调模板等派生表（`idx/pingze.json`、`idx/citpl.json`、`idx/cipai.json`）
- 四时读诗选池、句库与飞花令语料的抽样与分片组织

许可：[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh) ——
可自由阅读、复制、非商业再分发；须署名「山窗」并同样以 CC BY-NC-SA 4.0 共享。

## 3. 第三方内容 —— 不重新授权

古籍原文、各家译文 / 注释 / 赏析 / 创作背景、索引底本，**保留各自原许可**，
本站不对其再许可。使用这些内容时须遵守原许可，例如：

| 原许可 | 代表来源 | 义务 |
|---|---|---|
| MIT | chinese-poetry、Werneror/Poetry、open-chinese/poetry-collection | 保留版权与许可声明 |
| Apache-2.0 | ZoneTwelve/chinese-poetry、yololzw、ModelScope 多数 | 保留声明、注明修改 |
| CC0 / ODC-By | Papersnake/gushiwen、jerry0723 | 无强制义务，建议署名 |
| CC BY 4.0 | teenycao/shewrote 原创层、OmniData 对联 | 署名 |
| CC BY-SA 4.0 | raynardj/zh-wenyanwen-wikisource（维基文库） | 署名 + 相同方式共享 |
| CC BY-NC 4.0 | PoetryMTEB 鉴赏、部分英文译本 | 署名 + **禁止商用** |
| **GPL-3.0** | JoyDraw/poetry-1、shenyunhang/gushiwen-crawler | 分发衍生须以 GPL-3.0 开源 |
| **LGPL-3.0** | PeiLei123456/ChinesePoetryFeiHuaLing | 同上，弱传染 |
| MPL-2.0 | byj233/ChinesePoetryLibrary | 文件级传染 |
| 未标注 / 站点自采 | VMIJUNV、aopao、daizhige、古文岛 / 古诗文网 / 诗词网 | 仅随本站作个人学习展示，本站不主张再许可权利 |

完整逐条清单（53 个来源的名称 / 网址 / 许可 / 内容备注）：线上 `#/src` 页，或
`site/js/views/sources.js` 的 `GROUPS` 常量。

## 4. 整库与商用

- **整库不可按任何单一许可整体再分发**：它同时含 MIT / Apache / CC0 / CC BY-SA /
  CC BY-NC / GPL-3.0 / LGPL-3.0 / 未标注 成分，任何单一许可都会与其中一部分冲突。
- **商用须逐源替换**：至少替换全部 GPL-3.0 / LGPL-3.0 成分、CC BY-NC 成分，
  以及古文岛 / 古诗文网 / 诗词网 的站点自采译注赏析。
- 若原站或权利人提出异议，应下架对应条目（勘误入口：站内 `#/j/<id>`）。
