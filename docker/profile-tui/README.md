# profile-tui

镜像内预置的 TUI profile：bundles 为 `dsh-base` + `dsh-tui` + 本插件。

无 Web UI；需要交互终端（`docker run -it` 或 compose `stdin_open`/`tty`）。
`cordis.patch.yml` 把 `dsh-tui-agent-presets` 默认设为 `test-plan`。
