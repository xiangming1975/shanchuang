// 深入检查候选 GitHub 仓库的文件结构
const https = require('https');
const fs = require('fs');

function get(url) {
  return new Promise(res => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, r2 => {
      let b = '';
      r2.on('data', c => b += c);
      r2.on('end', () => res(b));
    }).on('error', e => res('ERR: ' + e.message));
  });
}

async function showRepo(fullName) {
  console.log('=== ' + fullName + ' ===');
  // 先获取 repo 信息拿默认分支
  const infoRaw = await get('https://api.github.com/repos/' + fullName);
  let branch = 'main';
  try { const info = JSON.parse(infoRaw); branch = info.default_branch || 'main'; } catch (e) {}
  // 列根目录
  const listRaw = await get('https://api.github.com/repos/' + fullName + '/contents/?ref=' + branch);
  try {
    const arr = JSON.parse(listRaw);
    arr.forEach(f => console.log('  ' + (f.type === 'dir' ? 'dir ' : 'file ') + f.name + (f.size ? ' (' + (f.size/1024).toFixed(0) + 'KB)' : '')));
  } catch (e) {
    console.log('  parse error:', listRaw.slice(0, 150));
  }
  console.log('');
}

async function main() {
  const repos = [
    'yht050511/gushiwen',
    'THUNLP-AIPoet/Datasets',
    'CanvaChen/llm-dataset-chinese-poetry',
  ];
  for (const r of repos) {
    await showRepo(r);
  }
}
main();
