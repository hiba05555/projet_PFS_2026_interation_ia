FROM node:20-alpine
WORKDIR /app
COPY services/hr/recruitment/package.json .
RUN npm install --production
COPY services/hr/recruitment/server.js .
COPY shared ./shared
EXPOSE 3200
CMD ["node", "server.js"]
