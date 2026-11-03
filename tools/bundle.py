"""把 web/ 打包成一个"应用包"（dict），build.py 和 server.py 共用。

应用包 = 页面骨架 + CSS + 按顺序的 JS。手机端 loader 存一份到 localStorage，离线也能跑。
"""
import hashlib
import re
from datetime import datetime
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / 'web'


def make_bundle(web=WEB):
    index = (web / 'index.html').read_text(encoding='utf-8')
    body = index.split('<body>', 1)[1]
    markup = body.split('<script', 1)[0].strip()
    names = re.findall(r'<script src="([\w.]+)"></script>', body)
    css = (web / 'style.css').read_text(encoding='utf-8')
    js = [{'name': n, 'code': (web / n).read_text(encoding='utf-8')} for n in names]

    h = hashlib.sha256()
    for part in [markup, css] + [f['code'] for f in js]:
        h.update(part.encode('utf-8'))
    files = [web / 'index.html', web / 'style.css'] + [web / n for n in names]
    built = datetime.fromtimestamp(max(f.stat().st_mtime for f in files)).strftime('%Y-%m-%d %H:%M:%S')
    return {'app': 'beifa', 'hash': h.hexdigest()[:10], 'built': built, 'body': markup, 'css': css, 'js': js}


def meta(b):
    return {'hash': b['hash'], 'built': b['built'], 'size': sum(len(f['code']) for f in b['js']) + len(b['css'])}
