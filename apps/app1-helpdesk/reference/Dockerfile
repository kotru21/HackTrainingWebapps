# Reference app1 — non-root, pinned tag (V1.8 fix)
# Build context: repository root
FROM node:22.16.0-bookworm-slim AS build

WORKDIR /app

COPY packages/shared /packages/shared
COPY tsconfig.base.json /tsconfig.base.json
COPY apps/app1-helpdesk/package.json /app/package.json
COPY apps/app1-helpdesk/tsconfig.json /app/tsconfig.json
COPY apps/app1-helpdesk/src /app/src
COPY apps/app1-helpdesk/views /app/views
COPY apps/app1-helpdesk/public /app/public

# Overlay: patched ejs@3.1.10
COPY apps/app1-helpdesk/reference/package.json /tmp/overlay.json
RUN node -e "const a=require('./package.json'); const o=require('/tmp/overlay.json'); a.dependencies=o.dependencies; a.dependencies['@hacktraining/shared']='file:/packages/shared'; require('fs').writeFileSync('package.json', JSON.stringify(a,null,2));"

WORKDIR /packages/shared
RUN npm install && npm run build

WORKDIR /app
RUN npm install && npm run build && npm prune --omit=dev

FROM node:22.16.0-bookworm-slim

RUN groupadd -r app && useradd -r -g app app

WORKDIR /app
COPY --from=build /packages/shared /packages/shared
COPY --from=build /app /app

RUN mkdir -p /flags \
  && echo 'TRN{c0ffee1234567890abcdef1234567890}' > /flags/app1.flag \
  && chown -R app:app /app /flags /packages

USER app

# Reference models good practice: strong secrets baked as safe defaults
# (real deploys inject via k8s Secret; fail-closed refuses weak values in production).
ENV NODE_ENV=production \
    EXPOSE_DEBUG=false \
    JWT_SECRET=helpdesk-ref-3d5f60a1b2c3d4e5f60718a9c8f2c1e9 \
    SEED_ADMIN_PASSWORD=RefAdm-9f3c2e1a7b8d4e6f \
    FLAG_FILE_PATH=/flags/app1.flag \
    SERVE_STATIC_ROOT=./public \
    SECURITY_HEADERS=on \
    CORS_ORIGIN=https://helpdesk.local \
    CORS_CREDENTIALS=true \
    PORT=3000 \
    TEAM=b

EXPOSE 3000
CMD ["node", "dist/index.js"]
