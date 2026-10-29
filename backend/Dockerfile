# Build from the repository root so the migrations are included:
#   docker build -f backend/Dockerfile -t resume-analyzer-backend .
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    MIGRATIONS_DIR=/app/migrations \
    UPLOAD_DIR=/data/uploads
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY database/migrations ./migrations
# Private resume files live on a volume mounted at /data/uploads, never in the image.
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 5000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
# Run `node dist/scripts/migrate.js` (or `npm run migrate`) once per deployment before starting.
CMD ["node", "dist/server.js"]
