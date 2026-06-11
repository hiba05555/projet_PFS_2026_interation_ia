FROM node:20-alpine
WORKDIR /app
COPY services/operations/projects/package.json .
RUN npm install --production
COPY services/operations/projects/server.js .
COPY shared ./shared
EXPOSE 3400
CMD ["node", "server.js"]
