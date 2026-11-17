#!/bin/sh
set -eu
[ "$(id -u)" = 0 ] || { echo '请以 root 身份运行'; exit 1; }
: "${KOMARI_URL:?请先设置 KOMARI_URL，例如 https://monitor.example.com}"
if ! command -v python3 >/dev/null 2>&1 || ! python3 -c 'import ssl,urllib.request,json,fcntl' >/dev/null 2>&1; then
    if [ "${1:-}" = '--check' ]; then echo '需要 Python 3 才能检查安装'; exit 1; fi
    if command -v opkg >/dev/null 2>&1; then opkg update; opkg install python3 python3-urllib python3-ssl ca-bundle
    elif command -v apt-get >/dev/null 2>&1; then apt-get update; apt-get install -y python3 ca-certificates
    elif command -v apk >/dev/null 2>&1; then apk add python3 ca-certificates
    elif command -v dnf >/dev/null 2>&1; then dnf install -y python3 ca-certificates
    else echo '请先安装 Python 3 和 CA 证书'; exit 1; fi
fi
stage=$(mktemp -d)
trap 'rm -f "$stage/install.py"; rmdir "$stage"' EXIT
curl -fLsS --connect-timeout 15 --max-time 90 "${KOMARI_URL%/}/unlock/install.py" -o "$stage/install.py"
python3 "$stage/install.py" --url "$KOMARI_URL" "$@"
