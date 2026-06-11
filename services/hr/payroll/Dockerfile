FROM node:20-alpine
WORKDIR /app
COPY services/hr/payroll/package.json .
RUN npm install --production
COPY services/hr/payroll/server.js .
COPY shared ./shared
EXPOSE 3200
CMD ["node", "server.js"]
