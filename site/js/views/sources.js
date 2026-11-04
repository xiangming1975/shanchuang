// 页面：数据来源（#/src）
// 内容取自《数据来源说明》（C:/Users/xiang/Downloads/数据来源说明.md）：
// 从 53 个采集来源中挑出主库实际使用的部分，逐条列出「数据集名称 / 网址 / 版权 / 内容备注」。
// 主库数据由 dataset_dedup（去重库）并入，未纳入的英文译文、评测基准、0 条入库等来源单独说明。
import { app } from '../vcommon.js';
import { esc } from '../py.js';

const PAD = '<div class="page-pad"></div>';

// 主库实际使用的来源（经导入/注释/体裁/新诗各线核对）。
// 字段：name 数据集名称；links 网址（[href, 文本]）；lic 版权；note 内容备注。
const GROUPS = [
  {
    title: 'GitHub 开源仓库',
    items: [
      { name: 'chinese-poetry/chinese-poetry · 全唐诗宋诗宋词', lic: 'MIT（Copyright © 2016 JackeyGao）',
        links: [['https://github.com/chinese-poetry/chinese-poetry', 'github.com/chinese-poetry/chinese-poetry']],
        note: '取唐诗、宋诗、宋词、元曲、蒙学等子集。上游 README 自述「数据来源于互联网」。' },
      { name: 'VMIJUNV/chinese-poetry-and-prose · 84万篇', lic: '未标注（仓库无 LICENSE）',
        links: [['https://github.com/VMIJUNV/chinese-poetry-and-prose', 'github.com/VMIJUNV/chinese-poetry-and-prose']],
        note: '84 万篇，含译文/赏析/热度。正文含少量用 ASCII 尖括号包裹的生僻字（如“骖马非”占位），已按原样保留。' },
      { name: 'Werneror/Poetry · 85万首古诗词', lic: 'MIT',
        links: [['https://github.com/Werneror/Poetry', 'github.com/Werneror/Poetry']],
        note: '85 万余首，字段为题目/朝代/作者/正文。' },
      { name: 'JoyDraw/poetry-1 · 古诗文网2017·译文注释赏析', lic: 'GPL-3.0',
        links: [['https://github.com/JoyDraw/poetry-1', 'github.com/JoyDraw/poetry-1']],
        note: '2017 年古诗文网爬取数据，含译文/注释/赏析/创作背景。' },
      { name: 'Imposingapple/scrapy_poetry · 宋词·注释创作背景', lic: '未标注（仓库无 LICENSE）',
        links: [['https://github.com/Imposingapple/scrapy_poetry', 'github.com/Imposingapple/scrapy_poetry']],
        note: '按爱情、七夕等分类采集宋词，含注释与创作背景。' },
      { name: 'yht050511/gushiwen · 古诗文网·10万首', lic: 'MIT',
        links: [['https://github.com/yht050511/gushiwen', 'github.com/yht050511/gushiwen']],
        note: '古诗文网 2022 年爬取，108,197 首，sons 内含译文/注释/赏析。' },
      { name: 'shenyunhang/gushiwen-crawler · 古诗文网爬虫文本', lic: 'GPL-3.0',
        links: [['https://github.com/shenyunhang/gushiwen-crawler', 'github.com/shenyunhang/gushiwen-crawler']],
        note: '古诗文网全量 HTML + txt（50,880 个 txt）。' },
      { name: 'aopao/chinese-gushiwen · 古诗文10000篇', lic: '未标注（仓库无 LICENSE）',
        links: [['https://github.com/aopao/chinese-gushiwen', 'github.com/aopao/chinese-gushiwen']],
        note: '古籍 1 万 + 名句 1 万 + 作者 3,983；含 remark/shangxi/translation/audioUrl 字段。' },
      { name: 'zhouzhaoxin/GuShiWen · 唐诗三百首·结构化', lic: '未标注（仓库无 LICENSE）',
        links: [['https://github.com/zhouzhaoxin/GuShiWen', 'github.com/zhouzhaoxin/GuShiWen']],
        note: '唐诗三百首结构化数据，320 首。' },
      { name: 'sfw2099/poetry-dataset · 诗歌数据集（合并 3 源）', lic: 'README 声明 MIT（合并数据继承上游许可）；仓库未附 LICENSE 文件',
        links: [['https://github.com/sfw2099/poetry-dataset', 'github.com/sfw2099/poetry-dataset']],
        note: '先秦至近现代 1,197,883 首；version>0 为同诗异文。上游合并：chinese-poetry（MIT）、Werneror/Poetry（MIT）、cdn0x12/poetic-mao（未标注）。' },
      { name: 'teenycao/shewrote · 中国古代女诗人', lic: '分层许可：原创结构化层 CC BY 4.0；CBDB 派生字段 CC BY-NC-SA 4.0；代码 MIT',
        links: [['https://github.com/teenycao/shewrote', 'github.com/teenycao/shewrote']],
        note: '12,246 首女诗人作品。CBDB 来源：https://cbdb.hsites.harvard.edu/。' },
      { name: 'open-chinese/poetry-collection · 诗歌总集37万', lic: 'MIT',
        links: [['https://github.com/open-chinese/poetry-collection', 'github.com/open-chinese/poetry-collection']],
        note: '370 卷 / 369,597 篇，另有 19,058 条 AI 鉴赏。' },
      { name: 'garychowcmu/daizhigev20 · 殆知阁·古代文献', lic: '未标注（仓库无 LICENSE）',
        links: [['https://github.com/garychowcmu/daizhigev20', 'github.com/garychowcmu/daizhigev20']],
        note: '诗藏 + 集藏 2,724 种文献。保留源文件中的 &M0xxxxx; 缺字占位（无映射表）。' },
      { name: 'charlesix59/chinese_word_rhyme · 汉字释义·平仄韵书', lic: 'MIT',
        links: [['https://github.com/charlesix59/chinese_word_rhyme', 'github.com/charlesix59/chinese_word_rhyme']],
        note: '平水韵、词林正韵、新韵、平仄、字义、818 个词牌格律。韵书部分源自维基文库等公开文本。' },
      { name: 'JasonWade001/chtxt · 蒙学经典·16部全本', lic: '未标注（仓库无 LICENSE）',
        links: [['https://github.com/JasonWade001/chtxt', 'github.com/JasonWade001/chtxt']],
        note: '16 部蒙学全本，繁体精校转简体，按 3000 字分章。' },
      { name: 'JasonWade001/chtxt · 儒道经典·8部全本', lic: '未标注（仓库无 LICENSE）',
        links: [['https://github.com/JasonWade001/chtxt', 'github.com/JasonWade001/chtxt']],
        note: '论语、孟子、荀子、大学、中庸、孔子家语、道德经、列子，繁体转简体。' },
      { name: '诗话词话 · 人间词话（BlankRain/ebooks）+ 升庵诗话（NiuTrans/Classical-Modern）', lic: 'BlankRain/ebooks 未标注；NiuTrans/Classical-Modern 为 MIT（仅升庵诗话部分）',
        links: [['https://github.com/BlankRain/ebooks', 'github.com/BlankRain/ebooks'], ['https://github.com/NiuTrans/Classical-Modern', 'github.com/NiuTrans/Classical-Modern']],
        note: '人间词话 113 则，升庵诗话按卷拆分 16 条。' },
    ],
  },
  {
    title: 'Hugging Face 数据集',
    items: [
      { name: 'byj233/ChinesePoetryLibrary · 81万篇', lic: 'MPL-2.0',
        links: [['https://huggingface.co/datasets/byj233/ChinesePoetryLibrary', 'byj233/ChinesePoetryLibrary'], ['https://github.com/byj233/ChinesePoetryLibrary', 'GitHub 同源仓库']],
        note: '81 万篇，含译文/赏析/注释/典故。另提供 4096 维向量（未入库）。' },
      { name: 'PoetryMTEB/Appreciation-of-Chinese-Classical-Poetry · 古典诗歌鉴赏分析', lic: 'CC BY-NC 4.0',
        links: [['https://huggingface.co/datasets/PoetryMTEB/Appreciation-of-Chinese-Classical-Poetry', 'PoetryMTEB/Appreciation-of-Chinese-Classical-Poetry']],
        note: '5,574 首 + 逐首意图/主题/情感分析。上游声明辞书文章版权仍归原出版方。' },
      { name: 'junhao1122/Classical-Chinese-Poetry-Songs · 古典诗歌歌曲', lic: 'MIT',
        links: [['https://huggingface.co/datasets/junhao1122/Classical-Chinese-Poetry-Songs', 'junhao1122/Classical-Chinese-Poetry-Songs']],
        note: '1,463 首诗歌歌曲（train 1,170 / test 143 / val 150）。音频不入库，只取文本字段。' },
      { name: 'MatrixStudio/ChinesePoetry · 拼音英译音频', lic: '未标注（数据集页面无许可字段）',
        links: [['https://huggingface.co/datasets/MatrixStudio/ChinesePoetry', 'MatrixStudio/ChinesePoetry']],
        note: '2,224 条拼音 + 英译 + 音频元数据。音频不入库。' },
      { name: 'ZoneTwelve/chinese-poetry · 唐诗三百首', lic: 'Apache-2.0（数据集卡片）',
        links: [['https://huggingface.co/datasets/ZoneTwelve/chinese-poetry', 'ZoneTwelve/chinese-poetry'], ['https://zh.wikisource.org/zh-hant/唐詩三百首', '源：维基文库《唐詩三百首》']],
        note: '320 条，源自维基文库《唐詩三百首》。' },
      { name: 'zhangqiaobit/chinese_poetrys · 中国古典诗歌', lic: '未标注',
        links: [['https://huggingface.co/datasets/zhangqiaobit/chinese_poetrys', 'zhangqiaobit/chinese_poetrys']],
        note: '分朝代 CSV + 全唐诗 JSON，18 个文件。' },
      { name: 'erhwenkuo/poetry-chinese-zhtw · 繁体诗歌', lic: 'MIT（数据集卡片）',
        links: [['https://huggingface.co/datasets/erhwenkuo/poetry-chinese-zhtw', 'erhwenkuo/poetry-chinese-zhtw']],
        note: '76,013 条繁体诗歌，字段 author/title/text/category；卡片注明部分数据来自 chinese-poetry。' },
      { name: 'Ayaka/ORCHESTRA-simple-1M · 搜韵·百万首', lic: 'MIT（ORCHESTRA-dataset 仓库）；HF 数据集页未单独标注',
        links: [['https://huggingface.co/datasets/Ayaka/ORCHESTRA-simple-1M', 'Ayaka/ORCHESTRA-simple-1M'], ['https://github.com/nk2028/ORCHESTRA-dataset', 'nk2028/ORCHESTRA-dataset'], ['https://sou-yun.cn/', '数据来源：搜韵']],
        note: '1,093,677 首，字段 id/title/type/dynasty/author/content。' },
      { name: 'Papersnake/gushiwen · 古诗文43万', lic: 'CC0-1.0',
        links: [['https://huggingface.co/datasets/Papersnake/gushiwen', 'Papersnake/gushiwen']],
        note: '433,841 条，含 tb_fanyis/tb_shangxis/tb_yizhu 等网站字段。上游内容来自古诗文网。' },
      { name: 'KaifengGGG/WenYanWen_English_Parallel · 文言/白话/英文三语97万', lic: 'MIT（数据集标签）',
        links: [['https://huggingface.co/datasets/KaifengGGG/WenYanWen_English_Parallel', 'KaifengGGG/WenYanWen_English_Parallel']],
        note: '972,467 条三语平行。文言/白话部分取自 NiuTrans/Classical-Modern，英文由 Gemini Pro 生成（上游卡片说明）。' },
    ],
  },
  {
    title: 'Kaggle 数据集',
    items: [
      { name: 'raynardj/zh-wenyanwen-wikisource · 维基文库·文言文古籍', lic: 'CC BY-SA 4.0',
        links: [['https://www.kaggle.com/datasets/raynardj/zh-wenyanwen-wikisource', 'raynardj/zh-wenyanwen-wikisource']],
        note: '132,309 篇维基文库文言文。' },
      { name: 'jerry0723/chinese-poems-with-chinese-annotations · 宋词·2万首带译文', lic: 'ODC-By',
        links: [['https://www.kaggle.com/datasets/jerry0723/chinese-poems-with-chinese-annotations', 'jerry0723/chinese-poems-with-chinese-annotations'], ['https://www.gushici.net', 'fetch.py 显示采集自 gushici.net']],
        note: '20,964 首宋词，字段 title/dynasty/content/trans。' },
      { name: 'yololzw/chinese-poems-translation-and-appreciation · 古诗翻译与赏析语料', lic: 'Apache-2.0',
        links: [['https://www.kaggle.com/datasets/yololzw/chinese-poems-translation-and-appreciation', 'yololzw/chinese-poems-translation-and-appreciation']],
        note: '翻译 62,128、赏析 62,128，另有古今互译等共 8 个 JSON。' },
    ],
  },
  {
    title: 'ModelScope 数据集',
    items: [
      { name: 'hope12138/poetry_translation · 诗词翻译对·9万', lic: 'Apache-2.0',
        links: [['https://modelscope.cn/datasets/hope12138/poetry_translation', 'hope12138/poetry_translation']],
        note: '91,926 首；译文 7,643、注释 7,615、赏析 6,867。' },
      { name: 'duanyu/ai_chinese_poetry_modern_translation · AI古诗词白话翻译', lic: 'Apache-2.0',
        links: [['https://modelscope.cn/datasets/duanyu/ai_chinese_poetry_modern_translation', 'duanyu/ai_chinese_poetry_modern_translation']],
        note: '902 首 AI 白话翻译 + 注释。' },
      { name: '对联语料 · lcl193798 + minisnow + OmniData', lic: 'Apache-2.0 ×2 + CC BY 4.0',
        links: [['https://modelscope.cn/datasets/lcl193798/couplet_generation', 'lcl193798/couplet_generation'], ['https://modelscope.cn/datasets/minisnow/couplet_samll', 'minisnow/couplet_samll'], ['https://modelscope.cn/datasets/OmniData/ChineseTraditionalCulture', 'OmniData/ChineseTraditionalCulture']],
        note: '671,472 副对联 + 5,602 篇楹联集锦。lcl 与 minisnow 已互相去重。' },
      { name: 'PeiLei123456/ChinesePoetryFeiHuaLing · 唐诗飞花令', lic: 'LGPL-3.0',
        links: [['https://modelscope.cn/datasets/PeiLei123456/ChinesePoetryFeiHuaLing', 'PeiLei123456/ChinesePoetryFeiHuaLing']],
        note: '引用 91,987、接龙 97,869、主题 97,852；繁体已转简体，剔除 AI 创作行。' },
      { name: 'peaceminuczy/songci · 宋词词牌标注语料', lic: 'Apache-2.0',
        links: [['https://modelscope.cn/datasets/peaceminuczy/songci', 'peaceminuczy/songci']],
        note: '74,536 首宋词，词牌|正文 结构，814 个词牌。' },
      { name: 'qingqing0308/AncientChinesepoemsaboutobjects · 咏物古诗文·1000篇', lic: 'Apache-2.0',
        links: [['https://modelscope.cn/datasets/qingqing0308/AncientChinesepoemsaboutobjects', 'qingqing0308/AncientChinesepoemsaboutobjects']],
        note: '1,000 篇咏物古诗文，含译文/创作背景/简析。' },
    ],
  },
  {
    title: '站点自行采集',
    items: [
      { name: '古文岛 · 选本注释赏析', lic: '站点内容，未声明开放许可',
        links: [['https://www.guwendao.net', 'guwendao.net（独立站点，非 gushiwen.cn）']],
        note: '选本诗 1,762 首，分节译文/注释/赏析/创作背景。' },
      { name: '古诗文网 · 古文观止与中小学文言文', lic: '站点内容，未声明开放许可',
        links: [['https://www.guwendao.net', 'guwendao.net']],
        note: '295 条，分节译文/注释/赏析/背景。' },
      { name: '古诗文网 · 元曲千家诗·译文注释赏析', lic: '站点内容，未声明开放许可',
        links: [['https://www.guwendao.net', 'guwendao.net']],
        note: '元曲 272 + 千家诗 206，分节覆盖 100%。' },
      { name: '古诗文网 · 名句10000·译文注释赏析', lic: '站点内容，未声明开放许可',
        links: [['https://www.guwendao.net/mingjus/default.aspx', 'guwendao.net/mingjus']],
        note: '8,124 条名句；译文/赏析 100%，注释 88%。' },
      { name: '诗词网 · 选本注释赏析', lic: '站点内容，未声明开放许可',
        links: [['https://www.gushici.net', 'gushici.net']],
        note: '15 个选本 938 篇；译文及注释 932、创作背景 635、赏析 566。' },
      { name: '古诗文网 · 诗经楚辞全本', lic: '站点内容，未声明开放许可',
        links: [['https://www.guwendao.net', 'guwendao.net']],
        note: '诗经 305 + 楚辞 17，全部带分节注解。诗经作者统一为「佚名」，出处存于 collection。' },
      { name: '古诗文网 · 乐府诗集·注释赏析', lic: '站点内容，未声明开放许可',
        links: [['https://www.guwendao.net', 'guwendao.net']],
        note: '乐府 203 篇；译文及注释 202、赏析 202、创作背景 152。' },
      { name: '诗词网 · 主题作者朝代', lic: '站点内容，未声明开放许可',
        links: [['https://www.gushici.net', 'gushici.net']],
        note: '9,261 篇去重；译文及注释 4,271、赏析 2,855、创作背景 2,719、鉴赏 907。' },
    ],
  },
];

const TOOLS = [
  { name: 'pinyin-pro（mozillazg）', lic: 'MIT',
    links: [['https://github.com/mozillazg/pinyin-pro', 'github.com/mozillazg/pinyin-pro']],
    note: '注音（拼音）计算，按需加载，首访不下载。' },
  { name: 'opencc-js', lic: 'MIT',
    links: [['https://github.com/naptha/opencc-js', 'github.com/naptha/opencc-js']],
    note: '繁简转换（显示层切换，不动底层数据）。' },
  { name: '浏览器 Web Speech API（speechSynthesis）', lic: '—',
    links: [],
    note: '朗诵调用手机系统 TTS 引擎，不产生额外请求。' },
  { name: '龙榆生《唐宋词格律》在线版', lic: '—',
    links: [['https://longyusheng.org', 'longyusheng.org']],
    note: '词牌介绍与格律谱参考。' },
];

function renderItem(it) {
  const url = (it.links && it.links.length)
    ? it.links.map(l => `<a href="${esc(l[0])}" target="_blank" rel="noopener">${esc(l[1])}</a>`).join(' · ')
    : '<span class="section-tip">无公开链接</span>';
  return `<div class="src-item">
    <div class="src-head">
      <span class="src-name">${esc(it.name)}</span>
      <span class="src-lic">${esc(it.lic)}</span>
    </div>
    <div class="src-url">${url}</div>
    <div class="src-note">${esc(it.note)}</div>
  </div>`;
}

async function sourcesView() {
  let total = 0;
  const groups = GROUPS.map(g => {
    total += g.items.length;
    return `<div class="card">
      <h2>${esc(g.title)}</h2>
      <div class="src-list">${g.items.map(renderItem).join('')}</div>
    </div>`;
  }).join('');

  const tools = `<div class="card">
    <h2>工具与接口</h2>
    <div class="src-list">${TOOLS.map(renderItem).join('')}</div>
  </div>`;

  const licenseBlock = `<div class="card">
    <h2>本站许可</h2>
    <div class="annotate tight">
      <p>本站由「站点代码」与「数据」两部分构成，而数据本身继承自 53 个许可各异的来源（MIT / Apache-2.0 / CC0 / CC BY-SA / CC BY-NC / GPL-3.0 / LGPL-3.0 / 未标注 / 站点自采）。
        因此<b>不存在一个能覆盖全库的单一许可</b>，本站在此<b>按层声明</b>：</p>
      <p>· <b>站点代码</b>（<code>site/</code> 下的 html / css / js，不含 <code>site/data/</code>）：<b>MIT</b>。</p>
      <p>· <b>本站整理层</b>（索引与分块结构、chunkmap 与 id 跨度、两轮去重归并结果、校勘与规范化、标签/体裁/朝代编排、名句摘编、拼音与平仄派生表、词同调模板）：<b>CC BY-NC-SA 4.0</b>。
        可自由阅读、复制与非商业再分发，须署名「山窗」并同样以 CC BY-NC-SA 4.0 共享。</p>
      <p>· <b>第三方内容</b>（古籍原文、各家译文/注释/赏析/创作背景、索引底本）：<b>不重新授权</b>，保留各自原许可，逐条见下表。
        其中 GPL-3.0 / LGPL-3.0 成分被单独提取使用时仍受其传染性条款约束；CC BY-SA 4.0 成分保留「相同方式共享」要求；
        未标注许可与站点自采成分仅随本站作个人学习展示，本站不主张任何再许可权利。</p>
      <p>· 因此<b>整库不可按任何单一许可整体再分发</b>。<b>如需商用，须逐源替换</b>：至少替换 GPL / LGPL 成分、CC BY-NC 成分与全部站点自采成分。</p>
      <p class="section-tip">许可文本：CC BY-NC-SA 4.0 见
        <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh" target="_blank" rel="noopener">creativecommons.org</a>；
        MIT 见 <a href="https://opensource.org/license/mit" target="_blank" rel="noopener">opensource.org</a>。
        本页为来源与许可的事实说明，不构成法律意见。</p>
    </div>
  </div>`;

  const notes = `<div class="card">
    <h2>许可与使用注意</h2>
    <div class="annotate tight">
      <p>以上共 ${total} 个数据集来源（GitHub ${GROUPS[0].items.length} · Hugging Face ${GROUPS[1].items.length} · Kaggle ${GROUPS[2].items.length} · ModelScope ${GROUPS[3].items.length} · 站点自采 ${GROUPS[4].items.length}）。各数据集版权归原作者所有，本站按原许可使用数据，仅作个人学习赏析之用。</p>
      <p>· 可直接商用（仍须保留署名与许可声明）：MIT、Apache-2.0、CC0、MPL-2.0、ODC-By、CC BY 4.0、CC BY-SA 4.0（有传染性，衍生须同许可共享）。</p>
      <p>· 限制商用：CC BY-NC 4.0（PoetryMTEB 鉴赏，仅非商业）；GPL-3.0（JoyDraw、shenyunhang，分发衍生须开源）；LGPL-3.0（飞花令）。</p>
      <p>· 站点自采内容（古文岛、古诗文网、诗词网）未声明开放许可，仅限个人学习展示，不作再许可；如原站提出异议，应下架对应条目。</p>
      <p>· 上游未标注许可的来源（VMIJUNV、Imposingapple、aopao、zhouzhaoxin、sfw2099、daizhige、JasonWade001/chtxt、MatrixStudio、zhangqiaobit、BlankRain/ebooks 等），列为参考来源，不主张任何再许可权利；如需商用，先联系作者。</p>
      <p>· 自采页面中的译文/注释/赏析为现代人作品，版权归原撰写者/原站；本库已做去重与格式统一，但未改变原文归属。</p>
      <p class="section-tip">未纳入主库的上游来源（供参考，不声称可再许可）：英文译文（HF emmit989、Kaggle 诗经英文三译本，CC BY-NC 4.0）、评测基准（HF benchmark，CC BY-NC 4.0，已清理）、0 条入库（乐府、名句）、指令数据（HF instruction）、文白互译（ModelScope）、地名标签（Kaggle）、NiuTrans 平行语料（仅 1 条，白话取自 WenYanWen 三语）。</p>
    </div>
  </div>`;

  app.innerHTML = `${PAD}
    <div class="card">
      <h2>数据来源</h2>
      <div class="annotate tight">
        <p>本站古诗词数据来自以下公开数据集与站点采集，按原许可使用；对未标注许可的来源，仅作学习参考，不主张任何再许可权利。数据的著作权归原作者与原出版方所有。</p>
        <p class="section-tip">全库经两轮去重整理：合并集内与跨集合重复正文约 2.8 万条，并将各版本的译文、注释、赏析与创作背景归并，保留信息最完整者。</p>
      </div>
    </div>
    ${licenseBlock}
    ${groups}
    ${tools}
    ${notes}`;

  try { document.title = '数据来源 · 山窗 · 千年古诗文'; } catch {}
}

export { sourcesView };
