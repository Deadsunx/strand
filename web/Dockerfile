# Strand React frontend — build with Node, serve static with nginx.
FROM node:22-alpine AS build
WORKDIR /app

# Vite reads these at BUILD time. They must point at the backend URL the user's
# BROWSER can reach (the host-published port), not the compose service name.
ARG VITE_API_BASE_URL=http://localhost:8081
ARG VITE_WS_URL=ws://localhost:8081
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_WS_URL=$VITE_WS_URL

COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine AS serve
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
