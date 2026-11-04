// 第二轮清理 + 去重：
//   1) 删除英文翻译 f.e
//   2) 删除填空题集合 s15_hf_benchmark（整集合）
//   3) 删除拼音 f.pinyin / f.tpinyin
//   4) 删除 f.q
//   5) 重新做正文去重（对照主库 + 集合内部，合并其余 f 资料），重排 id、重建 manifest
// 主库只读。读取当前 dataset_dedup，写到临时目录，成功后整体替换（旧目录另存为 dataset_dedup.dedup1 作为可回滚点）。
const fs = require('fs');
const path = require('path');
const ROOT = 'C:/Users/xiang/Downloads/poetry-site';
const MAIN_POEMS = path.join(ROOT, 'site', 'data', 'poems');
const MAIN_MANIFEST = path.join(ROOT, 'site', 'data', 'manifest.json');
const SRC = 'C:/Users/xiang/Downloads/dataset_dedup';
const TMP = 'C:/Users/xiang/Downloads/dataset_dedup.out';
const BAK = 'C:/Users/xiang/Downloads/dataset_dedup.dedup1';
const OUT = path.join(ROOT, 'audit-dedup-out');
fs.mkdirSync(OUT, { recursive: true });
const CHUNK = 200;

const DROP_COLL = 's15_hf_benchmark';               // 填空题集合
const STRIP_KEYS = ['e', 'pinyin', 'tpinyin', 'q']; // 要删除的 f 键

let OpenCC;
try { OpenCC = require(path.join(ROOT, 'etl', 'node_modules', 'opencc-js')); } catch (e) { try { OpenCC = require('opencc-js'); } catch (e2) {} }
const convT2S = OpenCC ? OpenCC.Converter({ from: 't', to: 'cn' }) : (s => s);
const PUNCT = /[\s·・\/、，。：:；!！?？（）()【】\[\]「」『』《》〈〉""''"'—\-_～~.…∙]/g;
function normKey(s){let o='';for(const ch of String(s||''))o+=convT2S(ch);return o.replace(PUNCT,'').toLowerCase();}
function hash16(str){let h1=2166136261>>>0,h2=2166136261>>>0;for(let i=0;i<str.length;i++){const c=str.charCodeAt(i);h1^=c;h1=Math.imul(h1,16777619)>>>0;h2^=(c+1);h2=Math.imul(h2,16777619^0x9e3779b9)>>>0;}return h1.toString(16).padStart(8,'0')+h2.toString(16).padStart(8,'0');}
function bodyHash(r){const p=Array.isArray(r.p)?r.p:(typeof r.p==='string'?[r.p]:[]);const joined=p.join('');const len=joined.replace(/\s/g,'').length;const head=normKey(joined.slice(0,150)).slice(0,120);return hash16(head+'|'+len);}
function cleanF(f){const o={};if(Array.isArray(f)){for(const c of f) if(c && !STRIP_KEYS.includes(String(c))) o[String(c)]='';}else if(f&&typeof f==='object'){for(const k of Object.keys(f)){if(STRIP_KEYS.includes(k))continue;const v=f[k];o[k]=(v==null)?'':(typeof v==='string'?v:(typeof v==='object'?JSON.stringify(v):String(v)));}}return o;}
function fKeysOf(f){const obj=cleanF(f);const has=new Set(),text=new Set();for(const k of Object.keys(obj)){has.add(k);if((''+obj[k]).trim().length>0)text.add(k);}return{obj,has,text};}

// [1] 主库 body 索引(只读)
console.log('[1] 建主库 body 索引(只读) ...');
const mm=JSON.parse(fs.readFileSync(MAIN_MANIFEST,'utf8'));
const mainKeys=new Map(),mainText=new Map();let mscanned=0;
for(const col of mm.collections)for(const ck of (col.chunks||[])){
  const fp=path.join(MAIN_POEMS,ck);if(!fs.existsSync(fp))continue;
  let arr;try{arr=JSON.parse(fs.readFileSync(fp,'utf8'));}catch(e){continue;}
  for(const r of arr){if(!r||typeof r!=='object')continue;mscanned++;const bk=bodyHash(r);let ks=mainKeys.get(bk);if(!ks){ks=new Set();mainKeys.set(bk,ks);mainText.set(bk,new Set());}const fk=fKeysOf(r.f);for(const k of fk.has)ks.add(k);for(const k of fk.text)mainText.get(bk).add(k);}
}
console.log('    主库',mscanned,'唯一body',mainKeys.size);

// [2] 扫描 dataset_dedup
console.log('[2] 扫描 dataset_dedup ...');
const dm=JSON.parse(fs.readFileSync(path.join(SRC,'manifest.json'),'utf8'));
function listFiles(d){const out=[];(function w(x){for(const e of fs.readdirSync(x,{withFileTypes:true})){const fp=path.join(x,e.name);if(e.isDirectory())w(fp);else if(e.name.endsWith('.json'))out.push(fp);}})(path.join(d,'poems'));return out;}
const files=listFiles(SRC).sort();
let total=0,mainPureDel=0,mainEnrichKeep=0,internalDel=0,uniqueKeep=0;
let cntStripE=0,cntStripPy=0,cntStripQ=0,cntDropColl=0;
const seenBody=new Set(),outputWanted=new Set(),mergeStore=new Map(),written=new Set();
function mergeInto(bk,fk,tg){let ms=mergeStore.get(bk);if(!ms){ms={obj:{},tgSet:new Set()};mergeStore.set(bk,ms);}for(const k of fk.has){if(!(k in ms.obj)||(ms.obj[k].trim().length===0&&fk.text.has(k)))ms.obj[k]=fk.obj[k];}for(const t of tg)ms.tgSet.add(t);}
const perColl={};
function processRecord(r,cid){
  if(cid===DROP_COLL){cntDropColl++;return;}            // 删除填空题集合
  if(!r||typeof r!=='object')return;total++;
  if(!perColl[cid])perColl[cid]={total:0,mainPureDel:0,mainEnrichKeep:0,internalDel:0,uniqueKeep:0};
  const pc=perColl[cid];pc.total++;
  const f0=r.f||{}; if(!Array.isArray(f0)&&f0&&typeof f0==='object'){if('e'in f0)cntStripE++;if('pinyin'in f0||'tpinyin'in f0)cntStripPy++;if('q'in f0)cntStripQ++;}
  const bk=bodyHash(r),fk=fKeysOf(r.f),tg=Array.isArray(r.tg)?r.tg:[];
  if(mainKeys.has(bk)){
    let enrich=false;const mk=mainKeys.get(bk);
    for(const k of fk.has)if(!mk.has(k)){enrich=true;break;}
    if(!enrich){const mt=mainText.get(bk);for(const k of fk.text)if(!mt.has(k)){enrich=true;break;}}
    if(enrich){mainEnrichKeep++;pc.mainEnrichKeep++;outputWanted.add(bk);mergeInto(bk,fk,tg);}
    else{mainPureDel++;pc.mainPureDel++;}return;
  }
  if(seenBody.has(bk)){internalDel++;pc.internalDel++;mergeInto(bk,fk,tg);}
  else{seenBody.add(bk);uniqueKeep++;pc.uniqueKeep++;outputWanted.add(bk);if(fk.has.size)mergeInto(bk,fk,tg);}
}
for(const fp of files){const base=path.basename(fp);const cid=base.replace(/-(\d+)\.json$/,'');
  if(cid===DROP_COLL){const arr=JSON.parse(fs.readFileSync(fp,'utf8'));cntDropColl+=Array.isArray(arr)?arr.length:0;continue;} // 整集合跳过
  let arr;try{arr=JSON.parse(fs.readFileSync(fp,'utf8'));}catch(e){continue;}
  if(!Array.isArray(arr))continue;
  for(const r of arr)processRecord(r,cid);
}
console.log('    pass1 完成: 总',total,'主库纯删',mainPureDel,'主库保留',mainEnrichKeep,'内部删',internalDel,'唯一留',uniqueKeep,'输出',outputWanted.size);
console.log('    字段删除: e=',cntStripE,' pinyin/tpinyin=',cntStripPy,' q=',cntStripQ,' 删除集合 s15=',cntDropColl);

// [3] APPLY: 写出去重后数据到 TMP
console.log('[3] APPLY: 写出去重后数据到临时目录 ...');
fs.mkdirSync(path.join(TMP,'poems'),{recursive:true});
let nextId=0;const newCols=[],stats=[];let newFObjCount=0;
for(const col of dm.collections){
  if(col.id===DROP_COLL){stats.push({id:col.id,dropped:true});continue;} // 丢弃填空题集合
  let buf=[];const collStart=nextId;let kept=0;const chunkFiles=[];
  for(const ck of (col.chunks||[])){
    const fp=path.join(SRC,'poems',ck);if(!fs.existsSync(fp))continue;
    let arr;try{arr=JSON.parse(fs.readFileSync(fp,'utf8'));}catch(e){continue;}
    if(!Array.isArray(arr))continue;
    for(const r of arr){
      if(!r||typeof r!=='object')continue;
      const bk=bodyHash(r);
      if(!outputWanted.has(bk))continue;
      if(written.has(bk))continue;
      written.add(bk);
      let f=mergeStore.has(bk)?Object.assign({},mergeStore.get(bk).obj):cleanF(r.f);
      cleanInPlace(f);
      let tg=Array.isArray(r.tg)?r.tg.slice():[];
      if(mergeStore.has(bk)){for(const t of mergeStore.get(bk).tgSet)if(!tg.includes(t))tg.push(t);}
      const out=Object.assign({},r);out.i=nextId++;out.f=f;out.tg=tg;
      if(typeof out.p==='string')out.p=[out.p];if(!Array.isArray(out.p))out.p=[];
      if(f&&Object.keys(f).length)newFObjCount++;
      buf.push(out);kept++;
      if(buf.length>=CHUNK){const fn=col.id+'-'+String(chunkFiles.length).padStart(4,'0')+'.json';fs.writeFileSync(path.join(TMP,'poems',fn),JSON.stringify(buf));chunkFiles.push(fn);buf=[];}
    }
  }
  if(buf.length){const fn=col.id+'-'+String(chunkFiles.length).padStart(4,'0')+'.json';fs.writeFileSync(path.join(TMP,'poems',fn),JSON.stringify(buf));chunkFiles.push(fn);buf=[];}
  if(kept===0){stats.push({id:col.id,dropped:true});continue;}
  const nc=Object.assign({},col);nc.start=collStart;nc.count=kept;nc.visible=kept;nc.chunks=chunkFiles;
  newCols.push(nc);stats.push({id:col.id,start:collStart,count:kept,chunks:chunkFiles.length});
}
function cleanInPlace(f){if(f&&typeof f==='object'&&!Array.isArray(f)){for(const k of STRIP_KEYS)delete f[k];}}
const newManifest={v:dm.v,generatedAt:new Date().toISOString(),total:nextId,collections:newCols};
fs.writeFileSync(path.join(TMP,'manifest.json'),JSON.stringify(newManifest));
const ar={generatedAt:newManifest.generatedAt,totalIn:total+cntDropColl,outputRecords:nextId,deleted:(total+cntDropColl)-nextId,newFObjCount,droppedCols:stats.filter(s=>s.dropped).map(s=>s.id),strip:{e:cntStripE,pinyin_tpinyin:cntStripPy,q:cntStripQ},stats};
fs.writeFileSync(path.join(OUT,'clean-dedup2-apply.json'),JSON.stringify(ar,null,1));
console.log('=== APPLY 完成(写入 TMP) ===');
console.log('输入(含s15)',total+cntDropColl,'输出(去重后)',nextId,'删除',(total+cntDropColl)-nextId);
console.log('带f资料记录',newFObjCount,'丢弃空集合',ar.droppedCols.length,ar.droppedCols);

// [4] 校验 TMP 一致性后再替换
const sumCount=newCols.reduce((s,c)=>s+c.count,0);
if(sumCount!==nextId){console.error('!! manifest 计数与 nextId 不一致, 中止替换');process.exit(2);}
console.log('[4] 校验通过(sum count =',sumCount,'== nextId',nextId,')，执行替换 ...');
if(fs.existsSync(BAK))fs.rmSync(BAK,{recursive:true,force:true});
fs.renameSync(SRC,BAK);
fs.renameSync(TMP,SRC);
console.log('    旧版已存为',BAK);
console.log('DONE');
