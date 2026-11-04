# -*- coding: utf-8 -*-
"""楷体子集构建（A18）：从全库语料算字符集，裁剪霞鹜文楷，输出站内 woff2。

用法：
  python etl/build-font.py            # 已有成品就跳过
  python etl/build-font.py --force    # 强制重切
  python etl/build-font.py --charset-only   # 只重算字符集，不切字体

前提：python -m pip install fonttools brotli

为什么不用 3500 常用字：探针实测（字体探针-20261028.md）那样切，
89.8% 的详情页会冒出宋体字，平均每页 4.3 个。子集必须按**本库真实用字**来切。
源字体 24MB 不入库，缺失时自动下载到 ~/.cache/font-probe/（构建可复现，仓库不背二进制）。
"""
import json
import os
import subprocess
import sys
import urllib.request

# Windows 控制台默认 GBK：'✓' 打不出来会 UnicodeEncodeError，构建明明成功却以非零码退出
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
POEMS = os.path.join(ROOT, 'site', 'data', 'poems')
OUT = os.path.join(ROOT, 'site', 'fonts', 'lxgw-wenkai-sub.woff2')
CHARSET = os.path.join(HERE, 'font-charset.txt')
CACHE = os.path.join(os.path.expanduser('~'), '.cache', 'font-probe')
SRC = os.path.join(CACHE, 'LXGWWenKai-Regular.ttf')
SRC_SIZE = 24744500
MIRRORS = [
    'https://ghfast.top/https://github.com/lxgw/LxgwWenKai/releases/download/v1.520/LXGWWenKai-Regular.ttf',
    'https://gh-proxy.com/https://github.com/lxgw/LxgwWenKai/releases/download/v1.520/LXGWWenKai-Regular.ttf',
]
GATE_MB = 4.6          # 体积门禁：超了就说明误加了字重或字族


def collect():
    """扫全库，按出现频次降序返回字符列表（频次高的在前，便于人工抽查）。"""
    freq = {}
    files = sorted(f for f in os.listdir(POEMS) if f.endswith('.json'))
    for i, f in enumerate(files):
        with open(os.path.join(POEMS, f), encoding='utf-8') as fh:
            data = json.load(fh)
        rows = data if isinstance(data, list) else data.get('rows', [])
        for r in rows:
            for key, val in r.items():
                stack = [val]
                while stack:
                    v = stack.pop()
                    if isinstance(v, str):
                        for ch in v:
                            if not ch.isspace():
                                freq[ch] = freq.get(ch, 0) + 1
                    elif isinstance(v, list):
                        stack.extend(v)
        if (i + 1) % 400 == 0:
            print(f'  扫描 {i + 1}/{len(files)}', flush=True)
    return [c for c, _ in sorted(freq.items(), key=lambda kv: -kv[1])]


def ensure_src():
    if os.path.exists(SRC) and os.path.getsize(SRC) >= SRC_SIZE:
        return SRC
    os.makedirs(CACHE, exist_ok=True)
    for url in MIRRORS:
        try:
            print('下载源字体…', url, flush=True)
            part = SRC + '.part'
            urllib.request.urlretrieve(url, part)
            if os.path.getsize(part) >= SRC_SIZE:
                os.replace(part, SRC)
                return SRC
            os.remove(part)
        except Exception as e:                     # 换镜像再试
            print('  失败：', e, flush=True)
    sys.exit('源字体下载失败；手动放到 ' + SRC)


def main():
    force = '--force' in sys.argv
    if os.path.exists(OUT) and not force and '--charset-only' not in sys.argv:
        print('已存在，跳过：', OUT, f'({os.path.getsize(OUT) / 1048576:.2f}MB)')
        return

    print('统计全库用字…', flush=True)
    chars = collect()
    with open(CHARSET, 'w', encoding='utf-8') as fh:
        fh.write(''.join(chars))
    print(f'  不同字符 {len(chars)} → {CHARSET}', flush=True)
    if '--charset-only' in sys.argv:
        return

    src = ensure_src()
    from fontTools.ttLib import TTFont
    tt = TTFont(src, lazy=True)
    cmap = set(tt.getBestCmap().keys())
    tt.close()
    text = ''.join(c for c in chars if ord(c) in cmap)
    print(f'  字体内有 {len(text)}，缺 {len(chars) - len(text)}（扩展区生僻字，占出现次数 0.006%）', flush=True)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = os.path.join(CACHE, 'charset-build.txt')
    with open(tmp, 'w', encoding='utf-8') as fh:
        fh.write(text)
    subprocess.run([sys.executable, '-m', 'fontTools.subset', src,
                    f'--text-file={tmp}', '--layout-features=*',
                    '--drop-tables+=DSIG', '--name-IDs=*', '--no-hinting',
                    '--flavor=woff2', f'--output-file={OUT}'], check=True)
    mb = os.path.getsize(OUT) / 1048576
    print(f'  输出 {OUT}  {mb:.2f}MB  ({len(text)} 字)', flush=True)
    if mb > GATE_MB:
        sys.exit(f'✗ 超过体积门禁 {GATE_MB}MB')
    print('✓ 完成')


if __name__ == '__main__':
    main()
