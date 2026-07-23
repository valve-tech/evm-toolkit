#!/usr/bin/env bash
# Local ERC-4337 fixture: an anvil chain carrying the EntryPoint 0.6 +
# Coinbase Smart Wallet v1 contracts, cloned byte-for-byte from Ethereum
# mainnet via `cast code` + `anvil_setCode`. Run a bundler against it
# (see the README) and the example's "Anvil (local fixture)" chain works
# fully offline-from-testnets.
#
# Requires: foundry (anvil + cast) on PATH, and a mainnet RPC to read
# the contract code from (override with MAINNET_RPC).
#
# Usage:
#   ./scripts/anvil-aa-fixture.sh          # assumes anvil already running on :8545
#   START_ANVIL=1 ./scripts/anvil-aa-fixture.sh   # starts anvil itself

set -euo pipefail

MAINNET_RPC="${MAINNET_RPC:-https://ethereum-rpc.publicnode.com}"
LOCAL_RPC="${LOCAL_RPC:-http://127.0.0.1:8545}"

# EntryPoint v0.6 + its SenderCreator + Coinbase Smart Wallet v1
# factory & implementation. The SenderCreator matters: EntryPoint 0.6's
# constructor deploys it and bakes its address in as an immutable, so
# cloning the EntryPoint runtime alone leaves account creation calling
# an empty address ("sender has no code" during simulateValidation).
ENTRYPOINT_06="0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789"
SENDER_CREATOR_06="0x7fc98430eaedbb6070b35b39d798725049088348"
CB_FACTORY="0x0BA5ED0c6AA8c49038F819E587E2633c4A9F428a"
CB_IMPLEMENTATION="0x000100abaad02f1cfC8Bbe32bD5a564817339E72"

if [[ "${START_ANVIL:-0}" == "1" ]]; then
  anvil --port 8545 --chain-id 31337 &
  ANVIL_PID=$!
  trap 'kill $ANVIL_PID' EXIT
  sleep 2
fi

clone_contract() {
  local address="$1" label="$2"
  echo "→ cloning $label ($address) from mainnet…"
  local code
  code="$(cast code "$address" --rpc-url "$MAINNET_RPC")"
  if [[ "$code" == "0x" || -z "$code" ]]; then
    echo "ERROR: no code at $address on $MAINNET_RPC" >&2
    exit 1
  fi
  cast rpc anvil_setCode "$address" "$code" --rpc-url "$LOCAL_RPC" > /dev/null
  echo "  ✓ $label installed ($(( (${#code} - 2) / 2 )) bytes)"
}

clone_contract "$ENTRYPOINT_06" "EntryPoint v0.6"
clone_contract "$SENDER_CREATOR_06" "EntryPoint SenderCreator"
clone_contract "$CB_FACTORY" "Coinbase Smart Wallet factory"
clone_contract "$CB_IMPLEMENTATION" "Coinbase Smart Wallet implementation"

echo
echo "Fixture ready on $LOCAL_RPC. Next:"
echo "  1. Run a bundler against it, e.g. (alto):"
echo "       npx @pimlico/alto --entrypoints $ENTRYPOINT_06 \\"
echo "         --rpc-url $LOCAL_RPC --port 4337 \\"
echo "         --executor-private-keys 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \\"
echo "         --utility-private-key 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d \\"
echo "         --safe-mode false"
echo "  2. Fund the smart account shown in the UI:"
echo "       cast send <SMART_ACCOUNT_ADDRESS> --value 1ether \\"
echo "         --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \\"
echo "         --rpc-url $LOCAL_RPC"
echo "  3. yarn workspace @valve-tech/example-erc4337-write-flight dev"

if [[ "${START_ANVIL:-0}" == "1" ]]; then
  echo
  echo "anvil is running in the foreground of this script — Ctrl-C to stop."
  wait
fi
