# Custom code-server with offline-baked extensions (ESLint, Prettier, GitLens).
# Build downloads .vsix from Open VSX once, then installs via --install-extension <local.vsix>
# into /opt/hacktraining/extensions so the runtime PVC on ~/.local/share/code-server
# (settings/state) does not hide the baked extensions.
# 4.129.x embeds VS Code ~1.129 — satisfies Prettier 12.x / GitLens (engines ^1.101.0).
FROM codercom/code-server:4.129.0

USER root
RUN mkdir -p /opt/hacktraining/extensions /tmp/vsix \
 && chown -R coder:coder /opt/hacktraining /tmp/vsix

USER coder
WORKDIR /tmp/vsix

# Pin versions for reproducible training images (not Open VSX "latest"/nightlies).
ARG ESLINT_VERSION=3.0.34
ARG PRETTIER_VERSION=12.4.0
ARG GITLENS_VERSION=2026.7.230551

ENV EXTENSIONS_DIR=/opt/hacktraining/extensions

RUN set -eux; \
  curl -fsSL -o eslint.vsix \
    "https://open-vsx.org/api/dbaeumer/vscode-eslint/${ESLINT_VERSION}/file/dbaeumer.vscode-eslint-${ESLINT_VERSION}.vsix"; \
  curl -fsSL -o prettier.vsix \
    "https://open-vsx.org/api/esbenp/prettier-vscode/${PRETTIER_VERSION}/file/esbenp.prettier-vscode-${PRETTIER_VERSION}.vsix"; \
  curl -fsSL -o gitlens.vsix \
    "https://open-vsx.org/api/eamodio/gitlens/${GITLENS_VERSION}/file/eamodio.gitlens-${GITLENS_VERSION}.vsix"; \
  code-server --extensions-dir "$EXTENSIONS_DIR" --install-extension /tmp/vsix/eslint.vsix; \
  code-server --extensions-dir "$EXTENSIONS_DIR" --install-extension /tmp/vsix/prettier.vsix; \
  code-server --extensions-dir "$EXTENSIONS_DIR" --install-extension /tmp/vsix/gitlens.vsix; \
  code-server --extensions-dir "$EXTENSIONS_DIR" --list-extensions; \
  rm -rf /tmp/vsix

# Runtime must pass --extensions-dir (see deploy/k8s/team-template/code-server.yaml).
# Base image ENTRYPOINT/CMD unchanged.
