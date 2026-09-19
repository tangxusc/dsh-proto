# dsh-test-plan-tool

DeepSeek Harness 组合包：按 `planId` 取试验方案，查阅资料与章节模版，再按公文顺序逐章生成 HTML。

模型只看到三个工具：

| 工具 | 职责 |
| --- | --- |
| `get_test_plan_info` | 取数落盘，结果只回摘要与路径 |
| `read_static_doc` | 只读分页查阅资料、模版、方案 JSON |
| `write_chapter` | 按序写入各章全文；写完拼成一份 HTML |

源码在 `src/`，编译到 `lib/`。`package.json` 声明 `dsh.bundle`，由 `cordis.patch.yml` 插入插件行。

## 目录

| 路径 | 职责 |
| --- | --- |
| `src/` | 业务插件与基础扩展源码 |
| `resources/` | 静态资料与章节模版 |
| `presets/` | Web Agent 预设 |
| `test/` | 单测与 e2e |
| `docker/` | 镜像内预置的 web / tui profile |
| `dsh-output/` | 生成文档落盘 |
| `dsh-plan-data/` | 取数 JSON 落盘 |
| `dsh-plan-state/` | 写章进度文件回退 |

各子目录有独立 README。

## 安装 profile

`dsh` 一般不全局安装，用 npx。版本须与 `package.json` 的 peer 对齐（当前 `0.1.5-rc.2`）。`<profile>` 换成实际 profile 名。

```sh
DSH='npx -y @deepseek-ai/dsh@0.1.5-rc.2'

cd /path/to/dsh-test-plan-tool
npm install                                          # 编译 src/ → lib/；dsh 加载的是 lib/
$DSH plugin --profile <profile> add .                # 把本组合包装进 profile
$DSH plugin --profile <profile> add @deepseek-ai/dsh-web-app@0.1.5-rc.2   # Web UI，必装
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
$DSH --profile <profile> --dump-config | grep -A 12 'id: agent-presets'
```

应看到本包配置，以及 `default: test-plan`。已开始的旧会话仍沿用创建时的预设，需新建会话才会切到 `test-plan`。

## 测试

```sh
npm test
PLAN_ID=<planId> npm run e2e
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

TUI 默认预设 `test-plan`（`DSH_TUI_PRESET`，profile 行 `dsh-tui-agent-presets`）。dump 时可能看到插件层 `agent-presets` 找不到——那是 Web 的行 id，TUI 不受影响。
