#!/usr/bin/env bash
# The old installer's address. The CLI is now `allthings`; this runs its
# installer, which also keeps `atw` as an alias for now.
set -euo pipefail
echo "atw is now allthings. Installing it from install.bash."
curl -fsSL https://allthingsweb-dev.github.io/allthingsweb/install.bash | bash
