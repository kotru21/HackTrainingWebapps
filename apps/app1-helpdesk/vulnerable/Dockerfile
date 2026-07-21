# Vulnerable app1 — root, floating tag, no hardening (V1.8 training vuln)
# Build context: repository root
FROM node:latest

WORKDIR /app

COPY packages/shared /packages/shared
COPY tsconfig.base.json /tsconfig.base.json
COPY apps/app1-helpdesk/package.json /app/package.json
COPY apps/app1-helpdesk/tsconfig.json /app/tsconfig.json
COPY apps/app1-helpdesk/src /app/src
COPY apps/app1-helpdesk/views /app/views
COPY apps/app1-helpdesk/public /app/public

# Overlay: pin vulnerable ejs@3.1.6 (CVE-2022-29078)
COPY apps/app1-helpdesk/vulnerable/package.json /tmp/overlay.json
RUN node -e "const a=require('./package.json'); const o=require('/tmp/overlay.json'); a.dependencies=o.dependencies; a.dependencies['@hacktraining/shared']='file:/packages/shared'; require('fs').writeFileSync('package.json', JSON.stringify(a,null,2));"

WORKDIR /packages/shared
RUN npm install && npm run build

WORKDIR /app
RUN npm install && npm run build

RUN mkdir -p /flags \
  && echo 'TRN{c0ffee1234567890abcdef1234567890}' > /flags/app1.flag

ENV NODE_ENV=development \
    EXPOSE_DEBUG=true \
    JWT_SECRET=secret \
    FLAG_FILE_PATH=/flags/app1.flag \
    SERVE_STATIC_ROOT=. \
    SECURITY_HEADERS=off \
    CORS_ORIGIN=* \
    CORS_CREDENTIALS=true \
    SEED_ADMIN_PASSWORD=admin123 \
    PORT=3000 \
    TEAM=a

EXPOSE 3000
# No USER — runs as root (V1.8)
CMD ["node", "dist/index.js"]
