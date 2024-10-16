ARG DENO_VERSION=2.0.0

FROM denoland/deno:${DENO_VERSION}

LABEL fly_launch_runtime="Remix"

# Remix app lives here
WORKDIR /app

# Install dependencies
COPY --link package.json deno.json deno.lock ./
RUN deno install

# Copy application code
COPY --link . .

# Build application
RUN deno task build

# Start the server by default, this can be overwritten at runtime
EXPOSE 3000 
CMD [ "deno", "task", "start" ]
