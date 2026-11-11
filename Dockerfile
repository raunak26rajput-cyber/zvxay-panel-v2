FROM node:22-slim

# Python + pip for the panel (Flask) and hosted Python bots, git/bash.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip git bash ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Panel Python dependencies first (better layer caching).
COPY requirements.txt ./
RUN pip install --break-system-packages -r requirements.txt

# Panel app (Flask website + bot-facing Application API).
COPY app.py models.py botapi.py bot_template.py network_check.py ./
COPY templates ./templates
COPY static ./static

# Telegram bot (copied verbatim; it talks to the panel over the
# Pterodactyl-compatible Application API in botapi.py).
COPY bot ./bot
RUN npm --prefix bot install --omit=dev

COPY start.sh ./start.sh
RUN chmod +x start.sh

EXPOSE 8080
CMD ["bash", "start.sh"]
