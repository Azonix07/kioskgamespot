FROM node:18-slim

# Install SQLite dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    sqlite3 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files and install dependencies first (better caching)
COPY package*.json ./
RUN npm install --no-optional --no-audit --progress=false

# Copy the rest of the application
COPY . .

# Set up volume directory for database
RUN mkdir -p /data && chmod 777 /data

# Define environment variable
ENV PORT=3000
ENV NODE_ENV=production

# Expose the port the app runs on
EXPOSE 3000

# Command to run the application
CMD ["node", "index.js"]
