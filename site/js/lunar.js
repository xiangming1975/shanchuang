// 农历与二十四节气计算（首页大标题诗句的日期判定用）
// 农历：标准 lunarInfo 表（1900–2100，公开通用数据）；节气：21 世纪通用日期公式
//（日 = floor(Y×0.2422 + C) − L，L 为闰年修正；个别极端年份可能差一天，展示用足够）。

const LUNAR_INFO = [
  0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,
  0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
  0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,
  0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
  0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,
  0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0,
  0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,
  0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6,
  0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570,
  0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x05ac0, 0x0ab60, 0x096d5, 0x092e0,
  0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5,
  0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
  0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530,
  0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,
  0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0,
  0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0,
  0x0a2e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4,
  0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0,
  0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x04b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160,
  0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252,
  0x0d520,
];

function lunarLeapMonth(y) { return LUNAR_INFO[y - 1900] & 0xf; }
function lunarMonthDays(y, m) { return (LUNAR_INFO[y - 1900] & (0x10000 >> m)) ? 30 : 29; }
function lunarLeapDays(y) {
  return lunarLeapMonth(y) ? ((LUNAR_INFO[y - 1900] & 0x10000) ? 30 : 29) : 0;
}
function lunarYearDays(y) {
  let sum = 348;
  for (let i = 0x8000; i > 0x8; i >>= 1) sum += (LUNAR_INFO[y - 1900] & i) ? 1 : 0;
  return sum + lunarLeapDays(y);
}

// 公历日期 → 农历 { y, m, d, leap }（y 为农历年，m/d 为月日，leap=闰月）
export function lunarDate(date) {
  let offset = Math.floor(
    (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(1900, 0, 31)) / 86400000);
  let y = 1900, temp = 0;
  for (; y < 2101 && offset > 0; y++) { temp = lunarYearDays(y); offset -= temp; }
  if (offset < 0) { offset += temp; y--; }
  const leap = lunarLeapMonth(y);
  let isLeap = false, m = 1;
  for (; m < 13 && offset > 0; m++) {
    if (leap > 0 && m === leap + 1 && isLeap === false) {
      --m; isLeap = true; temp = lunarLeapDays(y);
    } else {
      temp = lunarMonthDays(y, m);
    }
    if (isLeap === true && m === leap + 1) isLeap = false;
    offset -= temp;
  }
  if (offset === 0 && leap > 0 && m === leap + 1) {
    if (isLeap) isLeap = false;
    else { isLeap = true; --m; }
  }
  if (offset < 0) { offset += temp; --m; }
  return { y, m, d: offset + 1, leap: isLeap };
}

// 二十四节气：名称 → 21 世纪的 C 值与月份
const TERMS = [
  ['小寒', 1, 5.4055], ['大寒', 1, 20.12],
  ['立春', 2, 3.87], ['雨水', 2, 18.73],
  ['惊蛰', 3, 5.63], ['春分', 3, 20.646],
  ['清明', 4, 4.81], ['谷雨', 4, 20.1],
  ['立夏', 5, 5.52], ['小满', 5, 21.04],
  ['芒种', 6, 5.678], ['夏至', 6, 21.37],
  ['小暑', 7, 7.108], ['大暑', 7, 22.83],
  ['立秋', 8, 7.5], ['处暑', 8, 23.13],
  ['白露', 9, 7.646], ['秋分', 9, 23.042],
  ['寒露', 10, 8.318], ['霜降', 10, 23.438],
  ['立冬', 11, 7.438], ['小雪', 11, 22.36],
  ['大雪', 12, 7.18], ['冬至', 12, 21.94],
];

// 某年某节气的公历日期（近似公式，个别极端年份可能差一天）
export function solarTermDate(year, name) {
  const t = TERMS.find(x => x[0] === name);
  if (!t) return null;
  const [, month, c] = t;
  const y = year % 100;
  const L = month <= 2 ? Math.floor((y - 1) / 4) : Math.floor(y / 4);
  const day = Math.floor(y * 0.2422 + c) - L;
  return new Date(year, month - 1, day);
}

// 今天是哪个节气日（仅节气当天命中；不是则返回 null）
export function solarTermName(date) {
  const t = TERMS.find(x => {
    const d = solarTermDate(date.getFullYear(), x[0]);
    return d && d.getMonth() === date.getMonth() && d.getDate() === date.getDate();
  });
  return t ? t[0] : null;
}
