FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 DB_PATH=/app/data/shop.sqlite
COPY package.json package-lock.json ./
COPY src ./src
COPY public ./public
RUN mkdir -p /app/data /app/public/uploads && chown -R node:node /app
USER node
EXPOSE 3000
VOLUME ["/app/data", "/app/public/uploads"]
CMD ["node", "src/server.js"]
