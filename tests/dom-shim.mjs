// 纯函数快照测试的 DOM 垫片（Node 里跑 site/js 的模块用）
// 只实现被测代码真正碰到的那几个 API：document/window 的事件与查询、按磁盘读文件的 fetch。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SITE = path.resolve(HERE, '../site');

const noop = () => {};

function makeEl(tag = 'div') {
  const el = {
    tagName: tag, style: {}, dataset: {}, children: [], hidden: false,
    innerHTML: '', textContent: '', value: '',
    classList: { add: noop, remove: noop, toggle: () => false, contains: () => false },
    addEventListener: noop, removeEventListener: noop, appendChild: noop,
    insertAdjacentHTML: noop, setAttribute: noop, removeAttribute: noop,
    getAttribute: () => null, focus: noop, blur: noop, remove: noop,
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    scrollHeight: 0, clientWidth: 390, clientHeight: 800,
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 390, height: 800 }),
  };
  return el;
}

globalThis.window = globalThis.window || {};
globalThis.window.addEventListener = noop;
globalThis.window.removeEventListener = noop;
globalThis.window.matchMedia = () => ({ matches: false, addEventListener: noop, removeEventListener: noop });
globalThis.window.innerWidth = 390;
globalThis.window.innerHeight = 844;
globalThis.window.devicePixelRatio = 2;
globalThis.window.scrollTo = noop;

globalThis.document = globalThis.document || {};
globalThis.document.addEventListener = noop;
globalThis.document.removeEventListener = noop;
globalThis.document.getElementById = () => makeEl();
globalThis.document.querySelector = () => null;
globalThis.document.querySelectorAll = () => [];
globalThis.document.createElement = (t) => makeEl(t);
globalThis.document.documentElement = makeEl('html');

// ciMaxChars 要读根字号定「一行几个字」；测试里没有样式引擎，给个固定值
globalThis.getComputedStyle = () => ({ fontSize: '17px', getPropertyValue: () => '' });

globalThis.localStorage = globalThis.localStorage || {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
  clear() { this._m.clear(); },
};

// 主题的「临时翻转」存在 sessionStorage（不碰 shici-theme），测试要能读到它
globalThis.sessionStorage = globalThis.sessionStorage || {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
  clear() { this._m.clear(); },
};

// 把 fetch 指到 site/ 目录（数据索引在测试里要真读）
// 数据目录线上是 .json.gz（2026-11-03 起），垫片跟着认：请求 X 时若只有 X.gz 存在，
// 就回原样 gz 字节（含 content-type）+ 解压后的文本，让 cachedText 走真实的解压分支。
globalThis.fetch = async (url) => {
  const rel = String(url).split('?')[0].replace(/^\.?\//, '');
  const file = path.join(SITE, rel);
  let raw = null, isGz = false;
  try { raw = fs.readFileSync(file); }
  catch { try { raw = fs.readFileSync(file + '.gz'); isGz = true; } catch { raw = null; } }
  if (!raw) {
    return {
      ok: false, status: 404,
      headers: { get: () => 'text/plain' },
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => '', json: async () => ({}),
    };
  }
  const text = (isGz ? zlib.gunzipSync(raw) : raw).toString('utf8');
  return {
    ok: true, status: 200,
    headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? (isGz ? 'application/gzip' : 'application/json') : null) },
    arrayBuffer: async () => raw,
    text: async () => text,
    json: async () => JSON.parse(text),
  };
};

export { makeEl };
