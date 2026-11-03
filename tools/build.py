"""生成手机用的单文件版和更新包。

python tools/build.py              # 不带 Key
python tools/build.py --with-key   # 把 data/config.json 里的 DeepSeek Key 写进去（这个文件别外传）

输出：
  dist/北伐打卡.html        首次安装用，发到手机用浏览器打开
  dist/北伐打卡-更新.json   更新包，手机在 设置→更新→导入更新文件（不含 Key，数据不受影响）
"""
import base64
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bundle import WEB, make_bundle, meta  # noqa: E402

ROOT = WEB.parent
DIST = ROOT / 'dist'


def smoke():
    import shutil
    import subprocess
    node = shutil.which('node')
    if not node:
        print('（没装 Node，跳过冒烟测试）')
        return
    r = subprocess.run([node, str(Path(__file__).with_name('smoke.js'))], capture_output=True, text=True, encoding='utf-8')
    print(r.stdout.strip() or r.stderr.strip())
    if r.returncode != 0:
        sys.exit('冒烟测试失败，没有生成安装包')


def main():
    smoke()
    b = make_bundle()
    icon = base64.b64encode((WEB / 'icon-192.png').read_bytes()).decode()
    preset = ''
    if '--with-key' in sys.argv:
        conf = json.loads((ROOT / 'data' / 'config.json').read_text(encoding='utf-8'))
        key, model = conf.get('deepseek_key', ''), conf.get('deepseek_model', 'deepseek-flash')
        if key:
            preset = ('<script>if(!localStorage.getItem("beifa.dskey")){'
                      f'localStorage.setItem("beifa.dskey",{json.dumps(key)});'
                      f'localStorage.setItem("beifa.dsmodel",{json.dumps(model)});}}</script>\n')
    payload = json.dumps(b, ensure_ascii=False).replace('</', '<\\/')
    loader = (WEB / 'loader.js').read_text(encoding='utf-8')
    html = f'''<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#14161a">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="北伐打卡">
<title>北伐打卡</title>
<link rel="icon" href="data:image/png;base64,{icon}">
<link rel="apple-touch-icon" href="data:image/png;base64,{icon}">
</head>
<body>
{preset}<script type="application/json" id="beifa-bundle">{payload}</script>
<script>
{loader}
</script>
</body>
</html>
'''
    DIST.mkdir(exist_ok=True)
    out = DIST / '北伐打卡.html'
    out.write_text(html, encoding='utf-8')
    upd = DIST / '北伐打卡-更新.json'
    upd.write_text(json.dumps(b, ensure_ascii=False), encoding='utf-8')
    m = meta(b)
    print(f'版本 {m["hash"]}（{m["built"]}）')
    print(f'  {out.name}：{out.stat().st_size // 1024} KB{"，含 DeepSeek Key" if preset else ""}')
    print(f'  {upd.name}：{upd.stat().st_size // 1024} KB（不含 Key）')


if __name__ == '__main__':
    main()
