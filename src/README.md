# src

业务插件源码。入口 `index.ts` 声明配置，注册工具与提示词；可选消费 `extKvStore`，拿不到则回退文件 sidecar。

| 文件 | 职责 |
| --- | --- |
| `index.ts` | 插件入口：Config、注册工具与提示词 |
| `chapters.ts` | 章节目录与公文顺序（cover → 01–11） |
| `prompt.ts` | 系统提示：取数 → 读模版与数据 → 按序写章 |
| `session-state.ts` | 按 session 隔离的写章进度 |
| `static-docs.ts` | 资料 / 模版 / 方案 JSON 的目录、分页与路径沙箱 |

`tools/` 是三个 model-facing 工具；`base_plugin/` 是与业务解耦的基础扩展。改源码后需 `npm run build`，运行时加载 `lib/`。
