#!/usr/bin/env bash
# The old installer's first address, on GitHub Pages. It moved to
# allthings.dev, where this runs it from, so links to this one keep working
# for now.
set -euo pipefail
curl -fsSL https://allthings.dev/atw-install.bash | bash
