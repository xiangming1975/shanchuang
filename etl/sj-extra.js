// 诗经 3 篇注释补充 → 合并进 out/f-extra.json（走 build 既有管道）
// 芣苡←gushiwen"芣苢"（带赏析）；着←JoyDraw"著"；棠棣←JoyDraw"常棣"
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const OpenCC = require('opencc-js');
const conv = OpenCC.Converter({ from: 't', to: 'cn' });
function normKey(s) {
  let o = '';
  for (const ch of String(s || '')) o += conv(ch);
  return o.replace(/[\s·・\/、，。：:；!！?？（）()【】\[\]「」『』《》〈〉""''"'—\-_～~.…∙]/g, '').toLowerCase();
}
function html2text(html) {
  return String(html || '').replace(/<\s*br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
function splitFanyi(txt) {
  const s = String(txt || '').trim();
  if (!s) return { y: '', z: '' };
  const m = s.match(/\n\s*注释[:：]?\s*\n?/);
  if (m && s.slice(0, m.index).trim()) return { y: s.slice(0, m.index).replace(/^译文[:：]?\s*/, '').trim(), z: s.slice(m.index + m[0].length).trim() };
  if (/^注释/.test(s)) return { y: '', z: s.replace(/^注释[:：]?\s*/, '').trim() };
  return { y: s.replace(/^译文[:：]?\s*/, '').trim(), z: '' };
}

(async () => {
  const extra = JSON.parse(fs.readFileSync('C:/Users/xiang/Downloads/poetry-site/etl/out/f-extra.json', 'utf8'));
  const before = Object.keys(extra).length;

  // 1) 芣苡 ← gushiwen 芣苢（含赏析/背景）
  await new Promise(async (done) => {
    const rl = readline.createInterface({ input: fs.createReadStream('C:/Users/xiang/Downloads/poetry-site/downloads/gushiwen.jsonl', { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of rl) {
      let root; try { root = JSON.parse(line); } catch { continue; }
      const p = root.tb_gushiwen || {};
      if (p.nameStr !== '芣苢') continue;
      const blocks = [...((root.tb_fanyis && root.tb_fanyis.fanyis) || []), ...((root.tb_shangxis && root.tb_shangxis.shangxis) || [])];
      let y = '', z = '', sx = '';
      for (const b of blocks) {
        if (!b || !b.cont) continue;
        const label = String(b.nameStr || '').replace(/\s/g, '');
        if (/译文/.test(label)) {
          const plain = html2text(String(b.cont).replace(/<\s*strong\s*>/gi, '\u0001').replace(/<\s*\/\s*strong\s*>/gi, ''));
          const segs = plain.split('\u0001').map(x => x.trim()).filter(Boolean);
          for (let i = 0; i < segs.length; i++) {
            const lab = segs[i].replace(/\s/g, '');
            const prev = i > 0 ? segs[i - 1].replace(/\s/g, '') : '';
            if (/^(译文|译文及注释)$/.test(lab)) continue;
            if (/^注释$/.test(lab)) continue;
            if (/^译文/.test(prev)) y = segs[i];
            else if (/^注释/.test(prev)) z = segs[i];
          }
        } else if (/注释/.test(label)) { if (!z) z = html2text(b.cont); }
        else if (/赏析/.test(label)) { sx = html2text(b.cont); }
      }
      const rec = {};
      if (y) rec.y = y;
      if (z) rec.z = z;
      if (sx) rec.s = sx;
      // f-extra 结构是 {key: 译文}——注释/赏析用扩展结构 {key: {y,z,s}}
      extra[normKey('芣苡')] = rec;
      break;
    }
    done();
  });

  // 2) 着/棠棣 ← JoyDraw
  const D = 'C:/Users/xiang/Downloads/poetry-site/downloads/joydraw';
  const want = { '著': '着', '常棣': '棠棣' };
  for (const f of fs.readdirSync(D)) {
    if (!/^LCPoetry\d+\.json$/.test(f)) continue;
    const arr = JSON.parse(fs.readFileSync(path.join(D, f), 'utf8'));
    for (const r of arr) {
      const local = want[r.name];
      if (!local) continue;
      const sp = splitFanyi(r.fanyi);
      const rec = {};
      if (sp.y) rec.y = sp.y;
      if (sp.z) rec.z = sp.z;
      if (r.shangxi) rec.s = String(r.shangxi).replace(/^赏析[:：]?\s*/, '').trim();
      extra[normKey(local)] = rec;
    }
  }
  fs.writeFileSync('C:/Users/xiang/Downloads/poetry-site/etl/out/f-extra.json', JSON.stringify(extra));
  console.log(`f-extra: ${before} → ${Object.keys(extra).length}`);
  for (const k of ['芣苡', '着', '棠棣']) console.log('  ' + k + ' → 键 ' + normKey(k) + ': ' + JSON.stringify(extra[normKey(k)]).slice(0, 80));
})();
