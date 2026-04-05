FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY server/ ./server/
COPY public/ ./public/
EXPOSE 3000
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
VOLUME ["/app/data"]
CMD ["node", "server/index.js"]
