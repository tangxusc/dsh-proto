# test

单测与端到端脚本，不参与插件发布。

| 文件 | 职责 |
| --- | --- |
| `*.test.ts` | 工具、提示词、预设、KV、鉴权等单元测试 |
| `fake-redis.ts` | 单测用假 Redis，不连真实实例 |
| `e2e.ts` | 不调 LLM：取数 → 读模版/JSON → 按序写章 → 落盘 |

```sh
npm test
PLAN_ID=<planId> npm run e2e
```
