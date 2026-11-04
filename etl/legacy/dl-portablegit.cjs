// 从 npmmirror 下载 PortableGit（自解压 7z，免管理员）
const https = require('https');
const fs = require('fs');
const path = require('path');

const urls = [
  'https://registry.npmmirror.com/-/binary/git-for-windows/v2.56.0.windows.4/PortableGit-2.56.0.4-64-bit.7z.exe',
  'https://registry.npmmirror.com/-/binary/git-for-windows/v2.55.0.windows.1/PortableGit-2.55.0.windows.1.64-bit.7z.exe',
];
const OUT = path.join(__dirname, 'PortableGit.7z.exe');

function dl(url, redirects) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 600000 }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && redirects > 0) {
        r.resume();
        return res(dl(r.headers.location, redirects - 1));
      }
      if (r.statusCode !== 200) { r.resume(); return rej(new Error('HTTP ' + r.statusCode + ' ' + url)); }
      const f = fs.createWriteStream(OUT);
      let got = 0, last = 0;
      r.on('data', c => { got += c.length; if (got - last > 20 * 1024 * 1024) { last = got; console.log('  已下载', (got / 1048576).toFixed(0), 'MB'); } });
      r.pipe(f);
      f.on('finish', () => f.close(() => res(got)));
      f.on('error', rej);
    }).on('error', rej);
  });
}

(async () => {
  for (const u of urls) {
    try {
      console.log('尝试:', u);
      const n = await dl(u, 5);
      console.log('完成:', (n / 1048576).toFixed(1), 'MB →', OUT);
      process.exit(0);
    } catch (e) { console.log('失败:', e.message); }
  }
  process.exit(1);
})();
