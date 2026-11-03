"""打安卓安装包（不用 Gradle / Android Studio）。

python tools/build_apk.py              # 不带 Key
python tools/build_apk.py --with-key   # 把 data/config.json 里的 DeepSeek Key 写进去

输出 dist/北伐打卡.apk。签名密钥在 data/beifa.keystore，第一次自动生成：
别删它，换了密钥手机上就不能覆盖安装，只能卸载重装（会丢数据）。

需要：JDK 17+，Android SDK 的 build-tools 35 和 platforms/android-35
（默认找 %LOCALAPPDATA%\\Android\\Sdk，或设置 ANDROID_HOME）。
"""
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build  # noqa: E402
from bundle import WEB  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
AND = ROOT / 'android'
OUT = ROOT / 'dist' / 'build-apk'
SDK = Path(os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT')
           or Path(os.environ['LOCALAPPDATA']) / 'Android' / 'Sdk')
BT = SDK / 'build-tools' / '35.0.0'
ANDROID_JAR = SDK / 'platforms' / 'android-35' / 'android.jar'
KEYSTORE = ROOT / 'data' / 'beifa.keystore'
KS_PASS = 'beifa-local'  # 自用签名，密码只防误操作
VERSION_FILE = ROOT / 'data' / 'apk_version.txt'


def java_bin(name):
    home = os.environ.get('JAVA_HOME')
    if home:
        p = Path(home) / 'bin' / (name + '.exe')
        if p.exists():
            return str(p)
    found = shutil.which(name)
    if not found:
        sys.exit(f'找不到 {name}，请安装 JDK 17 以上并设置 JAVA_HOME')
    return found


def run(*cmd):
    r = subprocess.run([str(c) for c in cmd], capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r.returncode != 0:
        print(r.stdout)
        print(r.stderr)
        sys.exit(f'失败：{Path(str(cmd[0])).name}')
    return r.stdout


def next_version():
    n = int(VERSION_FILE.read_text().strip()) + 1 if VERSION_FILE.exists() else 1
    VERSION_FILE.write_text(str(n))
    return n


def main():
    for p in (BT / 'aapt2.exe', ANDROID_JAR):
        if not p.exists():
            sys.exit(f'缺少 {p}，见 README 的"打安卓包"一节')
    java, javac, keytool = java_bin('java'), java_bin('javac'), java_bin('keytool')

    # 1. 网页：复用单文件版（loader + 内置应用包），作为 assets/index.html
    build.main()
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / 'assets').mkdir(parents=True)
    shutil.copy(ROOT / 'dist' / '北伐打卡.html', OUT / 'assets' / 'index.html')
    shutil.copytree(WEB / 'vendor', OUT / 'assets' / 'vendor')

    # 2. 资源编译 + 链接，生成 R.java
    code = next_version()
    run(BT / 'aapt2.exe', 'compile', '--dir', AND / 'res', '-o', OUT / 'res.zip')
    (OUT / 'gen').mkdir()
    run(BT / 'aapt2.exe', 'link', '-o', OUT / 'base.apk', '-I', ANDROID_JAR,
        '--manifest', AND / 'AndroidManifest.xml', '--java', OUT / 'gen',
        '--min-sdk-version', '26', '--target-sdk-version', '35',
        '--version-code', str(code), '--version-name', f'1.{code}',
        '-A', OUT / 'assets', OUT / 'res.zip')

    # 3. Java -> class -> dex
    srcs = [str(p) for p in (AND / 'src').rglob('*.java')] + [str(p) for p in (OUT / 'gen').rglob('*.java')]
    (OUT / 'classes').mkdir()
    run(javac, '--release', '11', '-encoding', 'UTF-8', '-nowarn', '-classpath', ANDROID_JAR,
        '-d', OUT / 'classes', *srcs)
    classes = [str(p) for p in (OUT / 'classes').rglob('*.class')]
    run(java, '-cp', BT / 'lib' / 'd8.jar', 'com.android.tools.r8.D8', '--release', '--min-api', '26',
        '--lib', ANDROID_JAR, '--output', OUT, *classes)

    # 4. 把 dex 塞进 apk，对齐，签名
    with zipfile.ZipFile(OUT / 'base.apk', 'a') as z:
        z.write(OUT / 'classes.dex', 'classes.dex')
    run(BT / 'zipalign.exe', '-f', '-p', '4', OUT / 'base.apk', OUT / 'aligned.apk')
    if not KEYSTORE.exists():
        KEYSTORE.parent.mkdir(exist_ok=True)
        run(keytool, '-genkeypair', '-keystore', KEYSTORE, '-storepass', KS_PASS, '-keypass', KS_PASS,
            '-alias', 'beifa', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '36500',
            '-dname', 'CN=beifa, O=self, C=CN')
        print(f'已生成签名密钥 {KEYSTORE}（别删，删了以后只能卸载重装）')
    apk = ROOT / 'dist' / '北伐打卡.apk'
    run(java, '-jar', BT / 'lib' / 'apksigner.jar', 'sign', '--v4-signing-enabled', 'false', '--ks', KEYSTORE, '--ks-pass', 'pass:' + KS_PASS,
        '--out', apk, OUT / 'aligned.apk')
    run(java, '-jar', BT / 'lib' / 'apksigner.jar', 'verify', apk)
    shutil.rmtree(OUT, ignore_errors=True)
    print(f'已生成 {apk}（{apk.stat().st_size // 1024} KB，版本 1.{code}）')


if __name__ == '__main__':
    main()
