#!/usr/bin/env bash

ATW_HOME="$HOME/.allthingsweb"
mkdir -p $ATW_HOME
cd $ATW_HOME

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

if [ "$ARCH" = "x86_64" ]; then
  ARCH="x64"
elif [ "$ARCH" = "arm64" ] || [ "$ARCH" = "aarch64" ]; then
  ARCH="arm64"
else
  echo "❌ Unsupported architecture: $ARCH"
  exit 1
fi

FILE="bun-${OS}-${ARCH}"
LATEST_RELEASE=$(curl -s "https://api.github.com/repos/allthingsweb-dev/allthingsweb/releases/latest" | grep tag_name | cut -d'"' -f 4)
URL="https://github.com/allthingsweb-dev/allthingsweb/releases/download/${LATEST_RELEASE}/atw-cli-${FILE}"

if curl -fLO "${URL}"; then
  echo "✅ Successfully downloaded ${FILE}"
else
  echo "❌ Failed to download ${FILE}. Please check the URL or platform."
  exit 1
fi

ln -sf $ATW_HOME/atw-cli-${FILE} $HOME/atw
chmod +x $HOME/atw

echo "You can now use ATW CLI by running: ~/atw"
echo ""
echo "- You may want to put ~/atw in you PATH"
echo "- You may want to creat an alias (in your .zshrc or .bashrc) alias atw='~/atw'"

~/atw

