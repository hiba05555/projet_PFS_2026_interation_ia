FROM node:20-alpine
WORKDIR /app
COPY services/auth/auth/package.json .
RUN npm install --production
COPY services/auth/auth/server.js .
COPY shared ./shared
EXPOSE 3001
CMD ["node", "server.js"]
