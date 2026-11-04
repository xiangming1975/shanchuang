const fs = require('fs');
const zlib = require('zlib');
const text = zlib.gunzipSync(fs.readFileSync('data_2026-10-29/yht_gushiwen.json.gz'), { charset: 'utf8' }).toString('utf8');
const data = JSON.parse(text);
console.log('records:', data.length);
// 检查 sons 结构
const sonTypes = {};
let withSons = 0;
for (const r of data) {
  if (r.sons) {
    withSons++;
    for (const k of Object.keys(r.sons)) sonTypes[k] = (sonTypes[k] || 0) + 1;
  }
}
console.log('with sons:', withSons, '| son types:', JSON.stringify(sonTypes));
// 看 sons 内容样例
const s = data[0].sons;
if (s) {
  console.log('sons keys:', Object.keys(s));
  const content = Object.values(s)[0];
  console.log('son content (first 300):', JSON.stringify(content).slice(0, 300));
}
// 检查 content 字段（正文）样例
console.log('content sample:', JSON.stringify(data[0].content).slice(0, 200));
