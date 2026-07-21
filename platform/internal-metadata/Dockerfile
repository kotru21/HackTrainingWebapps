# Internal metadata SSRF target — pinned, non-root
FROM node:22.16.0-bookworm-slim
RUN groupadd -r app && useradd -r -g app app
WORKDIR /app
COPY platform/internal-metadata/server.mjs /app/server.mjs
COPY platform/internal-metadata/package.json /app/package.json
USER app
ENV PORT=3099
# INTENTIONALLY WEAK — training only
ENV METADATA_PLANT_TOKEN=metadata-plant-token
EXPOSE 3099
CMD ["node", "server.mjs"]
