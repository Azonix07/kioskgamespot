FROM node:16-alpine

# Set working directory to the backend folder
WORKDIR /app/backend

# Copy package.json from backend folder
COPY backend/package.json ./

# Install dependencies
RUN npm install --production --no-optional

# Copy the rest of your application code
# This copies everything to the Docker image
COPY backend/ ./

# Set environment variables
ENV PORT=3000
ENV NODE_ENV=production

# Expose the port
EXPOSE 3000

# Command to run the application
CMD ["node", "index.js"]
