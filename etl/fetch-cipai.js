// 抓取 longyusheng.org《唐宋词格律》全部词牌页 → out/cipai-raw.json
const fs = require('fs');
const https = require('https');

const INDEX = 'C:/Users/xiang/Downloads/poetry-site/downloads/cipai-index.html';
const OUT = 'C:/Users/xiang/Downloads/poetry-site/etl/out/cipai-raw.json';
fs.mkdirSync('C:/Users/xiang/Downloads/poetry-site/etl/out', { recursive: true });

const html = new TextDecoder('gbk').decode(fs.readFileSync(INDEX));
// 别名 → 页面
const aliasMap = new Map(); // page -> Set(names)
for (const m of html.matchAll(/<a\s+href="\.\.\/cipai\/(cipai\d+\.html)"[^>]*>([^<]{1,20})<\/a><span class="note">\(([^)]+)\)<\/span>/g)) {
  const page = m[1], name = m[2].trim(), cat = m[3].trim();
  if (!aliasMap.has(page)) aliasMap.set(page, { names: new Set(), cat });
  aliasMap.get(page).names.add(name);
}
console.log('词牌页数:', aliasMap.size);

function fetchPage(page) {
  return new Promise((resolve) => {
    const req = https.get(`https://longyusheng.org/cipai/${page}`, { timeout: 20000 }, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        try {
          const buf = Buffer.concat(chunks);
          resolve(new TextDecoder('gbk').decode(buf));
        } catch (e) { resolve(''); }
      });
    });
    req.on('error', () => resolve(''));
    req.on('timeout', () => { req.destroy(); resolve(''); });
  });
}

function stripTags(s) {
  return s.replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

(async () => {
  const pages = [...aliasMap.keys()];
  const results = [];
  const CONC = 6;
  let i = 0, done = 0;
  async function worker() {
    while (i < pages.length) {
      const page = pages[i++];
      const raw = await fetchPage(page);
      const rec = { page, names: [...aliasMap.get(page).names], cat: aliasMap.get(page).cat };
      if (raw) {
        const body = raw.slice(raw.indexOf('<body'));
        const text = stripTags(body);
        // 说明：第一个【xx】头之前的部分中，取【词牌、别名】头之后到【定格】前的内容
        const mHead = text.match(/【([^】]+)】/);
        if (mHead) {
          rec.headNames = mHead[1];
          const afterHead = text.slice(text.indexOf(mHead[0]) + mHead[0].length);
          const geIdx = afterHead.indexOf('【');
          rec.intro = (geIdx > 0 ? afterHead.slice(0, geIdx) : afterHead).trim();
          // 格律：【定格】之后、上一词牌之前
          const geStart = text.indexOf('【定格】');
          const navIdx = text.indexOf('上一词牌');
          if (geStart >= 0) {
            rec.gelv = text.slice(geStart + 5, navIdx > 0 ? navIdx : undefined).replace(/\s+/g, ' ').trim();
          }
        }
      }
      results.push(rec);
      done++;
      if (done % 25 === 0) console.log(`进度 ${done}/${pages.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  const okCount = results.filter(r => r.intro).length;
  fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
  console.log(`完成: ${okCount}/${results.length} 页含介绍 → ${OUT}`);
})();
