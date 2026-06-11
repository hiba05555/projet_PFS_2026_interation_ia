FROM node:20-alpine
WORKDIR /app
COPY services/it/equipment/package.json .
RUN npm install --production
COPY services/it/equipment/server.js .
COPY shared ./shared
EXPOSE 3103
CMD ["node", "server.js"]
