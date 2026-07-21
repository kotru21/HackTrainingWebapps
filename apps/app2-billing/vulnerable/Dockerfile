# Vulnerable app2-billing — intentionally soft image (training)
# Build context: repository root
FROM node:22-bookworm

WORKDIR /app

COPY packages/shared /packages/shared
COPY tsconfig.base.json /tsconfig.base.json
COPY apps/app2-billing/shared /apps/app2-billing/shared
COPY apps/app2-billing/vulnerable /apps/app2-billing/vulnerable

WORKDIR /packages/shared
RUN npm install && npm run build

WORKDIR /apps/app2-billing/vulnerable
RUN node -e "const p=require('./package.json'); p.dependencies['@hacktraining/shared']='file:/packages/shared'; require('fs').writeFileSync('package.json', JSON.stringify(p,null,2));" \
 && npm install \
 && npm run build

ENV NODE_ENV=development \
    PORT=3011 \
    TEAM=a \
    JWT_SECRET=billing-secret \
    ADMIN_FLAG=TRN{a2044444444444444444444444444444}

EXPOSE 3011
# No USER — soft image for training contrast with reference
CMD ["node", "dist/index.js"]
