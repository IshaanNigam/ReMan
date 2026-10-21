FROM node:20-alpine

# Install build tools required for better-sqlite3 native compilation
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

RUN mkdir -p /app/data

EXPOSE 3000

CMD ["npm", "start"]