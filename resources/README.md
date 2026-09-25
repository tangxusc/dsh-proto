# resources

随插件打包的只读资源。

| 目录 | 职责 | 谁读它 |
| --- | --- | --- |
| `doc/` | 静态参考资料（`.md` / `.txt`） | 模型经 `read_static_doc` 按需分页读 |
| `templates/` | 按版本存放的章节 HTML 模版 | 同上 |
| `mcp-fixture/` | **MCP server 的内置固定方案数据**（`plan.json`） | 只有 `src/mcp/` 那个独立进程读 |

`mcp-fixture/plan.json` 取自真实 55 环境响应，已裁剪（3 个功能点 + 2 条试验信息）并脱敏
（文件名字段、`id` / `planId` 等按**字段名**精确替换，避免误伤 MIME 类型）。
保留完整字段结构，这样投影收益与切片体量都能按真实比例验证。
