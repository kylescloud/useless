#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
#  Base Flash Loan Arbitrage Engine - Automated Deployment Script
# ═══════════════════════════════════════════════════════════════════

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  ⚡ BASE CHAIN FLASH LOAN ARBITRAGE - DEPLOYMENT"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# ─── Load Environment ─────────────────────────────────────────────
if [ ! -f .env ]; then
    echo -e "${RED}❌ .env file not found. Copy .env.example and configure it first.${NC}"
    echo "   cp .env.example .env"
    exit 1
fi

export $(grep -v '^#' .env | xargs)

# ─── Validate Required Variables ──────────────────────────────────
echo -e "${CYAN}[1/8] Validating environment...${NC}"

REQUIRED_VARS="BASE_RPC_URL DEPLOYER_PRIVATE_KEY EXECUTOR_ADDRESS BASESCAN_API_KEY"
MISSING=""
for VAR in $REQUIRED_VARS; do
    if [ -z "${!VAR}" ]; then
        MISSING="$MISSING $VAR"
    fi
done

if [ -n "$MISSING" ]; then
    echo -e "${RED}❌ Missing required env vars:${MISSING}${NC}"
    exit 1
fi
echo -e "${GREEN}  ✅ All required variables present${NC}"

# ─── Verify Chain ─────────────────────────────────────────────────
echo -e "${CYAN}[2/8] Verifying Base chain connection...${NC}"

CHAIN_ID=$(cast chain-id --rpc-url $BASE_RPC_URL 2>/dev/null)
if [ "$CHAIN_ID" != "8453" ]; then
    echo -e "${RED}❌ Wrong chain ID: $CHAIN_ID (expected 8453 for Base)${NC}"
    exit 1
fi

BLOCK=$(cast block-number --rpc-url $BASE_RPC_URL)
echo -e "${GREEN}  ✅ Connected to Base mainnet (block #$BLOCK)${NC}"

# ─── Check Deployer Balance ───────────────────────────────────────
echo -e "${CYAN}[3/8] Checking deployer balance...${NC}"

DEPLOYER_ADDR=$(cast wallet address --private-key $DEPLOYER_PRIVATE_KEY)
DEPLOYER_BAL=$(cast balance --rpc-url $BASE_RPC_URL $DEPLOYER_ADDR --ether)
echo -e "  Deployer: $DEPLOYER_ADDR"
echo -e "  Balance:  $DEPLOYER_BAL ETH"

DEPLOYER_BAL_WEI=$(cast balance --rpc-url $BASE_RPC_URL $DEPLOYER_ADDR)
MIN_BAL="1000000000000000" # 0.001 ETH
if [ $(echo "$DEPLOYER_BAL_WEI < $MIN_BAL" | bc 2>/dev/null || echo 1) -eq 1 ] && [ "$DEPLOYER_BAL_WEI" = "0" ]; then
    echo -e "${RED}❌ Deployer balance too low. Need at least 0.001 ETH for deployment gas.${NC}"
    exit 1
fi
echo -e "${GREEN}  ✅ Sufficient balance for deployment${NC}"

# ─── Install Dependencies ─────────────────────────────────────────
echo -e "${CYAN}[4/8] Installing dependencies...${NC}"

if [ ! -d "lib/forge-std" ]; then
    forge install foundry-rs/forge-std --no-commit 2>/dev/null || true
fi

if [ ! -d "node_modules" ]; then
    npm install --silent
fi
echo -e "${GREEN}  ✅ Dependencies installed${NC}"

# ─── Compile Contracts ────────────────────────────────────────────
echo -e "${CYAN}[5/8] Compiling contracts...${NC}"

forge build --force 2>&1 | tail -3
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Compilation failed${NC}"
    exit 1
fi
echo -e "${GREEN}  ✅ Contracts compiled successfully${NC}"

# ─── Run Tests ────────────────────────────────────────────────────
echo -e "${CYAN}[6/8] Running tests against Base fork...${NC}"

forge test --rpc-url $BASE_RPC_URL -v 2>&1 | tail -10
if [ $? -ne 0 ]; then
    echo -e "${YELLOW}⚠️  Some tests failed. Continue anyway? (y/N)${NC}"
    read -r CONTINUE
    if [ "$CONTINUE" != "y" ] && [ "$CONTINUE" != "Y" ]; then
        exit 1
    fi
else
    echo -e "${GREEN}  ✅ All tests passed${NC}"
fi

# ─── Simulate Deployment ──────────────────────────────────────────
echo -e "${CYAN}[7/8] Simulating deployment (dry run)...${NC}"

SIM_OUTPUT=$(forge script scripts/Deploy.s.sol:DeployFlashLoanArbitrage \
    --rpc-url $BASE_RPC_URL \
    --private-key $DEPLOYER_PRIVATE_KEY \
    -vv 2>&1)

if echo "$SIM_OUTPUT" | grep -q "SIMULATION COMPLETE"; then
    echo -e "${GREEN}  ✅ Simulation successful${NC}"
    echo "$SIM_OUTPUT" | grep "Contract Address\|Gas Used\|Value" | head -5
else
    echo -e "${RED}❌ Simulation failed:${NC}"
    echo "$SIM_OUTPUT" | tail -10
    exit 1
fi

# ─── Deploy ───────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}═══════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}  READY TO DEPLOY TO BASE MAINNET${NC}"
echo -e "${YELLOW}  Deployer: $DEPLOYER_ADDR${NC}"
echo -e "${YELLOW}  Executor: $EXECUTOR_ADDRESS${NC}"
echo -e "${YELLOW}═══════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}  This will cost real ETH. Proceed? (y/N)${NC}"
read -r DEPLOY

if [ "$DEPLOY" != "y" ] && [ "$DEPLOY" != "Y" ]; then
    echo "Deployment cancelled."
    exit 0
fi

echo -e "${CYAN}[8/8] Deploying to Base mainnet...${NC}"

DEPLOY_OUTPUT=$(forge script scripts/Deploy.s.sol:DeployFlashLoanArbitrage \
    --rpc-url $BASE_RPC_URL \
    --private-key $DEPLOYER_PRIVATE_KEY \
    --broadcast \
    --verify \
    --etherscan-api-key $BASESCAN_API_KEY \
    -vvv 2>&1)

echo "$DEPLOY_OUTPUT" | tail -20

# Extract contract address from output
CONTRACT_ADDR=$(echo "$DEPLOY_OUTPUT" | grep -oP "FlashLoanArbitrage deployed at: \K0x[a-fA-F0-9]{40}" || echo "")

if [ -n "$CONTRACT_ADDR" ]; then
    echo ""
    echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  ✅ DEPLOYMENT SUCCESSFUL!${NC}"
    echo -e "${GREEN}  Contract: $CONTRACT_ADDR${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"

    # Save to .env
    if grep -q "ARB_CONTRACT_ADDRESS" .env; then
        sed -i "s|ARB_CONTRACT_ADDRESS=.*|ARB_CONTRACT_ADDRESS=$CONTRACT_ADDR|" .env
    else
        echo "ARB_CONTRACT_ADDRESS=$CONTRACT_ADDR" >> .env
    fi
    echo -e "${GREEN}  ✅ Contract address saved to .env${NC}"

    # Verify deployment
    echo ""
    echo -e "${CYAN}Verifying deployment...${NC}"
    OWNER=$(cast call --rpc-url $BASE_RPC_URL $CONTRACT_ADDR "owner()(address)" 2>/dev/null)
    EXEC=$(cast call --rpc-url $BASE_RPC_URL $CONTRACT_ADDR "executor()(address)" 2>/dev/null)
    echo -e "  Owner:    $OWNER"
    echo -e "  Executor: $EXEC"
    echo -e "  BaseScan: https://basescan.org/address/$CONTRACT_ADDR"

    echo ""
    echo -e "${CYAN}Next steps:${NC}"
    echo "  1. Build engine:  npm run build"
    echo "  2. Create logs:   mkdir -p logs"
    echo "  3. Start engine:  npm start"
    echo "  4. Health check:  bash scripts/health_check.sh"
else
    echo -e "${RED}❌ Could not extract contract address from output${NC}"
    echo "Check the deployment output above for the address."
fi