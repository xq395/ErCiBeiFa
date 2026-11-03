"""北伐打卡 · 本地同步服务（仅标准库）

python server.py            # 默认端口 8765
python server.py 9000       # 指定端口
python server.py --open     # 启动后自动打开浏览器（启动.bat 用这个）

电脑和手机连同一个 Wi-Fi / 热点，手机浏览器打开控制台打印的地址即可。
数据存在 data/data.json，知识库正文存在 data/docs/（按文档 id 一个 JSON）。
每天首次写入 data.json 时在 data/backups/ 留一份快照；正文请连 data 文件夹一起备份。
"""
import json
import os
import re
import secrets
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from datetime import date
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent / 'tools'))
from bundle import make_bundle, meta  # noqa: E402

ROOT = Path(__file__).resolve().parent
WEB = ROOT / 'web'
# 测试时可以指向临时目录，正式使用还是 data/
DATA_DIR = Path(os.environ.get('BEIFA_DATA_DIR') or (ROOT / 'data'))
DATA = DATA_DIR / 'data.json'
CONF = DATA_DIR / 'config.json'
BACKUPS = DATA_DIR / 'backups'
DOCS = DATA_DIR / 'docs'  # 知识库正文，按文档 id 一个 JSON，不塞进 data.json
LOCK = threading.Lock()
MAX_BODY = 5 * 1024 * 1024
MAX_DOC = 4 * 1024 * 1024
DOC_ID = re.compile(r'^[A-Za-z0-9_-]{1,64}$')


def load_json(p, default):
    try:
        return json.loads(p.read_text(encoding='utf-8'))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def save_json(p, obj):
    tmp = p.with_suffix('.tmp')
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding='utf-8')
    os.replace(tmp, p)


COLLECTIONS = ('days', 'logs', 'done', 'ai', 'mem', 'events', 'goals', 'kb', 'threads')
SINGLES = ('settings', 'timetable', 'chat')


def empty():
    out = {k: {} for k in COLLECTIONS}
    out.update({k: {} for k in SINGLES})
    return out


def newer(a, b):
    """a、b 都是带 ts 的 dict，返回较新的那个。"""
    if not isinstance(a, dict):
        return b
    if not isinstance(b, dict):
        return a
    return b if b.get('ts', 0) > a.get('ts', 0) else a


def merge(a, b):
    out = empty()
    for key in COLLECTIONS:
        src_a, src_b = a.get(key) or {}, b.get(key) or {}
        for k in set(src_a) | set(src_b):
            out[key][k] = newer(src_a.get(k), src_b.get(k))
    for key in SINGLES:
        out[key] = newer(a.get(key) or {}, b.get(key) or {})
    return out


def config():
    conf = load_json(CONF, None)
    if not conf:
        conf = {'pin': f'{secrets.randbelow(10**6):06d}'}
        save_json(CONF, conf)
    return conf


def lan_ips():
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    # 开着代理（TUN 模式）时上面两种只拿得到虚拟网卡地址，再问一下系统的网卡列表
    if os.name == 'nt':
        try:
            out = subprocess.run(['ipconfig'], capture_output=True, timeout=5).stdout.decode('gbk', 'replace')
            ips.update(re.findall(r'IPv4[^:：]*[:：]\s*([\d.]+)', out))
        except (OSError, subprocess.SubprocessError):
            pass
    # 去掉回环、链路本地（169.254）和代理软件虚拟网卡常用的 198.18/15
    def lan(ip):
        a, b = (int(x) for x in ip.split('.')[:2])
        return not (a == 127 or (a, b) == (169, 254) or (a == 198 and b in (18, 19)))
    return sorted(ip for ip in ips if lan(ip))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(WEB), **kw)

    def log_message(self, fmt, *args):
        line = str(args[0]) if args else ''
        if '/api/' in line or '/apk' in line:
            ua = self.headers.get('User-Agent', '') if self.headers else ''
            who = 'App' if '; wv)' in ua else ('浏览器' if 'Mobile' in ua else '')
            sys.stderr.write('%s %s %s\n' % (self.address_string(), who, fmt % args))

    def handle(self):
        # 手机切后台、断热点时会直接断开连接，不用打印一大串报错
        try:
            super().handle()
        except (ConnectionResetError, BrokenPipeError):
            pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        # 单文件版从 file:// 打开时 Origin 是 null，靠 PIN 鉴权，所以放开 CORS
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Pin')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def reply(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authed(self):
        if self.headers.get('X-Pin', '') == PIN:
            return True
        self.reply(401, {'error': 'PIN 不对'})
        return False

    def do_GET(self):
        if self.path.startswith('/api/ping'):
            if self.authed():
                self.reply(200, {'ok': True})
            return
        if self.path.startswith('/api/config'):
            if self.authed():
                c = config()
                self.reply(200, {'deepseek_key': c.get('deepseek_key', ''),
                                 'deepseek_model': c.get('deepseek_model', 'deepseek-flash')})
            return
        # 知识库正文：先取清单（只有 id），再按需取单篇
        p = urlparse(self.path)
        if p.path == '/api/docs':
            if not self.authed():
                return
            with LOCK:
                ids = sorted(x.stem for x in DOCS.glob('*.json') if DOC_ID.match(x.stem)) if DOCS.exists() else []
            self.reply(200, {'app': 'beifa', 'docs': ids})
            return
        if p.path == '/api/doc':
            if not self.authed():
                return
            doc_id = (parse_qs(p.query).get('id') or [''])[0]
            if not DOC_ID.match(doc_id):
                self.reply(400, {'error': 'bad id'})
                return
            with LOCK:
                d = load_json(DOCS / f'{doc_id}.json', None)
            if not isinstance(d, dict) or not isinstance(d.get('chunks'), list):
                self.reply(404, {'error': '没有这篇正文'})
                return
            self.reply(200, {'id': doc_id, 'chunks': d['chunks'], 'ts': d.get('ts', 0)})
            return
        # 只给条数，用于新浏览器第一次打开时提示"电脑上已有数据"。不含正文，所以不要 PIN
        if self.path.startswith('/api/summary'):
            with LOCK:
                d = load_json(DATA, empty())
            self.reply(200, {'app': 'beifa', 'counts': {k: len(d.get(k) or {}) for k in ('logs', 'days', 'done', 'goals', 'kb')}})
            return
        # 版本信息和应用包不需要 PIN：里面只有页面代码，没有数据和 Key
        if self.path.startswith('/api/version'):
            self.reply(200, {'app': 'beifa', **meta(make_bundle())})
            return
        if self.path.startswith('/api/bundle'):
            self.reply(200, make_bundle())
            return
        if self.path.split('?')[0].rstrip('*%2A.,，。)） ').lower() in ('/apk', '/beifa.apk'):
            apk = ROOT / 'dist' / '北伐打卡.apk'
            if not apk.exists():
                self.reply(404, {'error': '还没打包，先运行 python tools/build_apk.py --with-key'})
                return
            data = apk.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'application/vnd.android.package-archive')
            self.send_header('Content-Disposition', 'attachment; filename="beifa.apk"')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if self.path.startswith('/api/'):
            self.reply(404, {'error': 'not found'})
            return
        super().do_GET()

    def do_POST(self):
        if self.path.startswith('/api/diag'):
            n = min(int(self.headers.get('Content-Length') or 0), 20000)
            body = self.rfile.read(n).decode('utf-8', 'replace')
            (DATA_DIR / 'diag.json').write_text(body, encoding='utf-8')
            sys.stderr.write('自检结果：' + body + '\n')
            self.reply(200, {'ok': True})
            return
        if urlparse(self.path).path == '/api/doc':
            if not self.authed():
                return
            n = int(self.headers.get('Content-Length') or 0)
            if n <= 0 or n > MAX_DOC:
                self.reply(400, {'error': 'body size'})
                return
            try:
                body = json.loads(self.rfile.read(n))
                doc_id = body.get('id') if isinstance(body, dict) else None
                chunks = body.get('chunks') if isinstance(body, dict) else None
                if not isinstance(doc_id, str) or not DOC_ID.match(doc_id):
                    raise ValueError
                if not isinstance(chunks, list) or not all(isinstance(c, dict) and isinstance(c.get('text'), str) for c in chunks):
                    raise ValueError
                if len(chunks) > 5000:
                    raise ValueError
            except (ValueError, json.JSONDecodeError):
                self.reply(400, {'error': 'bad doc'})
                return
            with LOCK:
                DOCS.mkdir(parents=True, exist_ok=True)
                save_json(DOCS / f'{doc_id}.json', {'id': doc_id, 'chunks': chunks, 'ts': int(time.time() * 1000)})
            self.reply(200, {'ok': True, 'id': doc_id, 'chunks': len(chunks)})
            return
        if not self.path.startswith('/api/sync'):
            self.reply(404, {'error': 'not found'})
            return
        if not self.authed():
            return
        n = int(self.headers.get('Content-Length') or 0)
        if n <= 0 or n > MAX_BODY:
            self.reply(400, {'error': 'body size'})
            return
        try:
            incoming = json.loads(self.rfile.read(n))
            if not isinstance(incoming, dict):
                raise ValueError
        except ValueError:
            self.reply(400, {'error': 'bad json'})
            return
        with LOCK:
            current = load_json(DATA, empty())
            merged = merge(current, incoming)
            snap = BACKUPS / f'{date.today().isoformat()}.json'
            if DATA.exists() and not snap.exists():
                snap.write_text(DATA.read_text(encoding='utf-8'), encoding='utf-8')
            save_json(DATA, merged)
        self.reply(200, merged)


def port_open(port):
    """Windows 上 SO_REUSEADDR 允许重复绑定，先探一下有没有人在听。"""
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=0.5):
            return True
    except OSError:
        return False


def main():
    global PIN
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    port = int(args[0]) if args else 8765
    BACKUPS.mkdir(parents=True, exist_ok=True)
    DOCS.mkdir(parents=True, exist_ok=True)
    PIN = config()['pin']
    if port_open(port):
        print(f'端口 {port} 已经有程序在用：北伐打卡服务可能已经开着了，不再重复启动。')
        if '--open' in sys.argv:
            webbrowser.open(f'http://127.0.0.1:{port}')
        return
    srv = None
    try:
        srv = ThreadingHTTPServer(('0.0.0.0', port), Handler)
    except OSError:
        print(f'端口 {port} 已经被占用：服务可能已经开着了，不再重复启动。')
        if '--open' in sys.argv:
            webbrowser.open(f'http://127.0.0.1:{port}')
        return
    if '--open' in sys.argv:
        threading.Timer(0.5, lambda: webbrowser.open(f'http://127.0.0.1:{port}')).start()
    print('北伐打卡 已启动')
    print(f'  电脑：http://127.0.0.1:{port}')
    for ip in lan_ips():
        print(f'  手机：http://{ip}:{port}')
    m = meta(make_bundle())
    print(f'  当前版本：{m["hash"]}（{m["built"]}），手机在 设置→更新 里检查')
    if (ROOT / 'dist' / '北伐打卡.apk').exists():
        for ip in lan_ips():
            print(f'  安卓安装包：http://{ip}:{port}/apk')
    print(f'  同步 PIN：{PIN}（首次打开时输入，改 PIN 就编辑 data/config.json）')
    print('  电脑首次打开如果是空的：点页面上方的「和电脑合并」，输入 PIN，把 data/data.json 里的数据拉下来')
    print('  Ctrl+C 退出')
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


PIN = ''
if __name__ == '__main__':
    main()
