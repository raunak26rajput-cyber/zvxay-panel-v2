FROM node:22-slim

# Python + pip for hosted Python bots, git/bash for egg startup commands.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip git bash ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Panel dependencies first (better layer caching).
COPY package.json ./
RUN npm install --omit=dev

# Panel app.
COPY server.js ./
COPY lib ./lib
COPY public ./public

# Telegram bot (copied verbatim; it talks to the panel over the
# Pterodactyl-compatible Application API).
COPY bot ./bot
RUN npm --prefix bot install --omit=dev

COPY start.sh ./start.sh
RUN chmod +x start.sh

EXPOSE 8080
CMD ["bash", "start.sh"]
