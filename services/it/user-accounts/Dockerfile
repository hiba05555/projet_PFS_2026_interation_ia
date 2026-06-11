FROM node:20-alpine
WORKDIR /app
COPY services/it/user-accounts/package.json .
RUN npm install --production
COPY services/it/user-accounts/server.js .
COPY shared ./shared
EXPOSE 3102
CMD ["node", "server.js"]
