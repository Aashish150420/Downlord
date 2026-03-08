# Video Downloader - Docker image for Railway
FROM node:20-slim

# Install ffmpeg, Python, yt-dlp, and spotDL
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    && pip3 install yt-dlp spotdl --break-system-packages \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first for layer caching
COPY package*.json ./
RUN npm install --omit=dev

# Copy application
COPY . .

# Create downloads directory
RUN mkdir -p downloads

EXPOSE 3000

CMD ["node", "server/index.js"]
