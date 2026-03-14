# Use official Puppeteer image — Chrome is pre-installed, no downloads needed
FROM ghcr.io/puppeteer/puppeteer:21.11.0

# Set working directory
WORKDIR /app

# Run as root to install deps
USER root

# Copy package files
COPY package.json ./

# Install only app dependencies (NOT puppeteer — already in image)
RUN npm install --omit=dev

# Copy app files
COPY . .

# Create session directory
RUN mkdir -p .wa-session && chmod 777 .wa-session

# Switch back to non-root user (required by puppeteer image)
USER pptruser

# Expose port
EXPOSE 3000

# Start
CMD ["node", "app.js"]
