FROM node:20-alpine
WORKDIR /app
COPY services/api-gateway/package.json .
RUN npm install --production
COPY services/api-gateway/server.js .
COPY shared ./shared
EXPOSE 3000
CMD ["node", "server.js"]
