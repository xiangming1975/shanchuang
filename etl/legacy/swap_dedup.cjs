const fs = require('fs');
const OLD = 'C:/Users/xiang/Downloads/dataset_dedup';
const BAK = 'C:/Users/xiang/Downloads/dataset_dedup.dedup1';
const OUT = 'C:/Users/xiang/Downloads/dataset_dedup.out';

function attempt(label, fn) {
  for (let i = 1; i <= 5; i++) {
    try { fn(); console.log(`[${label}] OK on try ${i}`); return true; }
    catch (e) {
      console.log(`[${label}] try ${i} failed: ${e.code} ${e.message}`);
      if (i < 5) { const t = Date.now(); while (Date.now() - t < 2000) {} }
    }
  }
  return false;
}

const ok1 = attempt('rename old->.dedup1', () => fs.renameSync(OLD, BAK));
if (!ok1) { console.log('FATAL: cannot move old dataset_dedup away (likely locked by another process).'); process.exit(3); }

try {
  fs.renameSync(OUT, OLD);
  console.log('SWAP OK: dataset_dedup now holds cleaned + re-deduped data');
} catch (e) {
  console.log('rename out->live failed:', e.code, e.message, '— rolling back to old');
  try { fs.renameSync(BAK, OLD); console.log('rollback: old dataset_dedup restored'); }
  catch (e2) { console.log('rollback FAILED:', e2.message, '— old is at dataset_dedup.dedup1, clean at dataset_dedup.out'); }
  process.exit(4);
}
console.log('done');
