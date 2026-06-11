FROM node:20-alpine
WORKDIR /app
COPY services/operations/inventory/package.json .
RUN npm install --production
COPY services/operations/inventory/server.js .
COPY shared ./shared
EXPOSE 3400
CMD ["node", "server.js"]
