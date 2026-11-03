"""把 dist/北伐打卡-更新.json 整理成 update 分支要发布的文件。

GitHub Actions 里用；本地想手动发布也可以跑：
  python tools/build.py
  python tools/make_update_branch.py
生成 .update-branch/version.json 和 bundle.json。
"""
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / '.update-branch'
SRC = ROOT / 'dist' / '北伐打卡-更新.json'


def main():
    if not SRC.exists():
        raise SystemExit('先运行 python tools/build.py 生成更新包')
    b = json.loads(SRC.read_text(encoding='utf-8'))
    if b.get('app') != 'beifa' or not b.get('hash') or not isinstance(b.get('js'), list):
        raise SystemExit('更新包格式不对')
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir()
    (OUT / 'version.json').write_text(json.dumps({
        'app': 'beifa',
        'hash': b['hash'],
        'built': b.get('built', ''),
        'size': sum(len(f.get('code', '')) for f in b['js']) + len(b.get('css', '')),
    }, ensure_ascii=False, indent=2), encoding='utf-8')
    shutil.copyfile(SRC, OUT / 'bundle.json')
    print(f'已生成 {OUT}：版本 {b["hash"]}（{b.get("built", "")}）')


if __name__ == '__main__':
    main()
