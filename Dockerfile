# Multi-stage production image: the build must pass the real application checks.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run lint && npm run typecheck && npm test && npm run build

# The Nexus runtime uses Node built-ins; neither npm nor source tests are
# needed inside the running image.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PRO_CODE_HOST=0.0.0.0 \
    PRO_CODE_PORT=8787 \
    PRO_CODE_WORKSPACE_DIR=/workspace \
    PRO_CODE_RUNTIME_DIR=/data \
    PRO_CODE_AUTOMATION_ENABLED=true
RUN mkdir -p /workspace /data && chown -R node:node /workspace /data
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/automatic-runtime.mjs"]
