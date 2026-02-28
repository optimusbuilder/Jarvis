FROM node:20-slim
WORKDIR /app

# Copy only package files first to leverage Docker cache
COPY package*.json ./
RUN npm install

# Now copy the rest of the code
COPY . . 
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/index.js"]
