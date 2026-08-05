# Build stage — compile the web app
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

# Runtime stage — server + built SPA only
FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=80 DATA_DIR=/data
WORKDIR /app
COPY package.json ./
COPY server/ server/
COPY --from=build /app/web/dist web/dist
# Reinstall server deps for this platform (sharp/better-sqlite3 native binaries)
RUN cd server && npm install --omit=dev --no-audit --no-fund
VOLUME /data
EXPOSE 80
CMD ["node", "server/src/index.js"]
