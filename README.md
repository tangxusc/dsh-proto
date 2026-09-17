# dsh-test-plan-tool

DeepSeek Harness（`dsh`）插件：提供三个 model-facing 工具，完成「取试验方案 → 按需查阅资料与章节模版 → 逐章生成文档」：

| 工具 | 作用 |
| --- | --- |
| `get_test_plan_info` | 按 `planId` 取数，完整 JSON 写入 `dataDir`，工具结果只回摘要与路径 |
| `read_static_doc` | 只读查阅 `resources/doc/` 静态资料、`resources/templates/dynamic-v1/` 章节模版与 `dataDir` 中的方案 JSON |
| `write_chapter` | 按公文顺序写入各章全文（`content` 原样保存）；全部写完落盘为一份 HTML |

这是一个**组合包（bundle）**：`package.json` 声明 `dsh.bundle`，配 `cordis.patch.yml` 提供一层
patch，通过 `dsh plugin` 安装进 profile。下文命令中的 `<profile>` 是 profile 名，按需替换
（示例用 `demo`）；`<repo>` 是本目录所在路径。

## 工具

### `get_test_plan_info`

| 项 | 值 |
| --- | --- |
| 参数 | `planId`（string，**必填**） |
| tenantId | 由部署配置提供，**不作为工具参数**；默认 `1` |
| 返回 | `{ planId, tenantId, path, filePath, lines, bytes, topKeys, basic, adoptedPoints }`，**不含**完整 `data` |
| 落盘 | 把接口 `data` 美化写成 `{dataDir}/{planId}.json`（非法字符会从文件名剔除） |
| 请求 | `POST {url}`，体为 `{"tenantId":<配置值>,"planId":"<参数>"}` |

完整方案往往很大，直接放进工具结果会被 harness 截断。因此本工具只回摘要和相对路径；模型用
`read_static_doc` 传入返回的 `path`，按 `offset`/`limit` 分页读 JSON。取数成功后方案身份记入
插件会话状态，并清空已写章节；随后必须从封面起按序调用 `write_chapter`。

### `write_chapter`

| 项 | 值 |
| --- | --- |
| 参数 | `chapterNo`（`cover` → `01`–`11`，必须是当前下一章）、`content`（该章全文） |
| 返回 | `{ chapterNo, done, next, missing, documentPath }` |
| 内容 | **原样保存**，不改写、不套模版、不规定这一章写什么 |
| 顺序 | 必须按 `cover → 01 → … → 11` 写入，跳章或乱序会失败 |
| 进度 | 按 `exec.agent.id`（session）隔离，写入 `{stateDir}/{sessionId}.json` |
| 落盘 | 12 章全部写完时，按同一公文顺序拼成一份 HTML 写到 `{outDir}/{planId}.html` |

写某一章前用 `read_static_doc` 读当前模版；模版会改，以读到的文件为准。

### `read_static_doc`

静态参考资料放在插件的 `resources/doc/`（可用 `docDir` 覆盖），章节模版在 `resources/templates/dynamic-v1/`，
取数 JSON 放在 `dataDir`（默认 `dsh-plan-data/`），**都不写入系统提示全文**。
`.md`/`.txt` 走静态目录，`.html` 走模版目录，`.json` 走取数目录。

| 项 | 值 |
| --- | --- |
| 参数 | `path`（相对路径，可省略）、`offset`（起始行，从 1 计）、`limit`（本页行数） |
| 列出 | 不传 `path` 或传空串，返回目录（文件名、kind、行数），不含正文 |
| 读取 | 传入 `path`，默认每次 80 行、最多 200 行；`hasMore` 时用 `nextOffset` 继续 |
| 权限 | **只读**；路径必须落在对应根目录内，拒绝 `..` 与绝对路径 |

当前自带静态资料：`业务术语解释.md`、`特设POC-本体平台接.md`。
章节模版：`cover.html`、`01.html` … `11.html`，写该章前读取；内容会更新。

## 目录

```
dsh-test-plan-tool/
├── package.json          # 声明 dsh.bundle，指向下面的 patch 层；main 为 lib/index.js
├── tsconfig.json         # 源码编译到 lib/（与官方 DSH 包布局一致）
├── cordis.patch.yml      # 组合包层：插入插件行、默认配置，并把 Web 默认预设改成 test-plan
├── src/index.ts          # 插件入口：Config、注册工具与提示词
├── src/chapters.ts       # 章节目录与公文顺序（cover → 01–11）
├── src/session-state.ts  # 按 session 读写写章进度 sidecar
├── src/prompt.ts         # 取数落盘 → 读当前模版与方案数据 → 按序写章
├── src/static-docs.ts    # 静态文档、章节模版与取数 JSON 的目录、分页读取与路径沙箱
├── src/tools/get_test_plan_info.ts  # get_test_plan_info 工具
├── src/tools/read_static_doc.ts     # read_static_doc 工具（只读）
├── src/tools/write_chapter.ts       # write_chapter 工具
├── resources/doc/            # 静态参考资料（只读，模型按需分页读取）
├── resources/templates/dynamic-v1/  # 12 个章节模版（cover + 01–11），以当前文件为准，程序不渲染
├── presets/test-plan/    # Web agent 预设：不挂 bash/fs/web，只继承本插件工具
├── test/                 # 单测与 e2e（不参与插件发布）
└── README.md
```

## 章节模版

`resources/templates/dynamic-v1/<章节>.html` 是各章的当前模版，**会更新**。模型写某一章前用
`read_static_doc` 读对应文件（`cover.html` / `01.html` …），按读到的内容组织该章全文，
交给 `write_chapter` 的 `content`。程序不读取模版做填充，也不规定各章必须写什么。

## 内部服务无 Token 调用 /api

默认 Web UI 需要浏览器 cookie 鉴权。本插件在 `apply()` 时自动 patch `connection.requestRejection`：

- 对 `loopback`（`127.0.0.1`）来源，或你通过 `--trusted-host` / `TRUSTED_HOSTS` 声明的内部来源，直接放行 401，**无需传任何 token**。
- `403`（Host/Origin 不信任、跨站）仍拒绝，不会把接口暴露给外网。

因此 Java/Python 等内部服务调用时：

1. 确保 dsh 监听地址对内部网络可达（Docker 默认已在 `docker/profile/cordis.patch.yml` 把 webserver 绑到 `0.0.0.0`）。
2. 把服务所在主机/容器地址或域名加到 `TRUSTED_HOSTS`：
   - 本机直连：不需要额外配置，`127.0.0.1` 已放行。
   - Docker 跨容器/宿主机调用：在 `docker-compose.yml` 的 `TRUSTED_HOSTS` 里加来源 hostname，例如 `TRUSTED_HOSTS=host.docker.internal`，并保证请求 `Host` 头与该值一致。

> ⚠️ 该 patch 的生效前提是请求已经通过 `dsh-client-connection` 的 Host/Origin 信任栅栏；它不是把接口完全公开给互联网。若部署在不可信网络，请改用固定 token 或 VPN，不要依赖此 patch。

## 安装

`dsh` 通常没有全局安装，用 `npx` 调用即可：

```sh
DSH='npx -y @deepseek-ai/dsh@0.1.5-rc.2'    # 之后统一用 $DSH
```

> 版本必须与 `package.json` 的 peer 对齐：`@deepseek-ai/dsh@0.1.5-rc.2` 对应
> `dsh-tools ^0.1.5-rc.2`、`cordis ^4.0.2`、`schemastery ^3.18.2`。
> `dsh` 已全局安装时，可把 `$DSH` 直接换成 `dsh`。

### 1. 确认 registry 可用

`dsh plugin` 会把参数转发给 profile 目录内的 pnpm，因此受你的 npm registry 影响。
**`registry.npm.taobao.org` 已停服**，用它会导致 `ERR_PNPM_FETCH_404`：

```sh
npm config get registry
# 应为 https://registry.npmjs.org，否则：
npm config set registry https://registry.npmjs.org
```

### 2. 安装插件

```sh
cd <repo>
npm install    # 编译 src/ → lib/；dsh 加载的是 lib/index.js
$DSH plugin --profile <profile> add ./dsh-test-plan-tool
```

首次使用会初始化 profile（以 `@deepseek-ai/dsh-base` 为第一个组合包），把本目录 link 进来，
并因 `package.json` 声明了 `dsh.bundle` 而把包名追加进 `dsh.profile.bundles`。

### 3. 让 profile 带上 Web UI

**关键点**：`dsh-base` 只是底座，**不含 Web 应用**。只装本插件后启动 `--profile <profile>`
会挂起且无输出。Web UI 是另一个组合包 `@deepseek-ai/dsh-web-app`，需一并装进**同一个 profile**：

```sh
$DSH plugin --profile <profile> add @deepseek-ai/dsh-web-app@0.1.5-rc.2
```

装完 `$DSH_HOME/profiles/<profile>/package.json` 的 `dsh.profile.bundles` 应形如：

```json
"bundles": [
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-web-app",
  "dsh-test-plan-tool"
]
```

顺序即层序（后应用者胜）：`dsh-web-app` 覆盖 `dsh-base` 的行；本插件 insert 自己的工具行，
并把 `agent-presets` 的默认预设改成 `test-plan`（见下文「Agent 预设」）。

### 4. 启动

```sh
$DSH --profile <profile> --no-open
```

`--profile <profile>` 后面**不要再跟 `web`**。`web` 是内置 `--profile web` 的别名，两者互斥——
一起写会报 `error: too many arguments. Expected 0 arguments but got 1: web.`。
本 profile 装了 `dsh-web-app`，`--profile <profile>` 启动的就是 Web UI。

启动成功后终端会打印带 token 的地址（不带 token 访问返回 401）：

```
dsh web: http://127.0.0.1:3080/?token=<token>
```

### 5. 验证插件层生效

```sh
$DSH --profile <profile> --dump-config | grep -A 6 dsh-test-plan-tool
```

应看到 `# == dsh-test-plan-tool` 一段及配置值。

启动后在 Web UI 中提问，例如「获取 planId 为 `ba88e937c2844ed0e9975fc8a3ddcf26` 的试验方案信息」，
模型会调用 `get_test_plan_info` 并返回方案数据。新会话默认走 `test-plan` 预设，不应再出现
`bash` / `read` / `web_search` 等编码工具。

核对预设是否进名单：

```sh
$DSH --profile <profile> --dump-config | grep -A 12 'id: agent-presets'
```

应看到 `default: test-plan`，以及指向本包 `presets/` 的 `roots`。已开始的旧会话仍沿用创建时的预设，
需要**新建会话**才会切到 `test-plan`。

## Agent 预设

`dsh-web-app` 在 host 层关掉 `tool-bash` / `tool-fs` / `tool-web` 等，再按会话从 preset 重新挂载。
因此不能靠 profile 的 `cordis.patch.yml` 去关 `tool-bash`——对 Web 会话无效。本组合包提供
`presets/test-plan/`：

| 项 | 值 |
| --- | --- |
| 目录名 / id | `test-plan` |
| 显示名 | 试验方案 |
| 模型可见工具 | host 层的 `get_test_plan_info`、`read_static_doc`、`write_chapter` |
| 不挂载 | bash/pwsh、read/write/edit、glob/grep、web_search/web_fetch、subagent、workflow、todo、skill 等 |

内置 `standard` 仍可在新会话选择器里选（编码 Agent）。若要改回默认 `standard`，在自己 profile 的
`cordis.patch.yml` 里按 `id: agent-presets` 覆盖，并**重述**整份 config（patch 不是深度合并）。

## 配置

`cordis.patch.yml` 给出默认值；用户可在自己 profile 的 `cordis.patch.yml` 中按 `id` 覆盖。
**patch 会替换目标行的整个 `config`，不是深度合并**——要重述需要的每个键：

```yaml
- id: test-plan-tool
  config:
    tenantId: 2                                    # 覆盖默认 1
    url: 'http://other-host/admin-api/third/protocol/test-plan/getAiTestPlanData'
    timeoutMs: 60000
    outDir: '/data/plan-docs'                      # 覆盖默认 dsh-output
    docDir: '/data/plan-static-docs'               # 覆盖默认插件自带 resources/doc
    dataDir: '/data/plan-json'                     # 覆盖默认 dsh-plan-data
    stateDir: '/data/plan-state'                    # 覆盖默认 dsh-plan-state
```

| 键 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `tenantId` | number | `1` | 租户 id，随每次请求发送 |
| `url` | string | 55 环境 admin-api 地址 | 试验方案数据接口 |
| `timeoutMs` | number | `30000` | 请求超时；与调用方的取消信号取其一 |
| `outDir` | string | `dsh-output` | 生成文档的输出目录；相对路径以 dsh 进程工作目录为基准 |
| `docDir` | string | 空（使用插件 `resources/doc/`） | 静态参考文档根目录；相对路径以进程工作目录为基准 |
| `dataDir` | string | `dsh-plan-data` | `get_test_plan_info` 完整 JSON 落盘目录 |
| `stateDir` | string | `dsh-plan-state` | 按 session 隔离的写章进度 sidecar |

配置在插件加载时经 Schemastery schema 校验，非法值会**加载失败并报错**，而不是静默兜底。

## 踩坑记录

以下都是实际安装时踩到并确认过的坑，按遇到顺序排列。

### `dsh: command not found`

`dsh` 没有全局安装。用 `npx -y @deepseek-ai/dsh@<版本>` 调用，或用 `npm i -g` 全局安装。

### `web` 与 `--profile <name>` 不能同时用

`web` 是内置 `--profile web` 的**别名**，不是一个可以叠加在别的 profile 上的子命令：

- `dsh --profile demo web` → `error: too many arguments. Expected 0 arguments but got 1: web.`
- `dsh web --profile demo` → `error: web takes none of parent --profile, ...`

正确写法是二选一：启动自定义 profile 用 `dsh --profile <profile>`；启动内置 web profile 用
`dsh web`。**要让自定义 profile 跑 Web UI，靠的是给它装 `dsh-web-app`，而不是加 `web`。**

### `--profile <name>` 启动后挂起、无输出

该 profile 里没有可交互的应用层——通常只装了 `dsh-base`。见上文第 3 步，把
`@deepseek-ai/dsh-web-app` 装进同一个 profile。

### `dsh plugin add` 长时间不返回（koffi 原生构建）

`@deepseek-ai/dsh-web-app` 的传递依赖 `koffi`（`@deepseek-ai/dsh-host-directory-picker-native`
用的 FFI 库）需要原生构建。表现与处理：

- **症状**：`dsh plugin ... add` 卡住不返回。此时进程 CPU 为 0%、无编译子进程，
  `pnpm install` 单独跑却是秒完（`Already up to date`）——说明卡的不是安装，而是收尾步骤。
- **先在 profile 的 `pnpm-workspace.yaml` 中授权构建**（pnpm ≥10 默认拒绝执行依赖的构建脚本）：
  ```yaml
  allowBuilds:
    koffi: true
  ```
- **若授权后仍卡**：该环境可能无法编译原生模块（`cnoke.cjs` 静默退出、无 `build/*.node` 产物）。
  此时依赖其实已装入 `node_modules`，`dsh plugin` 只是在最后一步挂死。可手动把
  `"@deepseek-ai/dsh-web-app": "<版本>"` 加进 `dependencies`、把包名补进 `dsh.profile.bundles`，
  然后直接启动。
- **影响范围**：koffi 缺失只影响 Web UI 的「选择目录」按钮，**不影响 agent 对话与本工具**。
  已验证：koffi 无构建产物时 Web UI 仍能正常启动并监听端口。

### `ERR_PNPM_FETCH_404` / registry 已停服

见上文第 1 步。`registry.npm.taobao.org` 已停服，改用 `https://registry.npmjs.org`。
改全局前建议备份 `~/.npmrc`。

## 本地验证

```sh
npm install          # 装依赖并 `tsc` 编译到 lib/（package.json 的 prepare）
npm test             # 类型检查 + 含预设约束在内的单测
```

单测覆盖：`get_test_plan_info` 的参数 schema、请求体与 URL、信封拆解（`code` 非 0、缺 `data`、
HTTP 4xx/5xx）、`planId` 非空、Config 默认值与覆盖；章节目录与 `write_chapter` 的按序写入、
乱序拒绝、空 content 拒绝、未写完不落盘、重新取数清空、content 原样落盘、按 session 隔离与 sidecar 续写；
`get_test_plan_info` 把完整 JSON 写入 `dataDir`、工具结果不含 `data`；
`read_static_doc` 的目录/分页/路径沙箱（含方案 JSON 与章节模版）；以及 `test-plan`
预设不挂 coding 工具、`agent-presets` 默认指向该预设。

### 端到端

不调用 LLM，用真实方案数据构造各章 HTML，验证「取数落盘 → 分页读 JSON/模版 → 原样写入 → 落盘」：

```sh
PLAN_ID="62324f55920065cf56a88b8e132e88c2" npm run e2e
```

产出写在 `dsh-output/<planId>.html`，方案 JSON 写在 `dsh-plan-data/<planId>.json`。
脚本会校验取数未把完整 `data` 放进工具结果、可只读模版与 JSON，以及各章 content 按序原样落盘。

## 开发要点（写同类工具插件时的坑）

### value schema DSL 的限制

`output.schema` 用的是 dsh 自己的 value schema DSL（`ValueSchemaSpec`），**不是标准 JSON Schema**：

- **不支持根级 `required` 数组**。必填是在属性上写 `required: true`：
  ```js
  { type: 'object', additionalProperties: true,
    properties: { planId: { type: 'string', required: true } } }
  ```
  写成 `{ type:'object', required:['planId'], ... }` 会抛 `UNSUPPORTED_SCHEMA`。
- **object 节点必须显式声明 `additionalProperties`（布尔值）**，否则报
  `additionalProperties must be explicitly true or false`。
- 支持的关键字子集：`type` / `oneOf` / `properties` / `required` / `additionalProperties` /
  `items` / `enum` / `const` 加注释键。

### 树外包必须用真实 semver

源码 checkout 内 `@deepseek-ai/cordis` 写作 `workspace:^`（解析为 vendored 源码），但**树外包**
必须写真实版本：`@deepseek-ai/cordis@^4.0.2`、`@deepseek-ai/dsh-tools@^0.1.5-rc.2`。
照抄 `workspace:^` 在 `npm install` 时会解析失败。

### 源码是 TypeScript，运行时加载编译产物

本组合包按官方 DSH 包布局：源码在 `src/**/*.ts`，相对导入带 `.ts` 后缀，`tsc` 编译到 `lib/`。
`package.json` 的 `main` 指向 `lib/index.js`，`dsh plugin add` 加载的是编译后的 JS，不是 `.ts`。
改源码后需要重新 `npm run build`（`npm install` 的 `prepare` 也会编译）。
官方教程里直接指向 `.ts` 文件，那是在 Harness 仓库内用它自己的 TS 加载器；树外包要先编译。

