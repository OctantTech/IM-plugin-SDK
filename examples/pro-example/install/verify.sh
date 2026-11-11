#!/bin/sh
# 健康检查：安装成功判据。
set -eu
command -v java >/dev/null 2>&1 || { echo "java missing" >&2; exit 1; }
echo "[verify] toolchain ready"
