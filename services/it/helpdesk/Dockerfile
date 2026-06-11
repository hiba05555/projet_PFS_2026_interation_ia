FROM node:20-alpine
WORKDIR /app
COPY services/it/helpdesk/package.json .
RUN npm install --production
COPY services/it/helpdesk/server.js .
COPY shared ./shared
EXPOSE 3101
CMD ["node", "server.js"]
