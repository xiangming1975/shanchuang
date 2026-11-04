// HTML 小工具（与拼音模块无关，单独一层避免 py.js ↔ vcommon.js 循环依赖）
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
