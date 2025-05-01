ARG BUN_VERSION=1.2.2
ARG NODE_VERSION=20.11.1

FROM oven/bun:${BUN_VERSION}-slim as build

LABEL fly_launch_runtime="React Router"

# Remix app lives here
WORKDIR /app

# Set production environment
ENV NODE_ENV="production"

# Install packages needed to build node modules and node runtime
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential pkg-config python-is-python3 curl && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs

# Copy the entire monorepo structure
COPY --link . .

# Install node modules for the entire monorepo using Bun
RUN bun install

# Build application (specifically the website)
RUN cd website && bun --bun run build

# Remove dev dependencies and install only production dependencies
RUN cd website && rm -rf node_modules && bun install --production

# Final production image
FROM node:${NODE_VERSION}-slim

WORKDIR /app
ENV NODE_ENV="production"

# Copy built assets and server from the build stage
COPY --from=build /app/website/build /app/build
COPY --from=build /app/website/node_modules /app/node_modules
COPY --from=build /app/website/package.json /app/package.json
COPY --from=build /app/website/public /app/public

# Start the server
EXPOSE 3000
CMD [ "node", "build/server.js" ]