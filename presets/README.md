# presets

Agent 预设声明。

0.1.7 起 preset 不再靠「`roots` 指向目录 + 注册表扫描」：每个 preset 是一条
`@deepseek-ai/dsh-agent-preset` 行，作为**独立 patch 文件**列在 `package.json` 的
`dsh.bundle.patch` 数组里。注册表（`agent-preset-registry`）只负责 `default` 选择，
不扫描目录、也不接受 preset 路径。

| 文件 | 职责 |
| --- | --- |
| `test-plan.patch.yml` | `test-plan` 预设声明：`config.id` / `name` / `description` / `order` / `plugins` |

`plugins` 即该 preset 的子插件行列表（**agent plane** 组合）。本预设挂三个：

| 插件 | 作用 |
| --- | --- |
| `persona` | 该 agent 的角色设定 |
| `test-plan-tool` | 章节生成工具（`read_static_doc` / `write_chapter`）+ 提示词段 `tool:test-plan-doc` |
| `test-plan-tool-filter` | 按 server 白名单挡掉多余的 MCP 工具 |

## 哪一行放 host 层、哪一行放 preset

三条判据：

1. **服务提供者 vs 消费者**：`ctx.provide` 的一方必须放 host 层 —— 放 preset 会变成
   **每会话一份实例**（redis 连接重复、webServer 路由重复注册）。纯消费者放哪都行。
2. **进程级 vs 会话级**：进程级的（HTTP 拒答策略、路由、连接池）放 host 层；
   会话级的（persona、工具裁剪、只对某个 agent 有意义的工具）放 preset。
3. **与谁同层会互相影响**：`mcp-test-plan`（注册 `mcp__test-plan__*`）与 `test-plan-tool-filter`
   **不能同层** —— restriction 只过滤「scope **继承来的**」工具，同层就过滤不到。

按这三条，本包的分工是：

| 行 | 层 | 理由 |
| --- | --- | --- |
| `redis-kv-store` | host | 服务提供者（`ctx.provide(extKvStore)`） |
| `internal-auth` | host | 进程级 HTTP 策略 |
| `mcp-test-plan` | host | 必须与 filter 分层，否则白名单过滤不到它注册的工具 |
| `persona` / `test-plan-tool` / `test-plan-tool-filter` | preset | 会话级；只对该 agent 有意义 |

## 哪些 surface 会消费 preset

| surface | 支持 preset？ |
| --- | --- |
| **web** | ✅ `agent-preset-registry` 行由 `dsh-web-app` 提供，`api-session-controller.composeAgent` 调 `mount` |
| **TUI** | ✅ 一等公民：TUI 包自带 `dsh-tui-agent-preset-registry` 行，另有 `/preset` 选择器 |
| headless / acp / sdk | ❌ 不消费 preset —— 它们的隔离靠 profile + patch 层 `disabled: true` |

⚠️ **TUI 的预设选择是「承重」的**：`test-plan-tool` 挂在 preset 里之后，**只有 `test-plan`
预设的会话才有 `read_static_doc` / `write_chapter`**。而 TUI 的选择优先级是：

```
DSH_TUI_PRESET（环境变量） > 持久化的 /preset 偏好（~/.dsh-tui/agent-preset.json） > 花名册默认
```

本机直接跑 TUI 时，若存在指向别的预设的持久化偏好、且没设 `DSH_TUI_PRESET`，**章节工具会消失**。
请设 `DSH_TUI_PRESET=test-plan`，或在 `/preset` 里选一次。Docker 路径已由 `entrypoint.sh` 设好。

把 `test-plan` 设为默认在 `cordis.patch.yml` 里做（覆盖 `agent-preset-registry` 的
`config.default`）。
