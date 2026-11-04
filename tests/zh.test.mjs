// 简繁显示转换测试：s2td 映射质量 + zhShow 行为 + placeNotes 跨简繁锚定 + UI 框架转换
// 数据文件由 etl/build-s2td.js 生成（词组投票 + 自动钉原字 + 人工兜底 + fix 修正表）。
// 这里锁的是显示层最容易被回归弄坏的那批字：山穀/瀋佺期/鬆柏 是硬伤，
// 一旦 ETL 规则或映射表被改动，这组断言会先红。
import './dom-shim.mjs';

const { zhShow, setZhMode, loadZhConv, loadCharMap } = await import('../site/js/fn.js');
const { placeNotes } = await import('../site/js/notes.js');
const { convTree } = await import('../site/js/uizh.js');

let fail = 0;
const cases = [];
const check = (name, got, want) => {
  const ok = got === want;
  if (!ok) fail++;
  cases.push([ok ? '✓' : '✗', name, ok ? '' : `（期望 ${JSON.stringify(want)}，实际 ${JSON.stringify(got)}）`]);
};

// 映射表必须在测试前就位（dom-shim 的 fetch 直读 site/ 目录）
await loadCharMap();
await loadZhConv();

// ---------- zhShow：繁體模式（默认） ----------
setZhMode('t');

// 简体源 → 繁体
check('简体源转繁（曹操·短歌行）', zhShow('对酒当歌，人生几何'), '對酒當歌，人生幾何');
check('简体源转繁（白发）', zhShow('白发三千丈'), '白髮三千丈');
check('简体源转繁（秋千）', zhShow('蹴罢秋千'), '蹴罷鞦韆');
// 繁体原文原样不动（零回归）
check('繁体原样（李白·秋浦歌）', zhShow('白髮三千丈，緣愁似個長'), '白髮三千丈，緣愁似個長');
check('繁体原样（诗经）', zhShow('關關雎鳩，在河之洲'), '關關雎鳩，在河之洲');
// 人工兜底：这些字不转（本身即合法繁体，逐字必错）
check('兜底：沈（沈佺期）', zhShow('沈佺期'), '沈佺期');
check('兜底：谷（山谷）', zhShow('空谷传声'), '空谷傳聲');
check('兜底：松（松柏）', zhShow('松柏有本性'), '松柏有本性');
check('兜底：才（才下眉头）', zhShow('才下眉头'), '才下眉頭');
check('兜底：胡（胡马）', zhShow('胡马依北风'), '胡馬依北風');
check('兜底：后（后宫）', zhShow('后宫佳丽三千人'), '后宮佳麗三千人');
// 强制指定
check('指定：钟→鐘', zhShow('钟鼓乐之'), '鐘鼓樂之');
check('指定：叶→葉', zhShow('叶落归根'), '葉落歸根');
// fix 修正表
check('fix：并刀（地名不作並）', zhShow('并刀如水'), '并刀如水');
check('fix：複道（阿房宫赋）', zhShow('复道行空'), '複道行空');
check('fix：彷彿（洛神赋）', zhShow('仿佛兮若轻云之蔽月'), '彷彿兮若輕雲之蔽月');
check('fix：詩雲→詩云', zhShow('诗云'), '詩云');
// 「于→於」现代虚词语境（于钉了原字保「之子于归」，词组照转）。
// 注意：由/于/是/生 这几个字单独成串检测不出简体源（全是钉原字或繁简同形），
// 它们总与其它简体字同现——断言用贴近真实的句子，不用裸词。
check('fix：關於（关于）', zhShow('关于'), '關於');
check('fix：由於（由于）', zhShow('由于时间关系'), '由於時間關係');
check('fix：於是（于是）', zhShow('于是他离开了'), '於是他離開了');
check('fix：終於（终于）', zhShow('他终于回来了'), '他終於回來了');
// 「余→餘」剩余语境（余钉了原字保第一人称，词组照转）
check('fix：其餘（其余）', zhShow('展开其余'), '展開其餘');
check('fix：餘生（余生）', zhShow('度过余生'), '度過餘生');
// 「复」的另一支：複製 / 重複
check('fix：複製（复制）', zhShow('复制到剪贴板'), '複製到剪貼板');
check('fix：重複（重复）', zhShow('不可重复'), '不可重複');
// UI 框架用字（uizh 观察器统一转换的界面文字）
check('UI：設置（设置）', zhShow('设置'), '設置');
check('UI：每日一詩（每日一诗）', zhShow('每日一诗'), '每日一詩');
check('UI：閱讀歷史（阅读历史）', zhShow('阅读历史'), '閱讀歷史');
check('UI：加載更多（加载更多）', zhShow('加载更多'), '加載更多');
// 繁简混排不动（保守：引文跨库）
check('混排不动', zhShow('对酒當歌'), '对酒當歌');

// ---------- zhShow：简体模式 ----------
setZhMode('s');
check('简体模式：繁→简', zhShow('對酒當歌，人生幾何'), '对酒当歌，人生几何');
check('简体模式：简体原样', zhShow('对酒当歌'), '对酒当歌');

// ---------- 幂等 ----------
setZhMode('t');
check('繁模式幂等', zhShow(zhShow('对酒当歌，人生几何')), '對酒當歌，人生幾何');
check('繁模式幂等（繁体原文）', zhShow(zhShow('白髮三千丈，緣愁似個長')), '白髮三千丈，緣愁似個長');
setZhMode('s');
check('简模式幂等', zhShow(zhShow('白髮三千丈，緣愁似個長')), '白发三千丈，缘愁似个长');

// ---------- placeNotes：跨简繁锚定 ----------
// 批注的净文快照是「创建那一刻的显示字」。切了简繁后正文行换了写法，
// 归一（两侧都过 t2s）必须还能对上行，否则批注全变孤儿。
setZhMode('t');
const linesT = [{ t: '對酒當歌，人生幾何！' }, { t: '譬如朝露，去日苦多。' }];
const noteSimp = { id: 'n1', li: 0, t: '对酒当歌，人生几何！', s: '批注', ts: 1 };
{
  const r = placeNotes(linesT, [noteSimp]);
  check('眉批：简体快照挂到繁体行', r.placed.length === 1 && r.placed[0].li === 0 ? 'ok' : 'bad', 'ok');
  check('眉批：简体快照不孤儿', r.orphans.length, 0);
}
setZhMode('s');
const linesS = [{ t: '对酒当歌，人生几何！' }, { t: '譬如朝露，去日苦多。' }];
const noteTrad = { id: 'n2', li: 0, t: '對酒當歌，人生幾何！', s: '批注', ts: 1 };
{
  const r = placeNotes(linesS, [noteTrad]);
  check('眉批：繁体快照挂到简体行', r.placed.length === 1 && r.placed[0].li === 0 ? 'ok' : 'bad', 'ok');
  check('眉批：繁体快照不孤儿', r.orphans.length, 0);
}

// ---------- convTree：UI 框架转换的 DOM 收口 ----------
// dom-shim 没有 TreeWalker，用假 walker + 假元素过一遍核心逻辑：
// 文本节点转换、TEXTAREA 跳过、placeholder 转换、data-* 不动。
// 前面的 placeNotes 段把模式留在了 's'，这里切回繁體（默认态）再验。
setZhMode('t');
{
  const T = (v, tag) => ({ nodeType: 3, nodeValue: v, parentElement: { tagName: tag } });
  const texts = [
    T('设置', 'DIV'),
    T('眉批正文不转', 'TEXTAREA'),
    T('不可重复', 'DIV'),
    T('已转换的內容', 'SPAN'),
  ];
  const mkEl = (attrs) => ({
    attrs,
    getAttribute(a) { return Object.prototype.hasOwnProperty.call(this.attrs, a) ? this.attrs[a] : null; },
    setAttribute(a, v) { this.attrs[a] = v; },
  });
  const els = [mkEl({ placeholder: '诗名 / 作者' }), mkEl({ 'data-q': '搜索词' })];
  globalThis.NodeFilter = { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 };
  globalThis.document.createTreeWalker = (_root, _what, filter) => {
    let i = 0;
    const w = {
      currentNode: null,
      nextNode() {
        while (i < texts.length) {
          const n = texts[i++];
          if (filter.acceptNode(n) === 1) { w.currentNode = n; return n; }
        }
        w.currentNode = null;
        return null;
      },
    };
    return w;
  };
  const root = { nodeType: 1, querySelectorAll: () => els };
  convTree(root);
  check('uizh：文本节点转换', texts[0].nodeValue, '設置');
  check('uizh：textarea 不转', texts[1].nodeValue, '眉批正文不转');
  check('uizh：普通文本照转', texts[2].nodeValue, '不可重複');
  check('uizh：已转内容幂等', texts[3].nodeValue, '已转换的內容');
  check('uizh：placeholder 转换', els[0].attrs.placeholder, '詩名 / 作者');
  check('uizh：data-* 不动', els[1].attrs['data-q'], '搜索词');
}

// ---------- s2td.json 数据形状 ----------
{
  const d = JSON.parse(await (await fetch('data/idx/s2td.json')).text());
  check('s2td 形状：v', d.v, 1);
  check('s2td 形状：m 非空', Object.keys(d.m || {}).length > 2000 ? 'ok' : 'bad', 'ok');
  check('s2td 形状：so/to/fix 齐全', d.so && d.to && d.fix ? 'ok' : 'bad', 'ok');
  // 逐字等长：m 的每个值都必须是单字（保眉批偏移、平仄 zip 对齐）
  const bad = Object.entries(d.m).filter(([, v]) => [...v].length !== 1);
  check('s2td：m 全部单字值', bad.length, 0);
  // 幂等：m 的键不在 to（繁体侧字符集）里，否则转换后的字符会被再判为繁体源
  const toSet = new Set(d.to || '');
  const badKey = Object.keys(d.m).filter(k => toSet.has(k));
  check('s2td：键不在繁体侧集合', badKey.length, 0);
}

for (const [m, name, extra] of cases) console.log(`  ${m} ${name}${extra}`);
console.log(fail ? `\n失败 ${fail} 项 / 共 ${cases.length} 项` : `\n全部通过（${cases.length} 项）`);
process.exit(fail ? 1 : 0);
