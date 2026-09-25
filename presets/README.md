# presets

Agent 预设声明。

0.1.7 起 preset 不再靠「`roots` 指向目录 + 注册表扫描」：每个 preset 是一条
`@deepseek-ai/dsh-agent-preset` 行，作为**独立 patch 文件**列在 `package.json` 的
`dsh.bundle.patch` 数组里。注册表（`agent-preset-registry`）只负责 `default` 选择，
不扫描目录、也不接受 preset 路径。

| 文件 | 职责 |
| --- | --- |
| `test-plan.patch.yml` | `test-plan` 预设声明：`config.id` / `name` / `description` / `order` / `plugins` |

`plugins` 即该 preset 的子插件行列表（agent-plane 组合）。本预设只挂 `persona`，
其余工具由 host 层 `dsh-test-plan-tool` 注册后继承。

把 `test-plan` 设为默认在 `cordis.patch.yml` 里做（覆盖 `agent-preset-registry` 的
`config.default`）。
