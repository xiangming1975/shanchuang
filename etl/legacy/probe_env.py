import os, sys, subprocess
d = 'C:/Users/xiang/Downloads'
for f in os.listdir(d):
    if f.lower().endswith('.epub'):
        full = os.path.join(d, f)
        print(repr(f))
        print('  size:', os.path.getsize(full))

print('---python---')
print('python:', sys.version)

print('---pip pkgs---')
try:
    out = subprocess.check_output(['python', '-m', 'pip', 'list'], encoding='utf-8')
    for line in out.splitlines():
        low = line.lower()
        if any(k in low for k in ['ebook', 'beautif', 'bs4', 'lxml', 'epub', 'html5']):
            print('  ', line)
except Exception as e:
    print('  pip list failed:', e)

print('---node---')
try:
    out = subprocess.check_output(['node', '--version'], encoding='utf-8')
    print('  node:', out.strip())
except Exception as e:
    print('  node failed:', e)
