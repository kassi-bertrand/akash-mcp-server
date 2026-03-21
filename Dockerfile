# Stage 1: Build
FROM --platform=linux/amd64 node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY awesome-akash ./awesome-akash
RUN npm run build

# Stage 2: Runtime — only production deps + compiled output
FROM --platform=linux/amd64 node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
CMD ["node", "dist/index.js"]
