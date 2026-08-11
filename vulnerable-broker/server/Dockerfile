FROM node:20-alpine

WORKDIR /app

COPY package.json .
RUN npm install

COPY src ./src
COPY public ./public

CMD ["npm", "start"]