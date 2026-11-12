#!/usr/bin/env bash
# The old installer's name, at https://allthings.dev/atw-install.bash. The
# CLI is now `allthings`; this runs its installer, which also keeps `atw` as
# an alias for now.
set -euo pipefail
echo "atw is now allthings. Installing it from https://allthings.dev/install.bash."
curl -fsSL https://allthings.dev/install.bash | bash
