// 细化分析：在主库去重判定之外，进一步拆分 dataset_dedup 的"内部重复"为
//   (a) 真实诗歌内部重复：题名+作者都非空，但 key 在 dataset_dedup 内出现>1次
//   (b) 退化重复：题名或作者为空（语料/句对/词牌标注等无诗身份的条目）
// 并给出真实"新增唯一诗"数量，以及按 tab 的非诗内容占比。
// 只读主库与 dataset_dedup，不改任何文件。
const fs = require('fs');
const path = require('path');
const ROOT = 'C:/Users/xiang/Downloads/poetry-site';
const MAIN_POEMS = path.join(ROOT, 'site', 'data', 'poems');
const MAIN_MANIFEST = path.join(ROOT, 'site', 'data', 'manifest.json');
const DEDUP = 'C:/Users/xiang/Downloads/dataset_dedup';
const OUT = path.join(ROOT, 'audit-dedup-out');

let OpenCC;
try { OpenCC = require(path.join(ROOT, 'etl', 'node_modules', 'opencc-js')); } catch (e) { try { OpenCC = require('opencc-js'); } catch (e2) {} }
const convT2S = OpenCC ? OpenCC.Converter({ from: 't', to: 'cn' }) : (s => s);
const PUNCT = /[\s·・\/、，。：:；!！?？（）()【】\[\]「」『』《》〈〉""''"'—\-_～~.…∙]/g;
function normKey(s){let o='';for(const ch of String(s||''))o+=convT2S(ch);return o.replace(PUNCT,'').toLowerCase();}
const LE=/^(郊庙歌辞|鼓吹曲辞|横吹曲辞|相和歌辞|清商曲辞|舞曲歌辞|琴曲歌辞|杂曲歌辞|近代曲辞|新乐府辞|乐府杂曲)/;
function baseTitle(s){return normKey(s).replace(LE,'').replace(/(其[一二三四五六七八九十百零]+|之[一二三四五六七八九十百零]+|[一二三四五六七八九十百零]+首?|\d+首?)$/,'');}
const RE_VAR=/[（(][^（）()]{0,16}(?:一作|原作|通|同)[^（）()]{0,16}[)）]/g;
function stripHtml(x){return x==null?x:String(x).replace(/<[^>]+>/g,'');}
function stripVar(x){return x?x.replace(RE_VAR,''):x;}
function bodySig(r){let p0=(r.p&&r.p[0])?String(r.p[0]):'';if(p0.length>80)p0=p0.slice(0,80);return normKey(stripHtml(stripVar(p0))).slice(0,40);}
function lcp(a,b){let n=0;const m=Math.min(a.length,b.length);while(n<m&&a[n]===b[n])n++;return n;}
function recKey(r){return normKey(r.t)+'|'+normKey(r.a);}
function recBase(r){return baseTitle(r.t)+'|'+normKey(r.a);}

console.log('[1] 建主库索引 ...');
const mm=JSON.parse(fs.readFileSync(MAIN_MANIFEST,'utf8'));
const exactSet=new Map(), baseMap=new Map(), authSig=new Map();
let scanned=0;
for(const col of mm.collections) for(const ck of (col.chunks||[])){
  const fp=path.join(MAIN_POEMS,ck); if(!fs.existsSync(fp))continue;
  let arr;try{arr=JSON.parse(fs.readFileSync(fp,'utf8'));}catch(e){continue;}
  for(const r of arr){if(!r||typeof r!=='object')continue;scanned++;
    const k=recKey(r),bk=recBase(r),sg=recSig(r),an=normKey(r.a);
    if(!exactSet.has(k))exactSet.set(k,1);
    let bl=baseMap.get(bk);if(!bl){bl=[];baseMap.set(bk,bl);}bl.push(sg);
    if(an&&sg){const pk=an+'|'+sg.slice(0,20);let al=authSig.get(pk);if(!al){al=[];authSig.set(pk,al);}al.push(sg);}
  }
}
console.log('    主库',scanned,'唯一key',exactSet.size);

console.log('[2] 细化扫描 dataset_dedup ...');
const dm=JSON.parse(fs.readFileSync(path.join(DEDUP,'manifest.json'),'utf8'));
function listFiles(){const out=[];(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const fp=path.join(d,e.name);if(e.isDirectory())w(fp);else if(e.name.endsWith('.json'))out.push(fp);}})(path.join(DEDUP,'poems'));return out;}
const files=listFiles().sort();

let total=0, mainlibDup=0;
let internalReal=0;
let degenerate=0, degenerateFirst=0;
const seenReal=new Map();
const seenDegen=new Map();
const byTab={};
function bump(tab,key,val){const o=byTab[tab]||(byTab[tab]={total:0,mainlibDup:0,keep:0});o[key]+=val;}

for(const fp of files){
  const base=path.basename(fp);const cid=base.replace(/-(\d+)\.json$/,'');
  let arr;try{arr=JSON.parse(fs.readFileSync(fp,'utf8'));}catch(e){continue;}
  if(!Array.isArray(arr))continue;
  const tab=(dm.collections.find(c=>c.id===cid)||{}).tab||'?';
  for(const r of arr){
    if(!r||typeof r!=='object')continue;
    total++; bump(tab,'total',1);
    const k=recKey(r),bk=recBase(r),sg=recSig(r),an=normKey(r.a);
    let tier=0;
    if(exactSet.has(k))tier=1;
    else{const bl=baseMap.get(bk);if(bl){let best=0;for(const s of bl){const l=lcp(sg,s);if(l>best)best=l;}if(best>=15)tier=2;}
      if(!tier&&an&&sg){const al=authSig.get(an+'|'+sg.slice(0,20));if(al){const need=Math.min(24,Math.max(8,Math.floor(Math.min(sg.length,24)*0.9)));let best=0;for(const s of al){const l=lcp(sg,s);if(l>best)best=l;}if(best>=need)tier=3;}}}
    if(tier){mainlibDup++;bump(tab,'mainlibDup',1);continue;}
    bump(tab,'keep',1);
    const hasT=normKey(r.t).length>0, hasA=an.length>0;
    if(hasT&&hasA){
      const seen=(seenReal.get(k)||0);
      if(seen>0){internalReal++;}else{}
      seenReal.set(k,seen+1);
    } else {
      const dk=(hasT?normKey(r.t):'_')+'|'+(hasA?an:'_');
      const seen=(seenDegen.get(dk)||0);
      if(seen>0){}else{degenerateFirst++;}
      degenerate++;
      seenDegen.set(dk,seen+1);
    }
  }
}
const realNewUnique = seenReal.size; // 真实诗、非主库、首次出现（= 唯一真实新增诗数）
const result={
  generatedAt:new Date().toISOString(),
  total,
  mainlibDup,
  keepAfterMainlib: total-mainlibDup,
  internalRealDup: internalReal,
  realNewUnique,
  degenerateRecords: degenerate,
  degenerateUnique: degenerateFirst,
  byTab,
};
fs.writeFileSync(path.join(OUT,'dedup-internal.json'),JSON.stringify(result,null,1));
console.log('=== 细化结果 ===');
console.log('总',total,'| 主库重复',mainlibDup,'| 删主库后保留',total-mainlibDup);
console.log('其中 真实诗歌内部重复',internalReal,'| 真实新增唯一诗',realNewUnique);
console.log('退化条目(无题名/作者)',degenerate,'| 退化唯一',degenerateFirst);
console.log('--- 按 tab ---');
for(const [t,o] of Object.entries(byTab)) console.log(`  ${t}: total=${o.total} 主库重复=${o.mainlibDup} 保留=${o.keep}`);
console.log('DONE');
