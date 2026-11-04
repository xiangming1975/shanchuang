// lunar.js 的已知日期验证：春节/中秋/端午/重阳 等农历节日与节气公式
// 用法：node tests/lunar.test.mjs
import { lunarDate, solarTermDate, solarTermName } from '../site/js/lunar.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++;
  else { fail++; console.log(`✗ ${name}\n    got  ${g}\n    want ${w}`); }
};
const D = (s2) => { const [y, m, d] = s2.split('-').map(Number); return new Date(y, m - 1, d); };
const MD = (dt) => [dt.m, dt.d];

// ---------- 农历节日（均为官方公历日期，可查历核实）----------
eq('2025 春节 = 1/1', MD(lunarDate(D('2025-01-29'))), [1, 1]);
eq('2024 春节 = 1/1', MD(lunarDate(D('2024-02-10'))), [1, 1]);
eq('2026 春节 = 1/1', MD(lunarDate(D('2026-02-17'))), [1, 1]);
eq('2025 中秋 = 8/15', MD(lunarDate(D('2025-10-06'))), [8, 15]);
eq('2024 中秋 = 8/15', MD(lunarDate(D('2024-09-17'))), [8, 15]);
eq('2025 端午 = 5/5', MD(lunarDate(D('2025-05-31'))), [5, 5]);
eq('2025 重阳 = 9/9', MD(lunarDate(D('2025-10-29'))), [9, 9]);
eq('2025 元宵 = 1/15', MD(lunarDate(D('2025-02-12'))), [1, 15]);
eq('2025 腊八 = 12/8', MD(lunarDate(D('2025-01-07'))), [12, 8]);
eq('2024 腊月三十（当年有年三十）', MD(lunarDate(D('2024-02-09'))), [12, 30]);
eq('2025 除夕前一天 = 12/29（腊月小）', MD(lunarDate(D('2025-01-28'))), [12, 29]);

// ---------- 节气公式 ----------
eq('清明 2025-04-04', solarTermDate(2025, '清明').getDate(), 4);
eq('冬至 2025-12-21', solarTermDate(2025, '冬至').getDate(), 21);
eq('立春 2025-02-03', solarTermDate(2025, '立春').getDate(), 3);
eq('雨水 2025-02-18', solarTermDate(2025, '雨水').getDate(), 18);
eq('清明 2024-04-04', solarTermDate(2024, '清明').getDate(), 4);
eq('夏至 2025-06-21', solarTermDate(2025, '夏至').getDate(), 21);

// solarTermName：节气当天命中、非节气日不命中
eq('solarTermName 2025-04-04 = 清明', solarTermName(D('2025-04-04')), '清明');
eq('solarTermName 2025-04-10 = null', solarTermName(D('2025-04-10')), null);

console.log(fail ? `✗ 农历/节气 ${fail}/${pass + fail} 失败` : `✓ 农历/节气 ${pass} 项全过`);
process.exit(fail ? 1 : 0);
