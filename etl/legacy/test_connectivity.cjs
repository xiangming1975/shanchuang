// 测试各站点连通性
const https = require('https');
const tests = [
  ['https://hf-mirror.com/api/datasets?limit=1', 'HF镜像'],
  ['https://api.github.com/rate_limit', 'GitHub API'],
  ['https://modelscope.cn/api/v1/datasets?PageSize=1', 'ModelScope'],
  ['https://zh.wikisource.org/w/api.php?action=query&list=search&srsearch=%E7%B2%8D%E4%BA%8C%E4%B8%96&format=json&srlimit=1', 'Wikisource'],
  ['https://gitee.com/api/v5/search/repositories?q=%E8%AF%97%E8%AF%8D%E6%95%B0%E6%8D%AE%E9%9B%86&per_page=1', 'Gitee'],
  ['https://datasets-server.huggingface.co/rows?dataset=PoetryMTEB%2FAppreciation-of-Chinese-Classical-Poetry&config=corpus&split=train&offset=0&length=1', 'HF Datasets Server'],
  ['https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/master/README.md', 'Raw GitHub'],
  ['https://fastly.jsdelivr.net/gh/yxcs/poems-db@master/README.md', 'jsDelivr Fastly'],
  ['https://ctext.org/wiki.pl?if=gb&res=43903', 'ctext.org'],
];

function test(url, label) {
  return new Promise(res => {
    const t = Date.now();
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 }, r2 => {
      r2.resume();
      const ms = Date.now() - t;
      res(label + ': OK ' + ms + 'ms HTTP ' + r2.statusCode);
    }).on('timeout', () => { res(label + ': TIMEOUT 15s'); }).on('error', e => { res(label + ': FAIL ' + e.message); });
  });
}

async function main() {
  for (const [url, label] of tests) {
    console.log(await test(url, label));
  }
}
main();
