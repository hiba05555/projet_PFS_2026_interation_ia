FROM node:20-alpine
WORKDIR /app
COPY services/hr/leave-requests/package.json .
RUN npm install --production
COPY services/hr/leave-requests/server.js .
COPY shared ./shared
EXPOSE 3200
CMD ["node", "server.js"]
