# Multi-stage Dockerfile for ieCloudbase Cloud Platform (Web + API + Static UI)
FROM node:22-alpine AS builder
WORKDIR /app

# Build @n8n/sandbox-client SDK first (needed by playground)
COPY sdk/package.json sdk/package-lock.json* ./sdk/
COPY sdk ./sdk
RUN cd sdk && npm install --ignore-scripts && npm run build || true

# Build playground (ieCloudbase UI)
COPY playground/package.json playground/package-lock.json* ./playground/
COPY playground ./playground
RUN cd playground && npm install --ignore-scripts && npm run build

# Install reseller-api production dependencies
COPY reseller-api/package.json reseller-api/package-lock.json* ./reseller-api/
RUN cd reseller-api && npm install --omit=dev

# Production runtime image
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000

COPY --from=builder /app/reseller-api/node_modules ./reseller-api/node_modules
COPY reseller-api/package.json reseller-api/server.mjs ./reseller-api/
COPY --from=builder /app/playground/dist ./playground/dist

EXPOSE 4000
CMD ["node", "reseller-api/server.mjs"]
