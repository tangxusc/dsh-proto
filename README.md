# dsh-test-plan-tool

DeepSeek Harness 组合包：经**独立进程的 MCP server** 按需读取试验方案，查阅章节模版，再按公文顺序逐章生成 HTML。

## 两个独立进程

MCP server 与 dsh **各自独立启动**，两者之间唯一的耦合点就是那个 URL：

```sh
# 进程 A：MCP server（内置固定 fixture，开发期不联网）
node lib/mcp/server.js --port 8096        # 打印 MCP_HTTP_PORT= 与 MCP_ENDPOINT=

# 进程 B：dsh（默认连 http://127.0.0.1:8096/mcp）
dsh --profile <profile> --no-open
```

- 地址可配置：dsh 侧用 `MCP_SERVER_URL` 覆盖默认 URL；server 侧用 `--port` / `MCP_HTTP_PORT` / `--host`。
- server 没起也不阻断 dsh 启动（`failOnStartupError: false`），模型仍能用只读资料与写章工具。

## 模型看到什么

方案数据**不是工具**，而是 MCP **资源** —— 由 `dsh-base` 自带的 `mcp-resources` 把资源工具交给模型：

| 资源 | 职责 |
| --- | --- |
| `plan://plans` | 本服务已知的方案清单 |
| `plan://plans/{planId}` | **方案目录**：basicInfo ＋ 功能点/试验信息清单（含各自体量）。先读它 |
| `plan://plans/{planId}/points/{index}` | 单个功能点的正文切片 |
| `plan://plans/{planId}/tests` | 试验信息正文 |
| `plan://plans/{planId}/raw` | 未投影的原始 JSON（兜底，正常不该读） |

外加本插件注册的两个工具：

| 工具 | 职责 |
| --- | --- |
| `read_static_doc` | 只读分页查阅静态资料与章节模版 |
| `write_chapter` | 带 `planId` 按序写入各章全文；写完拼成一份 HTML |

服务端做**投影**：原始 JSON 里约 84% 是写作无关的元数据，投影后按功能点切片，单片约 1 KB
（实测原始 34 KB → 单切片 1.4 KB）。另有 3 个静态工具（`server_health` / `list_supported_tenants` /
`echo`）用于演示**工具白名单**：`tool-filter` 插件挂在 agent 预设作用域，按 `allow` 把多余的挡掉。

源码在 `src/`，编译到 `lib/`。`package.json` 声明 `dsh.bundle`，由 `cordis.patch.yml` 与
`presets/test-plan.patch.yml` 插入插件行。

## 目录

| 路径 | 职责 |
| --- | --- |
| `src/` | 业务插件源码 |
| `src/mcp/` | **独立进程的 MCP server**：fixture、投影、资源、工具、入口 |
| `src/base_plugin/` | 与业务解耦的基础扩展（Redis KV、内网鉴权、工具白名单过滤） |
| `resources/` | 静态资料、章节模版与 MCP fixture |
| `presets/` | Agent 预设声明 |
| `test/` | 单测与 e2e |
| `docker/` | 镜像内预置的 web / tui profile |
| `dsh-output/` | 生成文档落盘 |
| `dsh-plan-state/` | 写章进度文件回退 |

各子目录有独立 README。

## 安装 profile

`dsh` 一般不全局安装，用 npx。版本须与 `package.json` 的 peer 对齐（当前 `0.1.7-rc.2`）。`<profile>` 换成实际 profile 名。

```sh
DSH='npx -y @deepseek-ai/dsh@0.1.7-rc.2'

cd /path/to/dsh-test-plan-tool
npm install                                          # 编译 src/ → lib/；dsh 加载的是 lib/
$DSH plugin --profile <profile> add .                # 把本组合包装进 profile
$DSH plugin --profile <profile> add @deepseek-ai/dsh-web-app@0.1.7-rc.2   # Web UI，必装
```

`dsh-base` 不含 Web 应用。不装 `dsh-web-app` 时，`--profile <profile>` 会挂起且无输出。

装完后 profile 的 `dsh.profile.bundles` 应为：

```json
["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-test-plan-tool"]
```

层序后应用者胜：本包会插入工具行，并把默认 Agent 预设改成 `test-plan`。

## 运行 profile

```sh
$DSH --profile <profile> --no-open
```

`--profile` 后面不要再跟 `web`（`web` 是内置 `--profile web` 的别名，两者互斥）。本 profile 已装 `dsh-web-app`，启动的就是 Web UI。

成功后终端会打印带 token 的地址（不带 token 访问返回 401）：

```
dsh web: http://127.0.0.1:3080/?token=<token>
```

核对插件与预设是否生效：

```sh
$DSH --profile <profile> --dump-config | grep -A 6 dsh-test-plan-tool
$DSH --profile <profile> --dump-config | grep -A 6 'id: agent-preset-registry'
$DSH --profile <profile> --dump-config | grep -A 8 'id: preset-test-plan'
```

应看到本包配置、`default: test-plan`，以及 `preset-test-plan` 那条 `@deepseek-ai/dsh-agent-preset` 声明。已开始的旧会话仍沿用创建时的预设，需新建会话才会切到 `test-plan`。

## 测试

```sh
npm test              # 类型检查 + 全部单测 + MCP e2e（离线，自带起停 server 进程）
npm run e2e:mcp       # 只跑 MCP e2e
npm run mcp:serve     # 手工起 MCP server（需先 npm run build）
```

## Docker

镜像预置两套 profile，不要在容器里跑 `dsh plugin add`。最终镜像是 `node:22-bookworm-slim` 多阶段构建。入口由 `DSH_MODE` 或容器首参选择：

| 模式 | profile | 组合包 | 启动 |
| --- | --- | --- | --- |
| web（默认） | `web` | `dsh-base` + `dsh-web-app` + 本插件 | 监听 `3080` |
| tui | `tui` | `dsh-base` + `dsh-tui` + 本插件 | 需要 TTY |

模型调用需要 `CHENGFEI_API_KEY`。写章进度默认写 compose 里的 redis（`REDIS_URL=redis://redis:6379`）。

### Web

```sh
export CHENGFEI_API_KEY=...
docker compose up --build
```

终端会打印带 token 的地址。不带 token 访问返回 401；浏览器打开打印出的 URL，或用 cookie 跟随后续请求。

```
dsh web: http://127.0.0.1:3080/?token=<token>
```

`GET /api/redis-kv-store?key=<sessionId>` 查写章状态；请求头 `Content-Type: text/event-stream` 时走 SSE。

### TUI

需要交互终端。compose 的 `tui` profile 不会随 `docker compose up` 一起起：

```sh
docker compose --profile tui run --rm dsh-tui
```

或直接跑镜像：

```sh
docker run --platform linux/amd64 -it \
  -e DSH_MODE=tui \
  -e CHENGFEI_API_KEY=... \
  dsh-test-plan-tool:0.1.0
# 等价：容器首参 tui
docker run --platform linux/amd64 -it -e CHENGFEI_API_KEY=... dsh-test-plan-tool:0.1.0 tui
```

TUI 默认预设 `test-plan`（`DSH_TUI_PRESET`，注册表行 `dsh-tui-agent-preset-registry`；web 侧是 `agent-preset-registry`）。`dsh-tui` 需 `0.11.0` 及以上才支持 0.1.7 的注册表机制。
