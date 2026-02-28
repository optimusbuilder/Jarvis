FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig*.json ./
COPY src ./src

RUN npm run build

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080
CMD ["node", "dist/index.js"]
