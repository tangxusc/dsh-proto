run:
	npx -y @deepseek-ai/dsh@0.1.5-rc.2 --profile demo

docker:
 # Web（默认）
  docker compose up --build
  # TUI（需要 TTY）
  docker compose --profile tui run --rm dsh-tui
  # 或
  docker run -it -e DSH_MODE=tui -e CHENGFEI_API_KEY=... dsh-test-plan-tool:0.1.0
  # 或容器首参
  docker run -it ... dsh-test-plan-tool:0.1.0 tui