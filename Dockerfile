FROM node:18-slim

# Installerar nödvändiga C++-motorer och FFmpeg för Discords ljudhantering
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    build-essential \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

CMD ["npm", "start"]
