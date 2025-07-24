FROM node:16-alpine

WORKDIR /app

COPY package.json ./

# Install only the specific packages you need
RUN npm install express sqlite3 cors body-parser

COPY . .

ENV PORT=3000
EXPOSE 3000

CMD ["node", "index.js"]
