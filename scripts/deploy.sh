#!/bin/bash
# Deploy Agent Colosseum contracts to OneChain testnet
set -e

DEPLOY_FILE="$(dirname "$0")/deployed.json"
ONE=~/bin/one

echo "=== Deploying Agent Colosseum ==="

# 1. Deploy AMM package
echo -e "\n[1/4] Publishing AMM package..."
cd "$(dirname "$0")/../contracts/amm"
AMM_RESULT=$($ONE client publish --gas-budget 500000000 --json 2>&1)
AMM_PACKAGE=$(echo "$AMM_RESULT" | jq -r '.objectChanges[] | select(.type == "published") | .packageId')
echo "AMM Package ID: $AMM_PACKAGE"

# Extract treasury IDs from created objects
COLA_TREASURY=$(echo "$AMM_RESULT" | jq -r '.objectChanges[] | select(.type == "created" and (.objectType | contains("ColaTreasury"))) | .objectId')
WATER_TREASURY=$(echo "$AMM_RESULT" | jq -r '.objectChanges[] | select(.type == "created" and (.objectType | contains("WaterTreasury"))) | .objectId')
echo "COLA Treasury: $COLA_TREASURY"
echo "WATER Treasury: $WATER_TREASURY"

# 2. Deploy Colosseum package
echo -e "\n[2/4] Publishing Colosseum package..."
cd "$(dirname "$0")/../contracts/colosseum"
COLO_RESULT=$($ONE client publish --gas-budget 500000000 --json 2>&1)
COLO_PACKAGE=$(echo "$COLO_RESULT" | jq -r '.objectChanges[] | select(.type == "published") | .packageId')
echo "Colosseum Package ID: $COLO_PACKAGE"

# 3. Mint test tokens and create pool
echo -e "\n[3/4] Minting tokens and creating pool..."
WALLET=$($ONE client active-address)

# Mint 10B COLA
$ONE client call --package "$AMM_PACKAGE" --module cola --function mint \
  --args "$COLA_TREASURY" 10000000000000000000 "$WALLET" --gas-budget 100000000

# Mint 10B WATER
$ONE client call --package "$AMM_PACKAGE" --module water --function mint \
  --args "$WATER_TREASURY" 10000000000000000000 "$WALLET" --gas-budget 100000000

echo -e "\n[4/4] Creating COLA/WATER pool..."

# Find the COLA and WATER coin objects we just minted
COLA_TYPE="${AMM_PACKAGE}::cola::COLA"
WATER_TYPE="${AMM_PACKAGE}::water::WATER"

COLA_COIN=$($ONE client gas --json | jq -r --arg ct "$COLA_TYPE" '[.[] | select(.coinType == $ct)] | .[0].coinObjectId // empty')
WATER_COIN=$($ONE client gas --json | jq -r --arg ct "$WATER_TYPE" '[.[] | select(.coinType == $ct)] | .[0].coinObjectId // empty')

if [ -z "$COLA_COIN" ] || [ -z "$WATER_COIN" ]; then
  # Fallback: use objects owned by wallet
  echo "Searching for coin objects..."
  COLA_COIN=$($ONE client objects --json | jq -r --arg ct "$COLA_TYPE" '[.[] | select(.data.type | contains("Coin")) | select(.data.type | contains($ct))] | .[0].data.objectId // empty')
  WATER_COIN=$($ONE client objects --json | jq -r --arg ct "$WATER_TYPE" '[.[] | select(.data.type | contains("Coin")) | select(.data.type | contains($ct))] | .[0].data.objectId // empty')
fi

if [ -n "$COLA_COIN" ] && [ -n "$WATER_COIN" ]; then
  echo "COLA Coin: $COLA_COIN"
  echo "WATER Coin: $WATER_COIN"
  POOL_RESULT=$($ONE client call --package "$AMM_PACKAGE" --module pool --function create_pool_entry \
    --type-args "$COLA_TYPE" "$WATER_TYPE" \
    --args "$COLA_COIN" "$WATER_COIN" \
    --gas-budget 100000000 --json 2>&1)
  POOL_ID=$(echo "$POOL_RESULT" | jq -r '.objectChanges[] | select(.type == "created" and (.objectType | contains("Pool"))) | .objectId')
  echo "Pool ID: $POOL_ID"
else
  echo "WARNING: Could not find COLA/WATER coin objects. Create pool manually:"
  echo "  $ONE client call --package $AMM_PACKAGE --module pool --function create_pool_entry \\"
  echo "    --type-args ${COLA_TYPE} ${WATER_TYPE} \\"
  echo "    --args <COLA_COIN_ID> <WATER_COIN_ID>"
  POOL_ID=""
fi

# Write deployed.json
cat > "$DEPLOY_FILE" <<ENDJSON
{
  "amm_package": "$AMM_PACKAGE",
  "colosseum_package": "$COLO_PACKAGE",
  "cola_treasury": "$COLA_TREASURY",
  "water_treasury": "$WATER_TREASURY",
  "pool_id": "$POOL_ID",
  "wallet": "$WALLET"
}
ENDJSON

echo -e "\nDone! Deployed IDs written to $DEPLOY_FILE"
cat "$DEPLOY_FILE"
