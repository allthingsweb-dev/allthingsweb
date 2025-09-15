# Styles
YELLOW := $(shell echo "\033[00;33m")
RED := $(shell echo "\033[00;31m")
RESTORE := $(shell echo "\033[0m")

# Variables
.DEFAULT_GOAL := list
PACKAGE_MANAGER := bun
CURRENT_DIR := $(shell pwd)
DEPENDENCIES := bun git
APP_DIR := $(CURRENT_DIR)/app
CLI_DIR := $(CURRENT_DIR)/atw-cli

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

app/.env.local:
	@echo "You need to create the '.env.local' file from the 'example.env' example."
	@exit 1

.PHONY: install
install: check-dependencies ## Install the dependencies
	@cd $(APP_DIR) && $(PACKAGE_MANAGER) install
	@cd $(CLI_DIR) && $(PACKAGE_MANAGER) install

.PHONY: fmt
fmt: ## Format the code
	@cd $(APP_DIR) && $(PACKAGE_MANAGER) run fmt
	@cd $(CLI_DIR) && $(PACKAGE_MANAGER) run fmt

.PHONY: check
check: ## Check the code
	@cd $(APP_DIR) && $(PACKAGE_MANAGER) run check
	@cd $(APP_DIR) && $(PACKAGE_MANAGER) run typecheck
	@cd $(CLI_DIR) && $(PACKAGE_MANAGER) run check
	@cd $(CLI_DIR) && $(PACKAGE_MANAGER) run typecheck

.PHONY: build
build: ## Build the Next.js app
	@cd $(APP_DIR) && $(PACKAGE_MANAGER) run build

.PHONY: serve
serve: app/.env ## Serve the Next.js application
	@cd $(APP_DIR) && $(PACKAGE_MANAGER) run dev

.PHONY: build-cli
build-cli:  ## Build CLI
	@cd $(CLI_DIR) && bun build --compile --minify src/index --outfile atw-cli
	@cd $(CLI_DIR) && rm -f .*.bun-build

.PHONY: build-all-cli
build-all-cli:  
	@cd $(CLI_DIR) && for target in bun-linux-x64 bun-linux-arm64 bun-windows-x64 bun-darwin-x64 bun-darwin-arm64; do \
		bun build --compile --minify src/index --outfile atw-cli-$$target --target=$$target; \
	done
	@cd $(CLI_DIR) && rm -f .*.bun-build

