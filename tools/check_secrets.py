"""提交前检查：别把 DeepSeek Key、签名密钥、本机数据带上 GitHub。

用法：python tools/check_secrets.py
CI 里也会跑；发现可疑内容直接失败。
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PATTERNS = [
    re.compile(r'sk-[A-Za-z0-9]{24,}'),
    re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    re.compile(r'github_pat_[A-Za-z0-9_]{20,}'),
    re.compile(r'gh[pousr]_[A-Za-z0-9]{30,}'),
]
FORBIDDEN_SUFFIX = ('.keystore', '.jks', '.apk')


def tracked_files():
    r = subprocess.run(['git', 'ls-files'], cwd=ROOT, capture_output=True, text=True)
    if r.returncode != 0:
        return None
    return [p for p in r.stdout.splitlines() if p.strip()]


def local_key():
    p = ROOT / 'data' / 'config.json'
    if not p.exists():
        return ''
    try:
        return (json.loads(p.read_text(encoding='utf-8')).get('deepseek_key') or '').strip()
    except (OSError, ValueError):
        return ''


def main():
    files = tracked_files()
    if files is None:
        print('不在 git 仓库里，跳过检查')
        return 0
    key = local_key()
    problems = []
    for name in files:
        if name.startswith(('data/', 'dist/')) or name in ('data', 'dist') or name.endswith(FORBIDDEN_SUFFIX):
            problems.append((name, '本机数据 / 构建产物'))
            continue
        p = ROOT / name
        try:
            if p.stat().st_size > 2_000_000:
                continue
            text = p.read_text(encoding='utf-8', errors='ignore')
        except OSError:
            continue
        if key and key in text:
            problems.append((name, '含有 data/config.json 里的 DeepSeek Key'))
            continue
        for pat in PATTERNS:
            if pat.search(text):
                problems.append((name, '看起来像 Key / 私钥'))
                break
    if problems:
        print('✗ 发现不能上传的内容：')
        for name, why in problems:
            print(f'  {name}：{why}')
        return 1
    print(f'✓ 检查通过：{len(files)} 个文件，没有 Key、签名密钥或本机数据')
    return 0


if __name__ == '__main__':
    sys.exit(main())
