FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

# Playwright browsers and OS dependencies
RUN npx playwright install --with-deps chromium

COPY src ./src
COPY migrations ./migrations
COPY tsconfig.json ./tsconfig.json

EXPOSE 3000

CMD ["sh", "-c", "npm run migrate && npm run start"]