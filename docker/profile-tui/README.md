# profile-tui

镜像内预置的 TUI profile：bundles 为 `dsh-base` + `dsh-tui` + 本插件。

无 Web UI；需要交互终端（`docker run -it` 或 compose `stdin_open`/`tty`）。
`cordis.patch.yml` 把 `dsh-tui-agent-preset-registry` 默认设为 `test-plan`（0.1.7 起的注册表行 id；web 侧是 `agent-preset-registry`）。

## `compatibility.json` —— 为什么必须有这个文件

**没有它，TUI 在容器里根本起不来。**

`@deepseek-harness-tui/dsh-tui@0.11.0` 的 peer 精确要求 `0.1.7-rc.1`：

```
peerDependencies {
  "@deepseek-ai/dsh-agent-preset-registry": "0.1.7-rc.1",
  "@deepseek-ai/dsh-ptc-runtime-node":       "0.1.7-rc.1"
}
```

而本镜像装的是 dsh `0.1.7-rc.2`。dsh 有版本兼容守卫，遇到不匹配会**整个跳过该 bundle**：

```
dsh: skipping profile bundle "@deepseek-harness-tui/dsh-tui": ... is incompatible with dsh 0.1.7-rc.2
dsh: warning: 1 entry did not activate
preset-test-plan (@deepseek-ai/dsh-agent-preset): pending (waiting for service: agentPresets)
```

后果是连锁的：TUI 不启动 → `agentPresets` 服务不出现 → **本包的 preset 永远停在 pending**。

### 为什么是「接受风险」而不是升级

registry 上 `dsh-tui` 的最新版**就是 0.11.0**，没有支持 rc.2 的版本可升。
但 0.11.0 的代码里**多处显式处理 rc.2**（"rc.2 presets do not carry this command"、
"The package subpath does not exist on rc.2"），说明这个 peer pin 偏保守。

**已实测**：grant 豁免后 TUI 在 rc.2 上完全正常 —— 会话建得起来、`composedPreset = test-plan`、
章节工具可见、`tool-filter` 生效（见 `verify/tui_probe.js`）。

### 怎么重新生成

dsh 自己写入的是同一份文件：

```sh
dsh plugin --profile tui allow-version @deepseek-harness-tui/dsh-tui@0.11.0 \
  --dsh-version 0.1.7-rc.2 --accept-risk
# 结果落在 <profile>/compatibility.json
```

**升级 dsh 时**：dsh 版本一变，这条豁免就失效（它只对精确的 package+DSH 版本对生效），
必须重新生成 —— 并重跑一次 TUI 验证，别只改文件。

### 怎么验证

```sh
docker run -t --rm -e CHENGFEI_API_KEY=... \
  -v "$PWD/verify:/tmp/verify:ro" -v /tmp/tui-verify:/out \
  --entrypoint sh dsh-test-plan-tool:0.1.0 -c '
    node /opt/dsh-home/profiles/node_modules/dsh-test-plan-tool/lib/mcp/server.js --port 8096 >/tmp/mcp.log 2>&1 &
    sleep 3
    exec /opt/entrypoint.sh tui --patch /tmp/verify/tui-probe.patch.yml'
# 探针结果同时写 stdout 与 /tmp/tui-verify/result.txt；exit 0 = PASS
```

探针**不自己建 agent** —— 它等 TUI 建出会话，然后读**那个**会话的可见工具，
所以验证的是 TUI 自己的预设选择与 mount 路径。
