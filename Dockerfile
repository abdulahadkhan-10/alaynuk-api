# --- Base Stage ---
FROM node:20-alpine AS base

WORKDIR /usr/src/app

COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including devDependencies)
RUN npm install --legacy-peer-deps

COPY . .

# Generate Prisma Client
RUN npx prisma generate

# --- Development Stage ---
FROM base AS development
ENV NODE_ENV=development
EXPOSE 5000
CMD ["npm", "run", "dev"]

# --- Builder Stage ---
FROM base AS builder
# Build the TypeScript project
RUN npm run build
# Clean devDependencies
RUN npm prune --production

# --- Production Stage ---
FROM node:20-alpine AS production

WORKDIR /usr/src/app

COPY --from=builder /usr/src/app/package*.json ./
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/prisma ./prisma

EXPOSE 5000

ENV NODE_ENV=production

CMD ["node", "dist/server.js"]
