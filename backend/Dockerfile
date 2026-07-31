# DropSilk signaling backend (Bun + Hono + ws + Postgres).
FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies against the committed lockfile for reproducibility.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# App source.
COPY . .

ENV NODE_ENV=production
EXPOSE 8080

# Apply migrations (Postgres is gated healthy by compose), then start the server.
CMD ["sh", "-c", "bun run scripts/migrate.ts && exec bun server.ts"]
