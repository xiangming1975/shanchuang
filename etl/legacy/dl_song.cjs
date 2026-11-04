// 用 GitHub raw 下载 poet.song.json（jsDelivr 对大文件有 50MB 限制）
const https = require('https');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'data_2026-10-29');
const url = 'https://raw.githubusercontent.com/CanvaChen/llm-dataset-chinese-poetry/master/data/全唐诗/poet.song.json';
const outFile = path.join(OUT, 'canva_全唐诗__poet.song.json');

function dl(url, outFile, retries = 3) {
  return new Promise((res, rej) => {
    const attempt = (n) => {
      const f = fs.createWriteStream(outFile);
      const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 600000 }, r2 => {
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
      req.setTimeout(600000, () => { req.destroy(); if (n > 0) attempt(n - 1); else rej(new Error('timeout')); });
    };
    attempt(retries);
  });
}

dl(url, outFile).then(() => console.log('下载完成')).catch(e => console.log('失败: ' + e.message));
