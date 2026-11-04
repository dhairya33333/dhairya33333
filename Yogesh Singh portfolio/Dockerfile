# Container image for Railway (or any Docker host). Node 22+ is required for the built-in SQLite; ffmpeg makes films and images.
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .

# Everything the app stores (database, uploads, films) lives under /data: mount a persistent volume there.
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000
EXPOSE 3000

# Runs as root on purpose: Railway volumes are mounted root-owned. First start creates the admin from ADMIN_* variables if none exists.
CMD ["sh", "-c", "node scripts/bootstrap-admin.js && exec node server/index.js"]
