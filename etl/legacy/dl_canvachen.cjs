// 下载 CanvaChen/llm-dataset-chinese-poetry 的所有数据文件（jsDelivr CDN + 重试）
const https = require('https');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'data_2026-10-29');
const repo = 'CanvaChen/llm-dataset-chinese-poetry';

function getJson(url) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, r2 => {
      let b = ''; r2.on('data', c => b += c); r2.on('end', () => res(b));
    }).on('error', rej);
  });
}

function dl(url, outFile, retries = 3) {
  return new Promise((res, rej) => {
    const attempt = (n) => {
      const f = fs.createWriteStream(outFile);
      const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 300000 }, r2 => {
        if (r2.statusCode !== 200) { f.destroy(); if (n > 0) attempt(n - 1); else rej(new Error('HTTP ' + r2.statusCode)); return; }
        r2.pipe(f);
        f.on('finish', () => f.close(() => {
          const st = fs.statSync(outFile);
          console.log(path.basename(outFile) + ': ' + (st.size/1024).toFixed(0) + 'KB');
          res(st.size);
        }));
        f.on('error', e => { if (n > 0) attempt(n - 1); else rej(e); });
      });
      req.on('error', e => { f.destroy(); if (n > 0) attempt(n - 1); else rej(e); });
      req.setTimeout(300000, () => { req.destroy(); if (n > 0) attempt(n - 1); else rej(new Error('timeout')); });
    };
    attempt(retries);
  });
}

async function main() {
  const dirs = ['五代诗词', '全唐诗', '四书五经', '宋词', '幽梦影', '御定全唐诗', '曹操诗集', '楚辞', '水墨唐诗', '纳兰性德', '蒙学', '论语', '诗经'];
  for (const dir of dirs) {
    try {
      const r = await getJson('https://api.github.com/repos/' + repo + '/contents/data/' + dir);
      const arr = JSON.parse(r);
      for (const f of arr) {
        if (f.type === 'file' && f.download_url) {
          const outFile = path.join(OUT, 'canva_' + dir + '__' + f.name);
          if (f.size === 0) { console.log(dir + '/' + f.name + ': 空文件跳过'); continue; }
          // 用 jsDelivr CDN
          const cdnUrl = 'https://fastly.jsdelivr.net/gh/' + repo + '@master/data/' + dir + '/' + f.name;
          try { await dl(cdnUrl, outFile); } catch (e) { console.log(dir + '/' + f.name + ': 下载失败 ' + e.message); }
        }
      }
    } catch (e) { console.log(dir + ': 列目录失败'); }
  }
  console.log('---');
  console.log('下载完成');
}
main();
