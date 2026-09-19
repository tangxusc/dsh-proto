# linux/amd64 离线可运行镜像：内置 Node、DSH 0.1.5-rc.2、本插件，以及 web / tui 两套 profile。
# 构建：docker buildx build --platform linux/amd64 -t dsh-test-plan-tool:0.1.0 --load .
# Web： docker run --platform linux/amd64 -p 3080:3080 -e CHENGFEI_API_KEY=... dsh-test-plan-tool:0.1.0
# TUI： docker run --platform linux/amd64 -it -e DSH_MODE=tui -e CHENGFEI_API_KEY=... dsh-test-plan-tool:0.1.0
#
# 不要用 dsh plugin add：会在 koffi 原生构建上挂死。profile 由本文件直接铺好。
# 不要传 --host 0.0.0.0：CLI 会拒绝。容器外访问靠 web profile 里 webserver.host=0.0.0.0。
#
# 多阶段 + bookworm-slim：编译工具、源码、非 linux-x64 原生预编译不进最终镜像。
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS build
ARG NPM_REGISTRY=https://registry.npmmirror.com
ENV NODE_ENV=production \
    npm_config_update_notifier=false

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/dsh
COPY docker/dsh-package.json package.json
RUN npm config set registry "$NPM_REGISTRY" \
    && npm install --omit=dev --no-audit --no-fund \
    && npm cache clean --force

# 插件：开发依赖只在本阶段，产物不含 src/ 与 TypeScript。
WORKDIR /opt/plugin
COPY package.json package-lock.json tsconfig.json cordis.patch.yml ./
COPY src/ ./src/
COPY resources/ ./resources/
COPY presets/ ./presets/
RUN npm config set registry "$NPM_REGISTRY" \
    && NODE_ENV=development npm install --no-audit --no-fund \
    && npm run build \
    && rm -rf node_modules src tsconfig.json package-lock.json \
    && NODE_ENV=production npm install --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force

# TUI 树外组合包。先装再拷插件，避免 npm prune 删掉未声明的 dsh-test-plan-tool。
WORKDIR /opt/tui-nm
COPY docker/profile-tui/package.json ./package.json
RUN npm config set registry "$NPM_REGISTRY" \
    && npm install --omit=dev --legacy-peer-deps --no-audit --no-fund \
    && npm cache clean --force

# 丢掉运行时用不到的 sourcemap 与其它平台的 native 预编译。
RUN find /opt/dsh/node_modules /opt/tui-nm/node_modules -type f -name '*.map' -delete \
    && rm -rf \
         /opt/dsh/node_modules/node-pty/prebuilds/win32-x64 \
         /opt/dsh/node_modules/node-pty/prebuilds/win32-arm64 \
         /opt/dsh/node_modules/node-pty/prebuilds/darwin-arm64 \
         /opt/dsh/node_modules/node-pty/prebuilds/darwin-x64 \
         /opt/dsh/node_modules/node-pty/prebuilds/linux-arm64 \
         /opt/dsh/node_modules/@img/sharp-wasm32 \
         /opt/tui-nm/node_modules/@img/sharp-wasm32

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    DSH_HOME=/opt/dsh-home \
    PORT=3080 \
    DSH_MODE=web \
    npm_config_update_notifier=false

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system dsh \
    && useradd --system --gid dsh --home-dir /data --no-log-init --shell /usr/sbin/nologin dsh \
    && mkdir -p /data/dsh-output /data/dsh-plan-data /data/dsh-plan-state \
                /opt/dsh-home/profiles/web/node_modules \
                /opt/dsh-home/profiles/tui/node_modules \
                /opt/dsh-home/profiles/node_modules \
    && chown -R dsh:dsh /data

COPY --from=build --chown=dsh:dsh /opt/dsh /opt/dsh
COPY --chown=dsh:dsh docker/settings.yaml /opt/dsh-home/settings.yaml
COPY --chown=dsh:dsh docker/profile/ /opt/dsh-home/profiles/web/
COPY --chown=dsh:dsh docker/profile-tui/ /opt/dsh-home/profiles/tui/
COPY --from=build --chown=dsh:dsh /opt/tui-nm/node_modules /opt/dsh-home/profiles/tui/node_modules
# 插件只放一份：真实路径在 profiles/node_modules，heal 与 ESM 向上解析都能找到。
COPY --from=build --chown=dsh:dsh /opt/plugin /opt/dsh-home/profiles/node_modules/dsh-test-plan-tool
COPY docker/entrypoint.sh /opt/entrypoint.sh

RUN chmod +x /opt/entrypoint.sh \
    && ln -sfn ../../node_modules/dsh-test-plan-tool /opt/dsh-home/profiles/web/node_modules/dsh-test-plan-tool \
    && ln -sfn ../../node_modules/dsh-test-plan-tool /opt/dsh-home/profiles/tui/node_modules/dsh-test-plan-tool \
    && ln -sfn web /opt/dsh-home/profiles/test-plan \
    && chown dsh:dsh /opt/dsh-home /opt/dsh-home/profiles \
         /opt/dsh-home/profiles/node_modules \
         /opt/dsh-home/profiles/web /opt/dsh-home/profiles/tui \
         /opt/dsh-home/profiles/web/node_modules /opt/dsh-home/profiles/tui/node_modules \
    && chown -h dsh:dsh \
         /opt/dsh-home/profiles/web/node_modules/dsh-test-plan-tool \
         /opt/dsh-home/profiles/tui/node_modules/dsh-test-plan-tool \
         /opt/dsh-home/profiles/test-plan

USER dsh
WORKDIR /data
EXPOSE 3080

ENTRYPOINT ["/opt/entrypoint.sh"]
