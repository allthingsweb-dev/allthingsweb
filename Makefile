# Styles
YELLOW := $(shell echo "\033[00;33m")
RED := $(shell echo "\033[00;31m")
RESTORE := $(shell echo "\033[0m")

# Variables
.DEFAULT_GOAL := list
PACKAGE_MANAGER := deno
CURRENT_DIR := $(shell pwd)
DEPENDENCIES := deno git
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

.PHONY: fix
fix: ## Format & lint fix the code
	@cd $(WEBSITE_DIR) && $(PACKAGE_MANAGER) fmt
	@cd $(WEBSITE_DIR) && $(PACKAGE_MANAGER) lint --fix

.PHONY: check
check: ## Check format & lint
	@cd $(WEBSITE_DIR) && $(PACKAGE_MANAGER) fmt --check
	@cd $(WEBSITE_DIR) && $(PACKAGE_MANAGER) lint --compact

.PHONY: build
build: ## Build All
	@cd $(WEBSITE_DIR) && $(PACKAGE_MANAGER) task build

.PHONY: serve
serve: website/.env ## Serve the application
	@cd $(WEBSITE_DIR) && $(PACKAGE_MANAGER) task dev
