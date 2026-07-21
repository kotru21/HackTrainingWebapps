# Scoreboard — pinned, non-root
FROM node:22.16.0-bookworm-slim AS build

WORKDIR /app
COPY packages/shared /packages/shared
COPY tsconfig.base.json /tsconfig.base.json
COPY platform/scoreboard /platform/scoreboard

WORKDIR /packages/shared
RUN npm install && npm run build

WORKDIR /platform/scoreboard
RUN node -e "const p=require('./package.json'); p.dependencies['@hacktraining/shared']='file:/packages/shared'; require('fs').writeFileSync('package.json', JSON.stringify(p,null,2));" \
 && npm install \
 && npm run build \
 && npm prune --omit=dev

FROM node:22.16.0-bookworm-slim
RUN groupadd -r app && useradd -r -g app app
COPY --from=build /packages/shared /packages/shared
COPY --from=build /platform/scoreboard /platform/scoreboard
# Ensure compose config exists even without bind mount
COPY platform/scoreboard/config.compose.yaml /platform/scoreboard/config.compose.yaml
COPY platform/scoreboard/config.yaml /platform/scoreboard/config.yaml
RUN chown -R app:app /packages /platform
USER app
WORKDIR /platform/scoreboard
ENV NODE_ENV=production PORT=3020 SCOREBOARD_CONFIG=/platform/scoreboard/config.compose.yaml
EXPOSE 3020
CMD ["node", "dist/index.js"]
