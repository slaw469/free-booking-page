# Free Booking Page: one small container, no build step, no dependencies.
FROM node:22-alpine

WORKDIR /app
COPY package.json ./
COPY server.js config.json ./
COPY lib ./lib
COPY scripts ./scripts
COPY public ./public
COPY ui ./ui

# Bookings and settings are written to /data. Mount a persistent disk or volume
# there, or everything is lost when the container is replaced.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/data
RUN mkdir -p /data
VOLUME /data

# Runs as the default user on purpose: most hosts mount volumes owned by root, and a
# non-root user could not write bookings to them.
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" || exit 1

# Set ADMIN_PASSCODE when you run it. Without one the dashboard refuses to open.
CMD ["node", "server.js"]
