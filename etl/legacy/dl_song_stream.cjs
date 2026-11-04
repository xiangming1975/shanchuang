// 流式下载 poet.song.json（支持大文件）
const https = require('https');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'data_2026-10-29');
const url = 'https://raw.githubusercontent.com/CanvaChen/llm-dataset-chinese-poetry/master/data/全唐诗/poet.song.json';
const outFile = path.join(OUT, 'canva_全唐诗__poet.song.json');

const file = fs.createWriteStream(outFile);
const request = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*' } }, (response) => {
  if (response.statusCode !== 200) {
    console.error('HTTP', response.statusCode);
    file.close();
    process.exit(1);
    return;
  }
  response.pipe(file);
  file.on('finish', () => {
    file.close(() => {
      const st = fs.statSync(outFile);
      console.log('下载完成:', (st.size / 1024 / 1024).toFixed(1), 'MB');
      // 验证
      const fd = fs.openSync(outFile, 'r');
      const buf = Buffer.alloc(128);
      fs.readSync(fd, buf, 0, 128, 0);
      fs.closeSync(fd);
      console.log('前128字符:', buf.toString('utf8'));
    });
  });
});
request.on('error', (e) => {
  console.error('请求错误:', e.message);
  file.close();
  process.exit(1);
});
request.setTimeout(600000, () => {
  console.error('超时');
  request.destroy();
  process.exit(1);
});
