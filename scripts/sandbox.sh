#!/usr/bin/env bash
# Runs the MCP server against the Akash sandbox network.
# Fetches the wallet mnemonic from the KADI vault automatically.

set -euo pipefail

export AKASH_MNEMONIC="$(kadi secret get AKASH_WALLET -v global)"
export GRPC_ENDPOINT="https://grpc.sandbox-01.aksh.pw:443"
export RPC_ENDPOINT="https://rpc.sandbox-01.aksh.pw:443"

npx @modelcontextprotocol/inspector node dist/index.js
