FROM node:22-slim
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/stocklink.db TRUST_PROXY=1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.js seed.js ./
COPY lib ./lib
COPY routes ./routes
COPY public ./public
COPY seed ./seed
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME /data
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
