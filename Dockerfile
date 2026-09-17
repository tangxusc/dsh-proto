# linux/amd64 离线可运行镜像：内置 Node、DSH 0.1.5-rc.2、本插件与 Web UI。
# 构建：docker buildx build --platform linux/amd64 -t dsh-test-plan-tool:0.1.0 --load .
# 运行：docker run --platform linux/amd64 -p 3080:3080 -e CHENGFEI_API_KEY=... dsh-test-plan-tool:0.1.0
#
# 不要用 dsh plugin add：会在 koffi 原生构建上挂死。profile 由本文件直接铺好。
# 不要传 --host 0.0.0.0：CLI 会拒绝。容器外访问靠 profile 里 webserver.host=0.0.0.0。
FROM node:22-bookworm

ARG NPM_REGISTRY=https://registry.npmmirror.com

ENV NODE_ENV=production \
    DSH_HOME=/opt/dsh-home \
    PORT=3080 \
    npm_config_update_notifier=false

WORKDIR /opt/dsh

# 构建原生可选依赖（koffi 无预编译时需要）；sharp/node-pty 一般走 prebuild。
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY docker/dsh-package.json package.json
RUN npm config set registry "$NPM_REGISTRY" \
    && npm install --omit=dev --no-audit --no-fund \
    && npm cache clean --force

# 插件源码（不含 darwin 的 node_modules）
WORKDIR /opt/plugin
COPY package.json cordis.patch.yml index.js ./
COPY tools/ ./tools/
COPY src/ ./src/
COPY templates/ ./templates/
COPY presets/ ./presets/
COPY doc/ ./doc/

# 预置 DSH_HOME：profile + 模型配置。不写入 API Key。
COPY docker/settings.yaml /opt/dsh-home/settings.yaml
COPY docker/profile/ /opt/dsh-home/profiles/test-plan/
# 必须把插件做成 profile/node_modules 下的真实目录：Node ESM 按文件真实路径向上找
# node_modules，启动时 heal 会把 DSH 依赖链到 $DSH_HOME/profiles/node_modules。
# 若只做 /opt/plugin 的符号链接，解析不到 @deepseek-ai/schemastery。
RUN mkdir -p /opt/dsh-home/profiles/test-plan/node_modules \
    && cp -a /opt/plugin /opt/dsh-home/profiles/test-plan/node_modules/dsh-test-plan-tool \
    && mkdir -p /data/dsh-output /data/dsh-plan-data /data/dsh-plan-state \
    && groupadd --system dsh \
    && useradd --system --gid dsh --home-dir /data --shell /usr/sbin/nologin dsh \
    && chown -R dsh:dsh /opt/dsh-home /data

COPY docker/entrypoint.sh /opt/entrypoint.sh
RUN chmod +x /opt/entrypoint.sh

USER dsh
WORKDIR /data
EXPOSE 3080

ENTRYPOINT ["/opt/entrypoint.sh"]
