FROM node:20-alpine
WORKDIR /app
COPY services/finance/expenses/package.json .
RUN npm install --production
COPY services/finance/expenses/server.js .
COPY shared ./shared
EXPOSE 3300
CMD ["node", "server.js"]
