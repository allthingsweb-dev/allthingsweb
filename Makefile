# Styles
YELLOW := $(shell echo "\033[00;33m")
RED := $(shell echo "\033[00;31m")
RESTORE := $(shell echo "\033[0m")

# Variables
.DEFAULT_GOAL := list
PACKAGE_MANAGER := bun
CURRENT_DIR := $(shell pwd)
DEPENDENCIES := bun git
CLI_DIR := $(CURRENT_DIR)/cli
AUX_DIR := $(CURRENT_DIR)/aux

.PHONY: list
list:
	@echo "${YELLOW}***${RED}***${RESTORE}***${YELLOW}***${RED}***${RESTORE}***${YELLOW}***${RED}***${RESTORE}***${YELLOW}***${RED}***${RESTORE}"
	@echo "${RED}allthings: ${YELLOW}Available targets${RESTORE}:"
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

.PHONY: install
install: check-dependencies ## Install the dependencies
	@cd $(CLI_DIR) && $(PACKAGE_MANAGER) install
	@cd $(AUX_DIR) && $(PACKAGE_MANAGER) install

.PHONY: fmt
fmt: ## Format the code
	@cd $(CLI_DIR) && $(PACKAGE_MANAGER) run fmt
	@cd $(AUX_DIR) && $(PACKAGE_MANAGER) run fmt

.PHONY: check
check: ## Check the code
	@cd $(CLI_DIR) && $(PACKAGE_MANAGER) run check
	@cd $(CLI_DIR) && $(PACKAGE_MANAGER) run typecheck
	@cd $(AUX_DIR) && $(PACKAGE_MANAGER) run check
	@cd $(AUX_DIR) && $(PACKAGE_MANAGER) run typecheck

.PHONY: build-cli
build-cli:  ## Build CLI
	@cd $(CLI_DIR) && bun build --compile --minify src/index --outfile allthings
	@cd $(CLI_DIR) && rm -f .*.bun-build

.PHONY: build-all-cli
build-all-cli:  
	@cd $(CLI_DIR) && for target in bun-linux-x64 bun-linux-arm64 bun-windows-x64 bun-darwin-x64 bun-darwin-arm64; do \
		bun build --compile --minify src/index --outfile allthings-$$target --target=$$target; \
	done
	@cd $(CLI_DIR) && rm -f .*.bun-build

