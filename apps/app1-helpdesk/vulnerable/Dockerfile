# Vulnerable image: root user, floating :latest, no hardening (V1.8)
FROM node:latest

WORKDIR /app

COPY packages/shared /packages/shared
COPY apps/app1-helpdesk/vulnerable/package.json /app/package.json
COPY apps/app1-helpdesk/src /app/src
COPY apps/app1-helpdesk/views /app/views
COPY apps/app1-helpdesk/public /app/public
COPY apps/app1-helpdesk/tsconfig.json /app/tsconfig.json
COPY tsconfig.base.json /tsconfig.base.json

RUN mkdir -p /flags \
  && echo 'TRN{c0ffee1234567890abcdef1234567890}' > /flags/app1.flag

# Install from vulnerable package.json (ejs@3.1.6)
WORKDIR /packages/shared
RUN npm install --omit=dev && npm run build || true
WORKDIR /app
RUN npm install --omit=dev

ENV NODE_ENV=development \
    EXPOSE_DEBUG=true \
    JWT_SECRET=secret \
    FLAG_FILE_PATH=/flags/app1.flag \
    SERVE_STATIC_ROOT=. \
    SECURITY_HEADERS=off \
    CORS_ORIGIN=* \
    CORS_CREDENTIALS=true \
    SEED_ADMIN_PASSWORD=admin123 \
    PORT=3000

EXPOSE 3000
# No USER directive — runs as root (V1.8)
CMD ["npx", "tsx", "src/index.ts"]
