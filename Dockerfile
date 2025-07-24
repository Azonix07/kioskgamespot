FROM node:16-alpine

# Install build dependencies required by some npm modules
RUN apk add --no-cache python3 make g++ gcc

WORKDIR /app

# Copy only package.json first
COPY package.json ./

# Install with minimal dependencies
RUN npm install --production --no-optional

# Copy the rest of your application
COPY . .

ENV PORT=3000
EXPOSE 3000

CMD ["node", "index.js"]
