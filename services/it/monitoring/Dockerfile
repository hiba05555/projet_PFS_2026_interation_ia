FROM node:20-alpine
WORKDIR /app
COPY services/it/monitoring/package.json .
RUN npm install --production
COPY services/it/monitoring/server.js .
COPY shared ./shared
EXPOSE 3104
CMD ["node", "server.js"]
