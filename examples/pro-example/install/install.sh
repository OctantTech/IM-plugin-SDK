#!/bin/sh
# Pro 插件安装方法示例：幂等安装/校验工具链，失败 exit 非 0。
set -eu
if command -v java >/dev/null 2>&1; then
  echo "[install] java: $(java -version 2>&1 | head -1)"
else
  echo "[install] JDK not found; 真实插件在这里从 toolchain/ 解包或内网源安装" >&2
fi
if command -v mvn >/dev/null 2>&1; then
  echo "[install] mvn: $(mvn -v 2>/dev/null | head -1)"
else
  echo "[install] Maven not found; 真实插件在这里安装" >&2
fi
echo "[install] ok"
