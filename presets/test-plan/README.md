# test-plan

试验方案文档 Agent 预设：不挂 bash / fs / web / subagent 等编码工具，只继承本插件的三个工具。

| 文件 | 职责 |
| --- | --- |
| `preset.yml` | 预设元信息（显示名、说明） |
| `agent.cordis.yml` | 会话 persona；故意不重新挂载 coding 工具 |
