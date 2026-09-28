FROM node:22-alpine

WORKDIR /app
RUN chown node:node /app
USER node

COPY --chown=node:node package.json package-lock.json ./

# This image runs the TypeScript development server and therefore needs its
# devDependencies. A production image should compile TypeScript in a build
# stage and install only runtime dependencies with `npm ci --omit=dev`.
RUN npm ci

COPY --chown=node:node . .

EXPOSE 3001

CMD ["npm", "run", "dev"]
