const fs=require('fs');
const path=require('path');
const DEDUP='C:/Users/xiang/Downloads/dataset_dedup';
const MAIN='C:/Users/xiang/Downloads/poetry-site/site/data';

function dumpFirstWithF(dir, collIdHint, label){
  console.log('\n########## '+label+' ##########');
  const m=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
  const col=m.collections.find(c=>c.id===collIdHint);
  if(!col){console.log('no coll',collIdHint);return;}
  const ck=col.chunks[0];
  const arr=JSON.parse(fs.readFileSync(path.join(dir,'poems',ck),'utf8'));
  // find a record that has an object f or longer f
  let r=arr.find(x=>x&&typeof x.f==='object')||arr.find(x=>Array.isArray(x.f)&&x.f.length>1)||arr[0];
  console.log('collection',collIdHint,'chunk',ck,'records',arr.length);
  console.log('record keys:',Object.keys(r));
  console.log('typeof f:',typeof r.f, Array.isArray(r.f)?'array len '+(r.f.length):'');
  const clone=JSON.parse(JSON.stringify(r));
  // show f structure fully
  console.log('F VALUE:', JSON.stringify(r.f));
  // show any fields that look like translation/annotation
  for(const k of Object.keys(r)){
    const v=r[k];
    if(k==='f')continue;
    if(typeof v==='string'&&v.length>40) console.log(`-- ${k} (string ${v.length}):`, v.slice(0,120)+'…');
    else if(Array.isArray(v)) console.log(`-- ${k} (array ${v.length}):`, JSON.stringify(v.slice(0,3)));
    else console.log(`-- ${k}:`, JSON.stringify(v));
  }
}

// dedup: gushiwen (has 译文/注释/赏析), and orchestra, and a corpus (s33)
dumpFirstWithF(DEDUP,'s17_yht_gushiwen','DEDUP s17 gushiwen');
dumpFirstWithF(DEDUP,'s25_hf_orchestra','DEDUP s25 orchestra');
dumpFirstWithF(DEDUP,'s33_hf_tri','DEDUP s33 三语语料');

// main lib: jsshi (鉴赏诗选 has 赏析), tang (全唐诗), a gushiwen new coll
dumpFirstWithF(MAIN,'jsshi','MAIN jsshi 鉴赏诗选');
dumpFirstWithF(MAIN,'tang','MAIN tang 全唐诗');
dumpFirstWithF(MAIN,'s17_yht_gushiwen','MAIN s17 (if exists)');
