FROM node:20-alpine
WORKDIR /app
COPY services/it/licenses/package.json .
RUN npm install --production
COPY services/it/licenses/server.js .
COPY shared ./shared
EXPOSE 3105
CMD ["node", "server.js"]
