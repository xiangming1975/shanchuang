// 确定性校验回填：复算 merge 的 fillTargets，逐一确认主库对应 (file,idx) 记录现已带上 f 字段。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const SITE = path.join(ROOT, 'site');
const POEMS = path.join(SITE, 'data', 'poems');
const CLEANED3 = path.join(ROOT, 'data_2026-10-29', 'cleaned3');
let OpenCC; try { OpenCC = require(path.join(ROOT, 'etl', 'node_modules', 'opencc-js')); } catch (e) { try { OpenCC = require('opencc-js'); } catch (e2) {} }
const convT2S = OpenCC ? OpenCC.Converter({ from: 't', to: 'cn' }) : (s => s);
const PUNCT = /[\s·・\/、，。：:；!！?？（）()【】\[\]「」『』《》〈〉""''"'—\-_～~.…∙]/g;
function normKey(s) { let o = ''; for (const ch of String(s || '')) o += convT2S(ch); return o.replace(PUNCT, '').toLowerCase(); }
const LE = /^(郊庙歌辞|鼓吹曲辞|横吹曲辞|相和歌辞|清商曲辞|舞曲歌辞|琴曲歌辞|杂曲歌辞|近代曲辞|新乐府辞|乐府杂曲)/;
function baseTitle(s) { return normKey(s).replace(LE, '').replace(/(其[一二三四五六七八九十百零]+|之[一二三四五六七八九十百零]+|[一二三四五六七八九十百零]+首?|\d+首?)$/, ''); }
function stripHtml(x) { return x == null ? x : String(x).replace(/<[^>]+>/g, ''); }
const RE_VAR = /[（(][^（）()]{0,16}(?:一作|原作|通|同)[^（）()]{0,16}[)）]/g;
function stripVar(x) { return x ? x.replace(RE_VAR, '') : x; }
function cleanP(x) { return x == null ? x : String(x).replace(/[ \u00a0\u3000\u200b\t]/g, ''); }
function bodySig(r) { const p0 = (r.p && r.p[0]) ? String(r.p[0]) : ''; return normKey(stripHtml(stripVar(p0))).slice(0, 40); }
function lcp(a, b) { let n = 0; const m = Math.min(a.length, b.length); while (n < m && a[n] === b[n]) n++; return n; }
function fHas(v) { if (v == null || v === '') return false; if (typeof v === 'string') return v.trim().length > 0; if (Array.isArray(v)) return v.some(fHas); if (typeof v === 'object') return Object.keys(v).length > 0; return true; }

const c3mf = JSON.parse(fs.readFileSync(path.join(CLEANED3, 'manifest.json'), 'utf8'));
const c3 = [];
for (const col of c3mf.collections) for (const chunk of col.chunks) {
  const fp = path.join(CLEANED3, 'poems', chunk); if (!fs.existsSync(fp)) continue;
  let arr; try { arr = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (e) { continue; }
  for (const r of arr) { const f = r.f && typeof r.f === 'object' ? r.f : {};
    c3.push({ collId: col.id, key: normKey(r.t) + '|' + normKey(r.a), baseKey: baseTitle(r.t) + '|' + normKey(r.a), sig: bodySig({ p: (r.p || []).map(cleanP) }), fy: fHas(f.y) ? f.y : '', fz: fHas(f.z) ? f.z : '', fs: fHas(f.s) ? f.s : '' }); }
}
const manifest = JSON.parse(fs.readFileSync(path.join(SITE, 'data', 'manifest.json'), 'utf8'));
const bmIds = new Set(JSON.parse(fs.readFileSync(path.join(SITE, 'data', 'manifest.json.bak-20261031'), 'utf8')).collections.map(c => c.id));
const liveIndex = new Map(); const liveByAuthor = new Map();
for (const col of manifest.collections) { if (!bmIds.has(col.id)) continue; // 只校验原始 47 个集合的回填
for (const ck of col.chunks) {
  const fp = path.join(POEMS, ck); if (!fs.existsSync(fp)) continue;
  let arr; try { arr = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (e) { continue; }
  for (let idx = 0; idx < arr.length; idx++) { const r = arr[idx]; if (!r || typeof r !== 'object') continue;
    const key = normKey(r.t) + '|' + normKey(r.a); const f = r.f && typeof r.f === 'object' ? r.f : {};
    const rec = { collId: col.id, file: ck, idx, baseKey: baseTitle(r.t) + '|' + normKey(r.a), sig: bodySig(r), hasF: { y: fHas(f.y), z: fHas(f.z), s: fHas(f.s) } };
    let l = liveIndex.get(key); if (!l) { l = []; liveIndex.set(key, l); } l.push(rec);
    const an = normKey(r.a); if (an) { let al = liveByAuthor.get(an); if (!al) { al = []; liveByAuthor.set(an, al); } al.push(rec); }
  }
}
}
const fillTargets = new Map();
function pickByKey(rec, cands) { return (cands && cands.length) ? cands.slice() : []; }
function pickByBase(rec, cands) { if (!cands || !cands.length) return []; return cands.map(c => ({ c, s: lcp(rec.sig, c.sig) })).filter(x => x.s >= 15).map(x => x.c); }
function pickByBody(rec, cands) { if (!cands || !cands.length) return []; const need = Math.min(24, Math.max(8, Math.floor(Math.min(rec.sig.length, 24) * 0.9))); return cands.map(c => ({ c, s: lcp(rec.sig, c.sig) })).filter(x => x.s >= need).map(x => x.c); }
for (const rec of c3) {
  let ch = pickByKey(rec, liveIndex.get(rec.key)); if (!ch.length) ch = pickByBase(rec, liveIndex.get(rec.baseKey)); if (!ch.length) ch = pickByBody(rec, liveByAuthor.get(normKey(rec.a)));
  for (const c of ch) { let m = fillTargets.get(c.file); if (!m) { m = new Map(); fillTargets.set(c.file, m); } let fld = m.get(c.idx); if (!fld) { fld = { y: '', z: '', s: '' }; m.set(c.idx, fld); } if (!c.hasF.y && rec.fy && rec.fy.length > fld.y.length) fld.y = rec.fy; if (!c.hasF.z && rec.fz && rec.fz.length > fld.z.length) fld.z = rec.fz; if (!c.hasF.s && rec.fs && rec.fs.length > fld.s.length) fld.s = rec.fs; }
}
let targets = 0, ok = 0, mismatch = 0, missingFile = 0;
for (const [file, m] of fillTargets) {
  const fp = path.join(POEMS, file); if (!fs.existsSync(fp)) { missingFile++; continue; }
  const arr = JSON.parse(fs.readFileSync(fp, 'utf8'));
  for (const [idx, fld] of m) { targets++; const r = arr[idx]; if (!r) { mismatch++; continue; } const f = r.f || {};
    const good = (!fld.y || fHas(f.y)) && (!fld.z || fHas(f.z)) && (!fld.s || fHas(f.s));
    if (good) ok++; else { mismatch++; if (mismatch <= 5) console.log(`  回填未生效: ${file}#${idx} 期望 y/z/s=${!!fld.y}/${!!fld.z}/${!!fld.s} 实际=${!!fHas(f.y)}/${!!fHas(f.z)}/${!!fHas(f.s)}`); }
  }
}
console.log(`回填目标记录数=${targets}, 现已正确带字段=${ok}, 未生效=${mismatch}, 块文件缺失=${missingFile}`);
console.log(mismatch === 0 && missingFile === 0 ? 'BACKFILL_OK' : 'BACKFILL_FAIL');
