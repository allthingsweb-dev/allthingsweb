ARG BUN_VERSION=1.2.2

FROM oven/bun:${BUN_VERSION}-slim as build

LABEL fly_launch_runtime="React Router"

# Remix app lives here
WORKDIR /app

# Set production environment
ENV NODE_ENV="production"

# Install packages needed to build node modules
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential pkg-config python-is-python3

# Copy the entire monorepo structure
COPY --link . .

# Install node modules for the entire monorepo
RUN bun install

# Build application (specifically the website)
RUN cd website && bun --bun run build

# Clean up node_modules
RUN rm -rf node_modules

# Install only production dependencies
RUN cd website && bun i --ci

# Remove irrelevant app folders
RUN rm -rf hackathon-app atw-cli sync-server

# Start the server by default, this can be overwritten at runtime
EXPOSE 3000
WORKDIR /app/website
CMD [ "bun", "run", "start" ]