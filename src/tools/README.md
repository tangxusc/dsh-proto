# tools

模型可调用的两个工具，各一个文件，由 `src/index.ts` 注册。

| 文件 | 工具 | 职责 |
| --- | --- | --- |
| `read_static_doc.ts` | `read_static_doc` | 只读分页查阅静态资料与章节模版 |
| `write_chapter.ts` | `write_chapter` | 带 `planId` 按公文顺序写入一章全文；全部写完落盘 HTML |

方案数据不在这里 —— 它由独立进程的 MCP server 以资源形式提供（见 `../mcp/`）。

`write_chapter` 的 `planId` 是显式入参（模型从资源 URI 取）：与 session 里记的不同会清空已写章节，
写 `cover` 也会清空（用于重新生成）。工具本身不规定各章写什么；章节内容以当前模版和方案数据为准。
