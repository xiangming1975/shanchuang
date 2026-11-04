// 下载候选仓库的数据文件
const https = require('https');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'data_2026-10-29');
const jsdelivrBase = 'https://fastly.jsdelivr.net/gh/';

function dl(url, outFile) {
  return new Promise((res, rej) => {
    const f = fs.createWriteStream(outFile);
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 300000 }, r2 => {
      if (r2.statusCode === 302 || r2.statusCode === 301) {
        f.destroy();
        dl(r2.headers.location, outFile).then(res, rej);
        return;
      }
      if (r2.statusCode !== 200) { f.destroy(); rej(new Error('HTTP ' + r2.statusCode)); return; }
      r2.pipe(f);
      f.on('finish', () => {
        f.close(() => {
          const st = fs.statSync(outFile);
          console.log(path.basename(outFile) + ': ' + (st.size / 1024).toFixed(0) + 'KB');
          res(st.size);
        });
      });
      f.on('error', rej);
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', rej);
  });
}

async function main() {
  // yht050511/gushiwen: gushiwen.json.gz 48MB —— jsDelivr 可以走大文件？试试
  // 先试 raw GitHub
  console.log('Downloading yht050511/gushiwen...');
  try {
    await dl('https://raw.githubusercontent.com/yht050511/gushiwen/master/gushiwen.json.gz', path.join(OUT, 'yht_gushiwen.json.gz'));
  } catch (e) {
    console.log('  raw failed:', e.message);
    console.log('  trying jsDelivr...');
    try { await dl(jsdelivrBase + 'yht050511/gushiwen@master/gushiwen.json.gz', path.join(OUT, 'yht_gushiwen.json.gz')); }
    catch (e2) { console.log('  jsdelivr failed:', e2.message); }
  }

  // THUNLP-AIPoet/Datasets 目录结构
  console.log('\nListing THUNLP-AIPoet/Datasets...');
  try {
    const r = await new Promise((res, rej) => {
      https.get('https://api.github.com/repos/THUNLP-AIPoet/Datasets/contents/', { headers: { 'User-Agent': 'Mozilla/5.0' } }, r2 => {
        let b = ''; r2.on('data', c => b += c); r2.on('end', () => res(b));
      }).on('error', rej);
    });
    const arr = JSON.parse(r);
    arr.forEach(f => console.log('  ' + f.name + (f.size ? ' (' + (f.size/1024).toFixed(0) + 'KB)' : '')));
  } catch (e) { console.log('  error:', e.message); }

  // CanvaChen/llm-dataset-chinese-poetry 目录结构
  console.log('\nListing CanvaChen/llm-dataset-chinese-poetry/data...');
  try {
    const r = await new Promise((res, rej) => {
      https.get('https://api.github.com/repos/CanvaChen/llm-dataset-chinese-poetry/contents/data', { headers: { 'User-Agent': 'Mozilla/5.0' } }, r2 => {
        let b = ''; r2.on('data', c => b += c); r2.on('end', () => res(b));
      }).on('error', rej);
    });
    const arr = JSON.parse(r);
    arr.forEach(f => console.log('  ' + f.name + (f.size ? ' (' + (f.size/1024).toFixed(0) + 'KB)' : '')));
  } catch (e) { console.log('  error:', e.message); }
}

main();
