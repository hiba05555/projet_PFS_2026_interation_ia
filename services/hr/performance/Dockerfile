FROM node:20-alpine
WORKDIR /app
COPY services/hr/performance/package.json .
RUN npm install --production
COPY services/hr/performance/server.js .
COPY shared ./shared
EXPOSE 3200
CMD ["node", "server.js"]
