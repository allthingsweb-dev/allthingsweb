ARG DENO_VERSION=2.0.0

FROM hayd/alpine-deno:${DENO_VERSION}

EXPOSE 3000 

LABEL fly_launch_runtime="Remix"

# Remix app lives here
WORKDIR /app

USER deno

# Install dependencies
COPY --link package.json deno.json deno.lock ./
RUN deno install

# Copy application code
COPY --link . .

# Build application
RUN deno task build

# Start the server by default, this can be overwritten at runtime
CMD [ "deno", "task", "start" ]
