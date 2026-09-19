#!/bin/sh
# 按 DSH_MODE 或第一个参数启动 web / tui profile。
# web 不传 --host 0.0.0.0：dsh CLI 会拒绝。监听地址由 web profile 的 webserver patch 设为 0.0.0.0。
set -eu

PORT="${PORT:-3080}"
MODE="${DSH_MODE:-web}"
DSH_BIN="/opt/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js"

if [ ! -f "$DSH_BIN" ]; then
  echo "entrypoint: missing $DSH_BIN" >&2
  exit 1
fi

case "${1:-}" in
  web|tui)
    MODE=$1
    shift
    ;;
esac

case "$MODE" in
  web|tui) ;;
  *)
    echo "entrypoint: 未知模式 '$MODE'，应为 web 或 tui（环境变量 DSH_MODE 或首参）" >&2
    exit 1
    ;;
esac

if [ -z "${CHENGFEI_API_KEY:-}" ]; then
  echo "entrypoint: CHENGFEI_API_KEY 未设置，模型调用会失败。请 docker run -e CHENGFEI_API_KEY=..." >&2
fi

mkdir -p /data/dsh-output /data/dsh-plan-data /data/dsh-plan-state

if [ "$MODE" = "tui" ]; then
  if [ ! -t 0 ]; then
    echo "entrypoint: tui 需要交互终端，请 docker run -it 或 compose stdin_open/tty" >&2
  fi
  # TUI 默认走本包 test-plan 预设；可用 DSH_TUI_PRESET 覆盖。
  export DSH_TUI_PRESET="${DSH_TUI_PRESET:-test-plan}"
  exec node "$DSH_BIN" --profile tui "$@"
fi

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
  --profile web \
  --no-open \
  --port "$PORT" \
  "$@"
