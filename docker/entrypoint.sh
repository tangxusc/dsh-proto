#!/bin/sh
# 启动试验方案 Web UI。
# 不传 --host 0.0.0.0：dsh CLI 会拒绝。监听地址由 profile 的 webserver patch 设为 0.0.0.0。
set -eu

PORT="${PORT:-3080}"
DSH_BIN="/opt/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js"

if [ ! -f "$DSH_BIN" ]; then
  echo "entrypoint: missing $DSH_BIN" >&2
  exit 1
fi

if [ -z "${CHENGFEI_API_KEY:-}" ]; then
  echo "entrypoint: CHENGFEI_API_KEY 未设置，模型调用会失败。请 docker run -e CHENGFEI_API_KEY=..." >&2
fi

mkdir -p /data/dsh-output /data/dsh-plan-data /data/dsh-plan-state

if [ -n "${TRUSTED_HOSTS:-}" ]; then
  th=""
  for host in $TRUSTED_HOSTS; do
    th="$th --trusted-host $host"
  done
  # 有意按词拆开：每个 host 一个 --trusted-host
  # shellcheck disable=SC2086
  set -- $th "$@"
fi

exec node "$DSH_BIN" \
  --profile test-plan \
  --no-open \
  --port "$PORT" \
  "$@"
