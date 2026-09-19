# tools

模型可调用的三个工具，各一个文件，由 `src/index.ts` 注册。

| 文件 | 工具 | 职责 |
| --- | --- | --- |
| `get_test_plan_info.ts` | `get_test_plan_info` | 按 planId 取数，完整 JSON 写入 `dataDir`，结果只回摘要 |
| `read_static_doc.ts` | `read_static_doc` | 只读分页查阅静态资料、章节模版、方案 JSON |
| `write_chapter.ts` | `write_chapter` | 按公文顺序写入一章全文；全部写完落盘 HTML |

工具本身不规定各章写什么；章节内容以当前模版和方案数据为准。
