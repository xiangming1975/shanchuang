// 从 fastly.jsdelivr 并行下载 JoyDraw aio 数据文件
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = 'C:/Users/xiang/Downloads/poetry-site/downloads/joydraw';
fs.mkdirSync(DIR, { recursive: true });
const FILES = ['LCPoetry1.json', 'LCPoetry2.json', 'LCPoetry3.json', 'LCPoetry4.json', 'LCPoetry5.json', 'LCPoetry6.json', 'LCPoetry7.json', 'LCPoetry8.json', 'LCPoet.json'];

function fetchOne(name) {
  return new Promise((resolve) => {
    const dest = path.join(DIR, name);
    let attempt = 0;
    const go = () => {
      attempt++;
      const c = spawn('curl.exe', ['-sS', '-L', '--speed-time', '40', '--speed-limit', '20480',
        '--max-time', '600', '-o', dest,
        `https://fastly.jsdelivr.net/gh/JoyDraw/poetry-1@master/data/aio/${name}`]);
      c.on('close', code => {
        const sz = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
        if (sz > 100000) { console.log(`${name} OK ${(sz / 1048576).toFixed(1)}MB`); resolve(); }
        else if (attempt < 6) { console.log(`${name} retry ${attempt} (code=${code}, ${sz}B)`); setTimeout(go, 3000); }
        else { console.log(`${name} FAILED`); resolve(); }
      });
    };
    go();
  });
}

(async () => {
  console.time('joydraw');
  await Promise.all(FILES.map(fetchOne));
  console.timeEnd('joydraw');
  let total = 0, missing = 0;
  for (const f of FILES) {
    const sz = fs.existsSync(path.join(DIR, f)) ? fs.statSync(path.join(DIR, f)).size : 0;
    total += sz;
    if (sz < 100000 && f !== 'LCPoet.json') missing++;
  }
  console.log(`合计 ${(total / 1048576).toFixed(1)}MB, 缺失 ${missing}`);
  console.log(missing === 0 ? 'JOYDRAW_OK' : 'JOYDRAW_PARTIAL');
})();
