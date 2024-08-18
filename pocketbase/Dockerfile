ARG GO_VERSION=1

# Specifies a parent image
FROM golang:${GO_VERSION}-bookworm as builder

# Creates an app directory to hold your app’s source code
WORKDIR /usr/src/app

# Copies everything from your root directory into /app
COPY . .

# Installs Go dependencies
RUN go mod download && go mod verify

# Builds your app with optional configuration
RUN CGO_ENABLED=0 go build -o run-app -v main.go

# Specifies a parent image
FROM debian:bookworm

# Tells Docker which network port your container listens on
EXPOSE 8080

# Specifies the executable command that runs when the container starts
COPY --from=builder /usr/src/app/run-app /usr/local/bin/
CMD ["run-app", "serve", "--http=0.0.0.0:8080"]
