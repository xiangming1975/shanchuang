// 死重归档（Review O1）：把网站里已无引用的文件**移出** repo，移到同级备份目录，可随时恢复。
// 不删除任何东西；manifest 记录每次移动的 from/to，restore.js 反向执行即可复原。
//   node archive-dead.js            # 只打印计划
//   node archive-dead.js --go       # 真正移动
const fs = require('fs');
const path = require('path');

const ROOT = 'C:/Users/xiang/Downloads/poetry-site';
const DEST = 'C:/Users/xiang/Downloads/poetry-site-archive-20261027';

// 主链与仍在用的脚本：留在 etl/ 里
const KEEP = new Set([
  'extract.js', 'match.js', 'match2.js', 'ingest.js', 'niu-ingest.js', 'sj-extra.js',
  'build-keben.js', 'build.js', 'build-pingze.js', 'build-citpl.js', 'build-genre.js',
  'fill-tang300.js', 'xds-fix-apply.mjs', 'check-zhu.js', 'zhu-gaps.js',
  'fetch-cipai.js', 'fetch-joydraw.js', 'fetch-niu.js', 'songci-override.mjs',
  'build-backup.js',
]);

const plan = [];

// 1) 音频（朗诵已改 speechSynthesis，前端零引用）
const audio = path.join(ROOT, 'site/audio');
if (fs.existsSync(audio)) plan.push({ from: audio, to: path.join(DEST, 'site-audio') });

// 2) 根目录里的旧服务器
for (const f of ['server2.js', 'server-backup.js']) {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p)) plan.push({ from: p, to: path.join(DEST, 'root', f) });
}

// 3) etl 里的一次性脚本（不在白名单的一律归档）
for (const f of fs.readdirSync(path.join(ROOT, 'etl'))) {
  if (!/\.(js|mjs)$/.test(f)) continue;
  if (KEEP.has(f) || f === path.basename(__filename)) continue;   // 别把自己也归档了
  plan.push({ from: path.join(ROOT, 'etl', f), to: path.join(DEST, 'etl-dead', f) });
}

if (!process.argv.includes('--go')) {
  let bytes = 0;
  for (const it of plan) {
    const st = fs.statSync(it.from);
    if (st.isDirectory()) {
      const walk = (d) => fs.readdirSync(d).reduce((n, f) => {
        const p = path.join(d, f); const s = fs.statSync(p);
        return n + (s.isDirectory() ? walk(p) : s.size);
      }, 0);
      bytes += walk(it.from);
    } else bytes += st.size;
  }
  console.log(`计划归档 ${plan.length} 项，约 ${(bytes / 1048576).toFixed(0)}MB`);
  plan.slice(0, 8).forEach(x => console.log('  ', path.relative(ROOT, x.from)));
  console.log('  …（共', plan.length, '项）\n加 --go 执行');
  process.exit(0);
}

fs.mkdirSync(DEST, { recursive: true });
const manifestPath = path.join(DEST, 'manifest.json');
const old = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { items: [] };
let done = 0, bytes = 0;
for (const it of plan) {
  fs.mkdirSync(path.dirname(it.to), { recursive: true });
  try {
    const st = fs.statSync(it.from);
    const size = st.isDirectory()
      ? fs.readdirSync(it.from, { recursive: true }).reduce((n, f) => {
          const p = path.join(it.from, f); const s = fs.statSync(p); return n + (s.isFile() ? s.size : 0);
        }, 0)
      : st.size;
    fs.renameSync(it.from, it.to);
    bytes += size;
    done++;
    old.items.push({ from: it.from, to: it.to, size });
  } catch (e) {
    console.log('  跳过（占用或其它）：', path.basename(it.from), e.message.slice(0, 60));
  }
}
fs.writeFileSync(manifestPath, JSON.stringify({ archivedAt: new Date().toISOString(), items: old.items }, null, 1));
console.log(`已归档 ${done}/${plan.length} 项，约 ${(bytes / 1048576).toFixed(0)}MB → ${DEST}`);
console.log(`manifest: ${manifestPath}`);
