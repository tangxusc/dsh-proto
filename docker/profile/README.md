# profile

镜像内预置的 Web profile（启动名为 `web`，并保留 `test-plan` 别名）：bundles 为 `dsh-base` + `dsh-web-app` + 本插件。

TUI 见 `docker/profile-tui/`。

| 文件 | 职责 |
| --- | --- |
| `package.json` | profile 依赖与 bundle 顺序 |
| `cordis.yml` | 空入口列表，实际由各 bundle 的 patch 组成 |
| `cordis.patch.yml` | 容器部署补丁（如 webserver 绑 `0.0.0.0`） |
