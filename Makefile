# Styles
YELLOW := $(shell echo "\033[00;33m")
RED := $(shell echo "\033[00;31m")
RESTORE := $(shell echo "\033[0m")

# Variables
.DEFAULT_GOAL := list
PACKAGE_MANAGER := bun
CURRENT_DIR := $(shell pwd)
DEPENDENCIES := bun git
WEBSITE_DIR := $(CURRENT_DIR)/website
CLI_DIR := $(CURRENT_DIR)/atw-cli
SYNC_SERVER_DIR := $(CURRENT_DIR)/sync-server
HACKATHON_APP_DIR := $(CURRENT_DIR)/hackathon-app
LIB_DIR := $(CURRENT_DIR)/lib

.PHONY: list
list:
	@echo "${YELLOW}***${RED}***${RESTORE}***${YELLOW}***${RED}***${RESTORE}***${YELLOW}***${RED}***${RESTORE}***${YELLOW}***${RED}***${RESTORE}"
	@echo "${RED}All Things Web: ${YELLOW}Available targets${RESTORE}:"
	@grep -E '^[a-zA-Z-]+:.*?## .*$$' Makefile | sort | awk 'BEGIN {FS = ":.*?## "}; {printf " ${YELLOW}%-15s${RESTORE} > %s\n", $$1, $$2}'
	@echo "${RED}=================================${RESTORE}"

.PHONY: check-dependencies
check-dependencies:
	@for dependency in $(DEPENDENCIES); do \
		if ! command -v $$dependency &> /dev/null; then \
			echo "${RED}Error:${RESTORE} ${YELLOW}$$dependency${RESTORE} is not installed."; \
			exit 1; \
		fi; \
	done
	@echo "All ${YELLOW}dependencies are installed.${RESTORE}"

website/.env:
	@echo "You need to create the '.env' file from the '.env.dist' example."
	@exit 1

.PHONY: install
install: check-dependencies ## Install the dependencies
	@cd $(WEBSITE_DIR) && $(PACKAGE_MANAGER) install

.PHONY: fmt
fmt: ## Format the code
	@cd $(WEBSITE_DIR) && $(PACKAGE_MANAGER) run prettier:fix
	@cd $(WEBSITE_DIR) && $(PACKAGE_MANAGER) run prettier:check
	@cd $(HACKATHON_APP_DIR) && $(PACKAGE_MANAGER) run prettier:fix
	@cd $(HACKATHON_APP_DIR) && $(PACKAGE_MANAGER) run prettier:check
	@cd $(SYNC_SERVER_DIR) && $(PACKAGE_MANAGER) run prettier:fix
	@cd $(SYNC_SERVER_DIR) && $(PACKAGE_MANAGER) run prettier:check
	@cd $(LIB_DIR) && $(PACKAGE_MANAGER) run prettier:fix
	@cd $(LIB_DIR) && $(PACKAGE_MANAGER) run prettier:check

.PHONY: check
check: ## Check the code
	@cd $(WEBSITE_DIR) && $(PACKAGE_MANAGER) run prettier:check
	@cd $(WEBSITE_DIR) && $(PACKAGE_MANAGER) run typecheck
	@cd $(HACKATHON_APP_DIR) && $(PACKAGE_MANAGER) run prettier:check
	@cd $(HACKATHON_APP_DIR) && $(PACKAGE_MANAGER) run typecheck
	@cd $(SYNC_SERVER_DIR) && $(PACKAGE_MANAGER) run prettier:check
	@cd $(SYNC_SERVER_DIR) && $(PACKAGE_MANAGER) run typecheck
	@cd $(LIB_DIR) && $(PACKAGE_MANAGER) run prettier:check
	@cd $(LIB_DIR) && $(PACKAGE_MANAGER) run typecheck

.PHONY: build
build: ## Build All
	@cd $(WEBSITE_DIR) && $(PACKAGE_MANAGER) run build

.PHONY: test
test: ## Run Playwright tests (requires dev server to be running)
	@cd $(WEBSITE_DIR) && $(PACKAGE_MANAGER) run test

.PHONY: serve
serve: website/.env ## Serve the application
	@cd $(WEBSITE_DIR) && $(PACKAGE_MANAGER) run dev

.PHONY: build-cli
build-cli:  ## Build CLI
	@cd $(CLI_DIR) && bun build --bundle src/index.ts --outfile atw-cli.js --target=bun
	@cd $(CLI_DIR) && bun shim.ts
	@cd $(CLI_DIR) && bun build --compile --minify atw-cli.js --outfile atw-cli
	@cd $(CLI_DIR) && rm atw-cli.js

.PHONY: build-all-cli
build-all-cli:  
	@cd $(CLI_DIR) && bun build --bundle src/index.ts --outfile atw-cli.js --target=bun
	@cd $(CLI_DIR) && bun shim.ts
	@cd $(CLI_DIR) && for target in bun-linux-x64 bun-linux-arm64 bun-windows-x64 bun-darwin-x64 bun-darwin-arm64; do \
		bun build --compile --minify atw-cli.js --outfile atw-cli-$$target --target=$$target; \
	done
	@cd $(CLI_DIR) && rm atw-cli.js

.PHONY: deploy-sync-permissions
deploy-sync-permissions:
	@cd $(SYNC_SERVER_DIR) && $(PACKAGE_MANAGER) run deploy:permissions

.PHONY: deploy-website
deploy-website: ## Deploy the website to Fly.io
	@echo "${YELLOW}Deploying website to Fly.io...${RESTORE}"
	@if ! command -v flyctl &> /dev/null; then \
		echo "${RED}Error:${RESTORE} flyctl is not installed. Please install it from https://fly.io/docs/hands-on/install-flyctl/"; \
		exit 1; \
	fi
	@flyctl deploy --config $(WEBSITE_DIR)/fly.toml --dockerfile $(WEBSITE_DIR)/Dockerfile
	@echo "${YELLOW}Website deployed successfully!${RESTORE}"
