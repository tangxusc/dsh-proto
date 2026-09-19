# docker

离线镜像内部文件：预装 DSH、本插件，以及 web / tui 两套 profile，避免运行时 `dsh plugin add`。

| 路径 | 职责 |
| --- | --- |
| `dsh-package.json` | 镜像内 DSH 依赖清单 |
| `settings.yaml` | 模型等运行配置（不含 API Key） |
| `entrypoint.sh` | 按 `DSH_MODE`（或首参 `web`/`tui`）启动对应 profile |
| `profile/` | Web profile：`dsh-base` + `dsh-web-app` + 本插件 |
| `profile-tui/` | TUI profile：`dsh-base` + `dsh-tui` + 本插件 |

## 启动

根目录 `docker compose up --build` 起 Web + redis。TUI：

```sh
docker compose --profile tui run --rm dsh-tui
```

入口默认 `DSH_MODE=web`。TUI 时会设置 `DSH_TUI_PRESET=test-plan`。Web 不传 `--host 0.0.0.0`，监听地址由 web profile 的 `webserver` patch 绑到 `0.0.0.0`。
