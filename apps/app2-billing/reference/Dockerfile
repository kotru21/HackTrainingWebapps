# Reference app2-billing — non-root, pinned tag
# Build context: repository root
FROM node:22.16.0-bookworm-slim AS build

WORKDIR /app

COPY packages/shared /packages/shared
COPY tsconfig.base.json /tsconfig.base.json
COPY apps/app2-billing/shared /apps/app2-billing/shared
COPY apps/app2-billing/reference /apps/app2-billing/reference

WORKDIR /packages/shared
RUN npm install && npm run build

WORKDIR /apps/app2-billing/reference
RUN node -e "const p=require('./package.json'); p.dependencies['@hacktraining/shared']='file:/packages/shared'; require('fs').writeFileSync('package.json', JSON.stringify(p,null,2));" \
 && npm install \
 && npm run build \
 && npm prune --omit=dev

FROM node:22.16.0-bookworm-slim

RUN groupadd -r app && useradd -r -g app app

COPY --from=build /packages/shared /packages/shared
COPY --from=build /apps/app2-billing /apps/app2-billing

RUN chown -R app:app /apps /packages
USER app

WORKDIR /apps/app2-billing/reference

# Reference models good practice: strong JWT secret (real deploys inject via Secret).
ENV NODE_ENV=production \
    PORT=3012 \
    TEAM=b \
    JWT_SECRET=billing-ref-8f2c1e9a7b3d5f60a1b2c3d4e5f60718a9c

EXPOSE 3012
CMD ["node", "dist/index.js"]
