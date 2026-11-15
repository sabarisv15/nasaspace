# ARCNAVE on a Hugging Face Docker Space (free CPU basic: 2 vCPU, 16 GB RAM, no card). See docs/deploy/DEPLOY-HF-CLOUDFLARE.md.
# deploy/hf/pack-hf.ps1 copies this file to the root of the Space, next to the app and the PC's cache/ folder.
# The cache is part of the image: every field opened on the PC opens at once here, and survives restarts and rebuilds.
# Fields first opened on the Space are kept on its disk until the next restart (Cloudflare's edge keeps them longer).
FROM node:24-slim
WORKDIR /app
# the "node" user is uid 1000, the user Hugging Face runs Spaces as; it owns the app and the cache so the server can add to it
COPY --chown=node:node . .
ENV NODE_ENV=production PORT=7860 SKYSHIFT_PUBLIC=1 SKYSHIFT_S3=1 SKYSHIFT_S3_PARALLEL=8 \
    SKYSHIFT_CACHE_DIR=/app/cache SKYSHIFT_CACHE_MB=30000
RUN mkdir -p /app/cache && chown -R node:node /app/cache
USER node
EXPOSE 7860
CMD ["node", "server.js"]
