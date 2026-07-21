# Reference image: non-root, pinned tag, hardened (V1.8 fix)
FROM node:22.16.0-bookworm-slim

RUN groupadd -r app && useradd -r -g app app

WORKDIR /app

COPY packages/shared /packages/shared
COPY apps/app1-helpdesk/reference/package.json /app/package.json
COPY apps/app1-helpdesk/src /app/src
COPY apps/app1-helpdesk/views /app/views
COPY apps/app1-helpdesk/public /app/public
COPY apps/app1-helpdesk/tsconfig.json /app/tsconfig.json
COPY tsconfig.base.json /tsconfig.base.json

RUN mkdir -p /flags \
  && echo 'TRN{c0ffee1234567890abcdef1234567890}' > /flags/app1.flag \
  && chown -R app:app /app /flags /packages

WORKDIR /packages/shared
RUN npm install --omit=dev && npm run build || true
WORKDIR /app
RUN npm install --omit=dev

USER app

ENV NODE_ENV=production \
    EXPOSE_DEBUG=false \
    FLAG_FILE_PATH=/flags/app1.flag \
    SERVE_STATIC_ROOT=./public \
    SECURITY_HEADERS=on \
    CORS_ORIGIN=https://helpdesk.local \
    CORS_CREDENTIALS=true \
    PORT=3000

EXPOSE 3000
CMD ["npx", "tsx", "src/index.ts"]
