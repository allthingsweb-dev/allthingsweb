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

.PHONY: check
check: ## Check the code
	@cd $(WEBSITE_DIR) && $(PACKAGE_MANAGER) run prettier:check
	@cd $(WEBSITE_DIR) && $(PACKAGE_MANAGER) run typecheck

.PHONY: build
build: ## Build All
	@cd $(WEBSITE_DIR) && $(PACKAGE_MANAGER) run build

.PHONY: serve
serve: website/.env ## Serve the application
	@cd $(WEBSITE_DIR) && $(PACKAGE_MANAGER) run dev
