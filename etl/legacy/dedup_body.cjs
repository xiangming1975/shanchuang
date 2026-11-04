// 以"正文(body)重复"为去重判据，对 dataset_dedup 做去重+合并：
//   - 正文命中主库 -> 若带来主库没有的 f 资料则保留(合并)，否则删除
//   - 正文在 dataset_dedup 内部重复 -> 合并 f 资料与 tg 标签后删除冗余副本
//   - 非诗内容一律保留，只删正文重复
//   - 输出时把所有 f 统一为对象形式(键=类型, 值=文本)
// 主库只读；dataset_dedup 改写前先改名为 .bak 备份(可逆)。
// 用法:
//   node --max-old-space-size=8192 dedup_body.cjs            # 试跑(只读分析)
//   node --max-old-space-size=8192 dedup_body.cjs --apply    # 真写
const fs = require('fs');
const path = require('path');
const APPLY = process.argv.includes('--apply');
const ROOT = 'C:/Users/xiang/Downloads/poetry-site';
const MAIN_POEMS = path.join(ROOT, 'site', 'data', 'poems');
const MAIN_MANIFEST = path.join(ROOT, 'site', 'data', 'manifest.json');
const DEDUP = 'C:/Users/xiang/Downloads/dataset_dedup';
const OUT = path.join(ROOT, 'audit-dedup-out');
fs.mkdirSync(OUT, { recursive: true });
const CHUNK = 200;

let OpenCC;
try { OpenCC = require(path.join(ROOT, 'etl', 'node_modules', 'opencc-js')); } catch (e) { try { OpenCC = require('opencc-js'); } catch (e2) {} }
const convT2S = OpenCC ? OpenCC.Converter({ from: 't', to: 'cn' }) : (s => s);
const PUNCT = /[\s·・\/、，。：:；!！?？（）()【】\[\]「」『』《》〈〉""''"'—\-_～~.…∙]/g;
function normKey(s){let o='';for(const ch of String(s||''))o+=convT2S(ch);return o.replace(PUNCT,'').toLowerCase();}
const RE_VAR=/[（(][^（）()]{0,16}(?:一作|原作|通|同)[^（）()]{0,16}[)）]/g;
function stripHtml(x){return x==null?x:String(x).replace(/<[^>]+>/g,'');}
function stripVar(x){return x?x.replace(RE_VAR,''):x;}
function hash16(str){
  let h1=2166136261>>>0, h2=2166136261>>>0;
  for(let i=0;i<str.length;i++){const c=str.charCodeAt(i);h1^=c;h1=Math.imul(h1,16777619)>>>0;h2^=(c+1);h2=Math.imul(h2,16777619^0x9e3779b9)>>>0;}
  return h1.toString(16).padStart(8,'0')+h2.toString(16).padStart(8,'0');
}
function bodyHash(r){
  const p = Array.isArray(r.p) ? r.p : (typeof r.p==='string' ? [r.p] : []);
  const joined = p.join('');
  const len = joined.replace(/\s/g,'').length;
  const head = normKey(joined.slice(0,150)).slice(0,120);
  return hash16(head + '|' + len);
}
function fKeys(r){
  const f = r && r.f;
  const obj={}, has=new Set(), text=new Set();
  if (Array.isArray(f)) { for (const c of f) { if(c){ has.add(String(c)); obj[String(c)]=''; } } }
  else if (f && typeof f==='object') {
    for (const k of Object.keys(f)) {
      const v = f[k];
      has.add(k);
      let s = (v==null)?'' : (typeof v==='string'? v : (typeof v==='object'? JSON.stringify(v): String(v)));
      obj[k]=s; if (s.trim().length>0) text.add(k);
    }
  }
  return { obj, has, text };
}
function toObj(f){ const o={}; if(Array.isArray(f)){for(const c of f) if(c)o[String(c)]='';} else if(f&&typeof f==='object'){for(const k of Object.keys(f)){const v=f[k];o[k]=(v==null)?'':(typeof v==='string'?v:(typeof v==='object'?JSON.stringify(v):String(v)));}} return o; }

// ---- 决定读取源：apply 时先把原目录备份为 .bak，再从 .bak 读，写到干净的 DEDUP ----
let SRC = DEDUP;
if (APPLY) {
  const BAK = DEDUP + '.bak';
  if (!fs.existsSync(BAK)) { fs.renameSync(DEDUP, BAK); console.log('备份原始 dataset_dedup ->', BAK); }
  else console.log('备份已存在，复用', BAK);
  SRC = BAK;
  fs.mkdirSync(path.join(DEDUP,'poems'), {recursive:true});
}

console.log('[1] 建主库 body 索引(只读) ...');
const mm=JSON.parse(fs.readFileSync(MAIN_MANIFEST,'utf8'));
const mainKeys=new Map(); const mainText=new Map(); let mscanned=0;
for(const col of mm.collections) for(const ck of (col.chunks||[])){
  const fp=path.join(MAIN_POEMS,ck); if(!fs.existsSync(fp))continue;
  let arr;try{arr=JSON.parse(fs.readFileSync(fp,'utf8'));}catch(e){continue;}
  for(const r of arr){if(!r||typeof r!=='object')continue;mscanned++;
    const bk=bodyHash(r);
    let ks=mainKeys.get(bk); if(!ks){ks=new Set();mainKeys.set(bk,ks);mainText.set(bk,new Set());}
    const fk=fKeys(r); for(const k of fk.has) ks.add(k); for(const k of fk.text) mainText.get(bk).add(k);
  }
}
console.log('    主库',mscanned,'唯一body',mainKeys.size);

console.log('[2] 扫描 dataset_dedup ...');
const dm=JSON.parse(fs.readFileSync(path.join(SRC,'manifest.json'),'utf8'));
function listFiles(d){const out=[];(function w(x){for(const e of fs.readdirSync(x,{withFileTypes:true})){const fp=path.join(x,e.name);if(e.isDirectory())w(fp);else if(e.name.endsWith('.json'))out.push(fp);}})(path.join(d,'poems'));return out;}
const files=listFiles(SRC).sort();

let total=0, mainPureDel=0, mainEnrichKeep=0, internalDel=0, uniqueKeep=0;
const perColl={}; const samples={ mainPure:[], enrich:[], internal:[], boundary:[] };
const seenBody=new Set(); const outputWanted=new Set(); const mergeStore=new Map(); const written=new Set();
function note(bucket,item){ if(samples[bucket].length<25) samples[bucket].push(item); }
function mergeInto(bk,fk,tg){
  let ms=mergeStore.get(bk); if(!ms){ms={obj:{},tgSet:new Set()};mergeStore.set(bk,ms);}
  for(const k of fk.has){ if(!(k in ms.obj) || (ms.obj[k].trim().length===0 && fk.text.has(k))) ms.obj[k]=fk.obj[k]; }
  for(const t of tg) ms.tgSet.add(t);
}
function processRecord(r,cid){
  if(!r||typeof r!=='object')return; total++;
  if(!perColl[cid])perColl[cid]={total:0,mainPureDel:0,mainEnrichKeep:0,internalDel:0,uniqueKeep:0};
  const pc=perColl[cid]; pc.total++;
  const bk=bodyHash(r), fk=fKeys(r); const tg=Array.isArray(r.tg)?r.tg:[];
  if(mainKeys.has(bk)){
    let enrich=false; const mk=mainKeys.get(bk);
    for(const k of fk.has) if(!mk.has(k)){enrich=true;break;}
    if(!enrich){const mt=mainText.get(bk);for(const k of fk.text) if(!mt.has(k)){enrich=true;break;}}
    if(enrich){ mainEnrichKeep++; pc.mainEnrichKeep++; outputWanted.add(bk); mergeInto(bk,fk,tg);
      note('enrich',{coll:cid,t:r.t,a:r.a,d:r.d,extra:[...fk.has].filter(k=>!mk.has(k))}); }
    else { mainPureDel++; pc.mainPureDel++; note('mainPure',{coll:cid,t:r.t,a:r.a,d:r.d}); }
    return;
  }
  if(seenBody.has(bk)){ internalDel++; pc.internalDel++; mergeInto(bk,fk,tg); note('internal',{coll:cid,t:r.t,a:r.a,d:r.d}); }
  else { seenBody.add(bk); uniqueKeep++; pc.uniqueKeep++; outputWanted.add(bk); if(fk.has.size) mergeInto(bk,fk,tg); note('boundary',{coll:cid,t:r.t,a:r.a,d:r.d}); }
}
for(const fp of files){
  const base=path.basename(fp);const cid=base.replace(/-(\d+)\.json$/,'');
  let arr;try{arr=JSON.parse(fs.readFileSync(fp,'utf8'));}catch(e){continue;}
  if(!Array.isArray(arr))continue;
  for(const r of arr) processRecord(r,cid);
}
console.log('    pass1 完成: 总',total,'主库纯删',mainPureDel,'主库保留',mainEnrichKeep,'内部删',internalDel,'唯一留',uniqueKeep,'输出',outputWanted.size);

if (!APPLY) {
  const dry={ generatedAt:new Date().toISOString(), mode:'DRY', mainScanned:mscanned, total, mainPureDel, mainEnrichKeep, internalDel, uniqueKeep, outputRecords:outputWanted.size, perColl, samples };
  fs.writeFileSync(path.join(OUT,'dedup-body-dryrun.json'), JSON.stringify(dry,null,1));
  console.log('=== DRY 完成(未改动 dataset_dedup) ==='); process.exit(0);
}

// ===== APPLY: pass2 写出去重后数据 =====
console.log('[3] APPLY: 写出去重后 dataset_dedup ...');
let nextId=0; const newCols=[]; const stats=[]; let newFObjCount=0;
for(const col of dm.collections){
  let buf=[]; const collStart=nextId; let kept=0; const chunkFiles=[];
  for(const ck of (col.chunks||[])){
    const fp=path.join(SRC,'poems',ck); if(!fs.existsSync(fp))continue;
    let arr;try{arr=JSON.parse(fs.readFileSync(fp,'utf8'));}catch(e){continue;}
    if(!Array.isArray(arr))continue;
    for(const r of arr){
      if(!r||typeof r!=='object')continue;
      const bk=bodyHash(r);
      if(!outputWanted.has(bk)) continue;
      if(written.has(bk)) continue;
      written.add(bk);
      const f = mergeStore.has(bk) ? mergeStore.get(bk).obj : toObj(r.f);
      let tg = Array.isArray(r.tg)?r.tg.slice():[];
      if(mergeStore.has(bk)){ for(const t of mergeStore.get(bk).tgSet) if(!tg.includes(t)) tg.push(t); }
      const out=Object.assign({},r); out.i=nextId++; out.f=f; out.tg=tg;
      if(typeof out.p==='string') out.p=[out.p]; if(!Array.isArray(out.p)) out.p=[];
      if(f&&Object.keys(f).length) newFObjCount++;
      buf.push(out); kept++;
      if(buf.length>=CHUNK){ const fn=col.id+'-'+String(chunkFiles.length).padStart(4,'0')+'.json'; fs.writeFileSync(path.join(DEDUP,'poems',fn), JSON.stringify(buf)); chunkFiles.push(fn); buf=[]; }
    }
  }
  if(buf.length){ const fn=col.id+'-'+String(chunkFiles.length).padStart(4,'0')+'.json'; fs.writeFileSync(path.join(DEDUP,'poems',fn), JSON.stringify(buf)); chunkFiles.push(fn); buf=[]; }
  if(kept===0){ stats.push({id:col.id,dropped:true}); continue; }
  const nc=Object.assign({},col); nc.start=collStart; nc.count=kept; nc.visible=kept; nc.chunks=chunkFiles;
  newCols.push(nc); stats.push({id:col.id,start:collStart,count:kept,chunks:chunkFiles.length});
}
const newManifest={ v:dm.v, generatedAt:new Date().toISOString(), total:nextId, collections:newCols };
fs.writeFileSync(path.join(DEDUP,'manifest.json'), JSON.stringify(newManifest));
const ar={ generatedAt:newManifest.generatedAt, totalIn:total, outputRecords:nextId, deleted:total-nextId, newFObjCount, droppedCols:stats.filter(s=>s.dropped).map(s=>s.id), stats };
fs.writeFileSync(path.join(OUT,'dedup-body-apply.json'), JSON.stringify(ar,null,1));
console.log('=== APPLY 完成 ===');
console.log('输入',total,'输出(去重后)',nextId,'删除',total-nextId);
console.log('带合并f资料记录',newFObjCount,'丢弃空集合',ar.droppedCols.length, ar.droppedCols);
for(const s of stats.filter(x=>!x.dropped)) console.log(`  ${s.id}: start=${s.start} count=${s.count} chunks=${s.chunks}`);
console.log('DONE');
