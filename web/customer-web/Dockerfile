FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev=false
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /srv
RUN npm i -g serve@14
COPY --from=build /app/dist ./dist
EXPOSE 8080
CMD ["serve", "-s", "dist", "-l", "8080"]

