// 详细查看候选数据的内容
const https = require('https');
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function getJson(url) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, r2 => {
      let b = ''; r2.on('data', c => b += c); r2.on('end', () => res(b));
    }).on('error', rej);
  });
}

async function main() {
  // 1. yht_gushiwen.json 是一行 JSON，看结构
  console.log('=== yht050511/gushiwen ===');
  const gzPath = path.join(__dirname, 'data_2026-10-29', 'yht_gushiwen.json.gz');
  const text = zlib.gunzipSync(fs.readFileSync(gzPath), { charset: 'utf8' }).toString('utf8');
  const data = JSON.parse(text);
  console.log('类型:', Array.isArray(data) ? 'array' : typeof data);
  console.log('长度:', Array.isArray(data) ? data.length : Object.keys(data).length);
  if (Array.isArray(data) && data.length > 0) {
    console.log('字段:', Object.keys(data[0]).join(', '));
    console.log('样例:', JSON.stringify(data[0]).slice(0, 500));
  }

  // 2. CanvaChen 的全唐诗目录看看格式
  console.log('\n=== CanvaChen/llm-dataset-chinese-poetry/data/全唐诗 ===');
  const r = await getJson('https://api.github.com/repos/CanvaChen/llm-dataset-chinese-poetry/contents/data/全唐诗');
  const arr = JSON.parse(r);
  arr.forEach(f => console.log('  ' + f.name + ' ' + (f.size ? (f.size/1024).toFixed(0) + 'KB' : '')));
  // 下载第一个文件看格式
  if (arr[0] && arr[0].download_url) {
    const firstFile = await getJson(arr[0].download_url);
    try {
      const arr2 = JSON.parse(firstFile);
      console.log('  文件格式: array,', arr2.length, '条');
      if (arr2.length > 0) {
        console.log('  字段:', Object.keys(arr2[0]).join(', '));
        console.log('  样例:', JSON.stringify(arr2[0]).slice(0, 400));
      }
    } catch (e) { console.log('  非JSON，可能是其他格式'); }
  }
}

main();
