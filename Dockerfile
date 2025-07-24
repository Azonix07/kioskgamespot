FROM node:16

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json files
COPY package*.json ./

# Install dependencies with increased memory allocation
RUN node --max_old_space_size=4096 /usr/local/bin/npm install

# Copy the rest of your application code
COPY . .

# Set environment variables
ENV PORT=3000
ENV NODE_ENV=production

# Expose the port your app runs on
EXPOSE 3000

# Command to run your application
CMD ["node", "index.js"]
