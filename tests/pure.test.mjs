// 纯函数快照测试：layoutParagraph / locateTerms / normZh / buildNotes / cleanSelectionText
//
// 用法：
//   node tests/pure.test.mjs           比对快照，有差异则退出码 1
//   node tests/pure.test.mjs --update  重写快照（改动了这些函数时才用）
//
// 为什么用快照：这几个函数是「正文排版 / 注释定位 / 繁简归一」的唯一入口，
// 改一处很容易在别处露馅（历次事故都出在这里），所以锁住它们的输出形状。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeEl } from './dom-shim.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SNAP = path.join(HERE, 'snapshots/pure.json');
const UPDATE = process.argv.includes('--update');

// 与快照无关的硬断言：防止「快照被 --update 重写」把假绿一起写进去（E-7）。
let hardFail = 0;
const check = (name, cond, got) => {
  if (cond) return;
  hardFail++;
  console.error(`✗ ${name} —— ${got}`);
};

const { layoutParagraph } = await import('../site/js/vcommon.js');
const { locateTerms, normZh, buildNotes, loadCharMap } = await import('../site/js/fn.js');
const { cleanSelectionText } = await import('../site/js/views/detail.js');

// normZh / locateTerms 依赖繁简单字表，先装进内存
await loadCharMap();

const cases = [];

// ---------- layoutParagraph：五种正文形态 ----------
const wuyan = '移舟泊煙渚，日暮客愁新。野曠天低樹，江清月近人。';
const strain5 = '平仄平平仄仄平仄平平仄平平仄仄平平仄平';
cases.push(['layout 五言（整段 zip 平仄）', layoutParagraph(wuyan, strain5)]);
cases.push(['layout 五言（无平仄）', layoutParagraph(wuyan, null)]);

const siyan = '關關雎鳩，在河之洲。窈窕淑女，君子好逑。';
cases.push(['layout 四言（两句一行）', layoutParagraph(siyan, null)]);

const qiyan = '無邊落木蕭蕭下，不盡長江滾滾來。萬里悲秋常作客，百年多病獨登臺。';
cases.push(['layout 七言', layoutParagraph(qiyan, null)]);
cases.push(['layout 七言（平仄串长度不符→退回整行式）', layoutParagraph(qiyan, '平平仄仄')]);

const ciLong = '大江東去，浪淘盡，千古風流人物。故壘西邊，人道是三國周郎赤壁。亂石穿空，驚濤拍岸，捲起千堆雪。';
cases.push(['layout 词（韵句一行 + 长句折行）', layoutParagraph(ciLong, null, 'ci')]);

const prose = '子曰學而時習之，不亦說乎。有朋自遠方來，不亦樂乎。人不知而不慍，不亦君子乎。';
cases.push(['layout 古文（不折行，整段一行）', layoutParagraph(prose, null, 'prose')]);

// ---------- buildNotes + locateTerms：繁简混排 ----------
const poem = {
  n: ['1.有朋--有志同道合的人从远方来', '2.說--同“悦”，喜悦', '3.慍--恼怒'],
  f: { z: '學而：学习并实践\n時習：按时温习\n君子：有德行的人' },
};
const notes = buildNotes(poem);
cases.push(['buildNotes 词条合并去重', notes]);
cases.push(['locateTerms 繁体正文 + 简体词条', locateTerms(prose, notes, new Set())]);

const used = new Set();
locateTerms(prose, notes, used);
cases.push(['locateTerms 跨段落共享 used', { used: [...used].sort((a, b) => a - b), second: locateTerms(prose, notes, used) }]);

// ---------- normZh：繁简 / 标点 / 大小写 ----------
const normInputs = ['學而時習之', '学而时习之', 'ABC abc', '《論語》·學而', '', '　全形空格　'];
cases.push(['normZh 归一', normInputs.map(s => [s, normZh(s)])]);

// ---------- cleanSelectionText：划选文本清洗 ----------
// detail.js 会 frag.querySelectorAll('.strain-line, rt, rp, .pzw, .fnn') 并逐个 remove()。
// 旧 fakeRange 用 () => [] 让这条分支永远空转（E-7 假阳性）。这里造「可累积」的假节点
// 列表：普通文本节点 + 上述五类噪声节点；remove() 真把节点标成已移除，textContent 随之
// 变化，清洗分支真的执行、结果可观测。stat.removed 记录移除数，用硬断言证明分支跑过。
function fakeRange(parts, stat = { removed: 0 }) {
  const list = typeof parts === 'string' ? [{ text: parts }] : parts;
  const nodes = list.map(({ cls = '', text }) => ({ cls, text, removed: false }));
  const clone = {
    get textContent() { return nodes.filter(n => !n.removed).map(n => n.text).join(''); },
    querySelectorAll(sel) {
      const classes = String(sel).split(',').map(s => s.trim().replace(/^\./, ''));
      return nodes.filter(n => n.cls && classes.includes(n.cls)).map(n => ({
        remove() { if (!n.removed) { n.removed = true; stat.removed++; } },
      }));
    },
  };
  return { cloneContents: () => clone, stat };
}
cases.push(['cleanSelection 去多余空白', cleanSelectionText(fakeRange('移舟泊煙渚，\n   日暮客愁新。  '))]);
// 五类噪声节点齐全：清洗分支应命中并移除 5 个，结果里不能残留任何噪声文案。
{
  const stat = { removed: 0 };
  const r = fakeRange([
    { text: '移舟泊煙渚，\n   日暮客愁新。  ' },  // 普通正文文本节点
    { cls: 'pzw', text: '平平仄平仄' },           // 平仄逐字下标
    { cls: 'rt', text: 'zhǔ' },                   // ruby 注音
    { cls: 'rp', text: '()' },                    // ruby 括号
    { cls: 'fnn', text: '[1]' },                  // 脚注上标
    { cls: 'strain-line', text: '仄仄仄平平' },   // 整行式平仄段
  ], stat);
  const cleaned = cleanSelectionText(r);
  check('清洗分支真的移除了 5 个噪声节点', stat.removed === 5, '实际移除 ' + stat.removed);
  check('清洗结果不含噪声文案', !/平|zhǔ|\(\)|\[1\]/.test(cleaned), JSON.stringify(cleaned));
  cases.push(['cleanSelection 剔除平仄/注音/脚注噪声', { text: cleaned, removed: stat.removed }]);
  cases.push(['cleanSelection 噪声文案不残留', /平|zhǔ|\(\)|\[1\]/.test(cleaned), false]);
}
cases.push(['cleanSelection 异常范围不抛错', cleanSelectionText({ cloneContents() { throw new Error('boom'); } })]);

// ---------- 比对 / 更新 ----------
const got = {};
for (const [name, value] of cases) got[name] = value;

if (UPDATE) {
  if (hardFail) { console.error('清洗硬断言未过，拒绝写入快照'); process.exit(1); }
  fs.mkdirSync(path.dirname(SNAP), { recursive: true });
  fs.writeFileSync(SNAP, JSON.stringify(got, null, 2) + '\n', 'utf8');
  console.log(`已写入快照：${path.relative(process.cwd(), SNAP)}（${cases.length} 项）`);
  process.exit(0);
}

if (!fs.existsSync(SNAP)) {
  console.error('缺少快照文件，先跑一次：node tests/pure.test.mjs --update');
  process.exit(1);
}

const want = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
let fail = 0;
for (const [name] of cases) {
  const a = JSON.stringify(want[name]);
  const b = JSON.stringify(got[name]);
  if (a === b) { console.log(`  ✓ ${name}`); continue; }
  fail++;
  console.log(`  ✗ ${name}`);
  console.log(`     期望: ${a}`);
  console.log(`     实际: ${b}`);
}
const missing = Object.keys(want).filter(k => !(k in got));
if (missing.length) { fail++; console.log('  ✗ 快照里有用例已被删除：' + missing.join('、')); }

const bad = fail + hardFail;
console.log(bad ? `\n失败 ${bad} 项 / 共 ${cases.length} 项` : `\n全部通过（${cases.length} 项）`);
process.exit(bad ? 1 : 0);
