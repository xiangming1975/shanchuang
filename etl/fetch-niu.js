// 并行下载 NiuTrans 全部 bitext 文件（fastly.jsdelivr，断点续传式跳过已有）
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const LIST = JSON.parse(fs.readFileSync('C:/Users/xiang/Downloads/poetry-site/etl/niu-bitext-list.json', 'utf8'));
const DIR = 'C:/Users/xiang/Downloads/poetry-site/downloads/niu';
fs.mkdirSync(DIR, { recursive: true });

function dl(item) {
  return new Promise((resolve) => {
    const safeName = item.p.replace(/[\\/]/g, '~');
    const dest = path.join(DIR, safeName);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 50) { resolve('skip'); return; }
    const url = 'https://fastly.jsdelivr.net/gh/NiuTrans/Classical-Modern@main/' + encodeURI(item.p);
    let attempt = 0;
    const go = () => {
      attempt++;
      const c = spawn('curl.exe', ['-sS', '-L', '--speed-time', '30', '--speed-limit', '8192',
        '--max-time', '120', '-o', dest, url]);
      c.on('close', () => {
        const ok = fs.existsSync(dest) && fs.statSync(dest).size > 50;
        if (ok) resolve('ok');
        else if (attempt < 5) setTimeout(go, 1500);
        else resolve('fail');
      });
    };
    go();
  });
}

(async () => {
  console.time('niu-download');
  let i = 0, ok = 0, skip = 0, fail = 0;
  const CONC = 12;
  async function worker() {
    while (i < LIST.length) {
      const item = LIST[i++];
      const r = await dl(item);
      if (r === 'ok') ok++;
      else if (r === 'skip') skip++;
      else fail++;
      if ((ok + skip + fail) % 500 === 0) console.log(`进度 ${ok + skip + fail}/${LIST.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  console.timeEnd('niu-download');
  console.log(`完成 ok=${ok} skip=${skip} fail=${fail} / ${LIST.length}`);
  console.log(fail === 0 ? 'NIU_OK' : 'NIU_PARTIAL');
})();
