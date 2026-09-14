FROM node:22-alpine

WORKDIR /app

COPY package*.json ./

# This image runs the TypeScript development server and therefore needs its
# devDependencies. A production image should compile TypeScript in a build
# stage and install only runtime dependencies with `npm ci --omit=dev`.
RUN npm install

COPY . .

EXPOSE 3001

CMD ["npm", "run", "dev"]
