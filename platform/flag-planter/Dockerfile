# Flag planter — pinned, non-root
FROM node:22.16.0-bookworm-slim AS build

WORKDIR /app
COPY packages/shared /packages/shared
COPY tsconfig.base.json /tsconfig.base.json
COPY platform/flag-planter /platform/flag-planter
COPY platform/scoreboard/config.yaml /platform/scoreboard/config.yaml
COPY platform/scoreboard/config.compose.yaml /platform/scoreboard/config.compose.yaml

WORKDIR /packages/shared
RUN npm install && npm run build

WORKDIR /platform/flag-planter
RUN node -e "const p=require('./package.json'); p.dependencies['@hacktraining/shared']='file:/packages/shared'; require('fs').writeFileSync('package.json', JSON.stringify(p,null,2));" \
 && npm install \
 && npm run build \
 && npm prune --omit=dev

FROM node:22.16.0-bookworm-slim
RUN groupadd -r app && useradd -r -g app app
COPY --from=build /packages/shared /packages/shared
COPY --from=build /platform/flag-planter /platform/flag-planter
COPY --from=build /platform/scoreboard /platform/scoreboard
RUN chown -R app:app /packages /platform
USER app
WORKDIR /platform/flag-planter
ENV NODE_ENV=production HEALTH_PORT=3021
EXPOSE 3021
CMD ["node", "dist/index.js"]
