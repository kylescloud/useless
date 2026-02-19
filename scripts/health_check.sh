#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
#  Base Flash Loan Arbitrage Engine - Health Check
# ═══════════════════════════════════════════════════════════════════

set -e

# Load environment
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  ⚡ ARBITRAGE ENGINE HEALTH CHECK"
echo "═══════════════════════════════════════════════════════"
echo ""

ERRORS=0

# ─── RPC Connection ───────────────────────────────────────────────
echo -e "${CYAN}[RPC]${NC}"
BLOCK=$(cast block-number --rpc-url $BASE_RPC_URL 2>/dev/null)
if [ $? -eq 0 ] && [ -n "$BLOCK" ]; then
    echo -e "  ${GREEN}✅ Connected to Base (block #$BLOCK)${NC}"
else
    echo -e "  ${RED}❌ RPC connection FAILED${NC}"
    ERRORS=$((ERRORS + 1))
fi

CHAIN_ID=$(cast chain-id --rpc-url $BASE_RPC_URL 2>/dev/null)
if [ "$CHAIN_ID" = "8453" ]; then
    echo -e "  ${GREEN}✅ Chain ID: 8453 (Base Mainnet)${NC}"
else
    echo -e "  ${RED}❌ Wrong chain ID: $CHAIN_ID (expected 8453)${NC}"
    ERRORS=$((ERRORS + 1))
fi

GAS_PRICE=$(cast gas-price --rpc-url $BASE_RPC_URL 2>/dev/null)
if [ -n "$GAS_PRICE" ]; then
    GAS_GWEI=$(echo "scale=6; $GAS_PRICE / 1000000000" | bc 2>/dev/null || echo "N/A")
    echo -e "  ${GREEN}✅ Gas price: $GAS_GWEI gwei${NC}"
fi
echo ""

# ─── Contract State ───────────────────────────────────────────────
echo -e "${CYAN}[CONTRACT]${NC}"
if [ -z "$ARB_CONTRACT_ADDRESS" ]; then
    echo -e "  ${RED}❌ ARB_CONTRACT_ADDRESS not set${NC}"
    ERRORS=$((ERRORS + 1))
else
    CODE=$(cast code --rpc-url $BASE_RPC_URL $ARB_CONTRACT_ADDRESS 2>/dev/null)
    if [ -n "$CODE" ] && [ "$CODE" != "0x" ]; then
        echo -e "  ${GREEN}✅ Contract deployed at $ARB_CONTRACT_ADDRESS${NC}"
    else
        echo -e "  ${RED}❌ No contract at $ARB_CONTRACT_ADDRESS${NC}"
        ERRORS=$((ERRORS + 1))
    fi

    OWNER=$(cast call --rpc-url $BASE_RPC_URL $ARB_CONTRACT_ADDRESS "owner()(address)" 2>/dev/null)
    echo -e "  📋 Owner: $OWNER"

    EXECUTOR=$(cast call --rpc-url $BASE_RPC_URL $ARB_CONTRACT_ADDRESS "executor()(address)" 2>/dev/null)
    echo -e "  📋 Executor: $EXECUTOR"

    PAUSED=$(cast call --rpc-url $BASE_RPC_URL $ARB_CONTRACT_ADDRESS "paused()(bool)" 2>/dev/null)
    if [ "$PAUSED" = "false" ]; then
        echo -e "  ${GREEN}✅ Contract ACTIVE (not paused)${NC}"
    else
        echo -e "  ${YELLOW}⚠️  Contract PAUSED${NC}"
    fi

    EXECUTIONS=$(cast call --rpc-url $BASE_RPC_URL $ARB_CONTRACT_ADDRESS "totalExecutions()(uint256)" 2>/dev/null)
    echo -e "  📊 Total executions: $EXECUTIONS"

    MIN_PROFIT=$(cast call --rpc-url $BASE_RPC_URL $ARB_CONTRACT_ADDRESS "minProfitBps()(uint256)" 2>/dev/null)
    echo -e "  📊 Min profit: ${MIN_PROFIT} bps"

    PREMIUM=$(cast call --rpc-url $BASE_RPC_URL $ARB_CONTRACT_ADDRESS "getFlashLoanPremium()(uint128)" 2>/dev/null)
    echo -e "  📊 Flash loan premium: ${PREMIUM} bps"
fi
echo ""

# ─── Wallet Balances ──────────────────────────────────────────────
echo -e "${CYAN}[WALLETS]${NC}"
if [ -n "$EXECUTOR_ADDRESS" ]; then
    EXEC_BAL=$(cast balance --rpc-url $BASE_RPC_URL $EXECUTOR_ADDRESS --ether 2>/dev/null)
    EXEC_BAL_NUM=$(echo "$EXEC_BAL" | sed 's/[^0-9.]//g')
    if (( $(echo "$EXEC_BAL_NUM < 0.001" | bc -l 2>/dev/null || echo 0) )); then
        echo -e "  ${RED}❌ Executor balance LOW: $EXEC_BAL ETH${NC}"
        ERRORS=$((ERRORS + 1))
    else
        echo -e "  ${GREEN}✅ Executor balance: $EXEC_BAL ETH${NC}"
    fi
fi
echo ""

# ─── Contract Token Balances (Profits) ────────────────────────────
echo -e "${CYAN}[PROFITS]${NC}"
if [ -n "$ARB_CONTRACT_ADDRESS" ]; then
    WETH_RAW=$(cast call --rpc-url $BASE_RPC_URL $ARB_CONTRACT_ADDRESS "getBalance(address)(uint256)" 0x4200000000000000000000000000000000000006 2>/dev/null)
    WETH_BAL=$(echo "scale=6; $WETH_RAW / 1000000000000000000" | bc 2>/dev/null || echo "0")
    echo -e "  💎 WETH:  $WETH_BAL"

    USDC_RAW=$(cast call --rpc-url $BASE_RPC_URL $ARB_CONTRACT_ADDRESS "getBalance(address)(uint256)" 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 2>/dev/null)
    USDC_BAL=$(echo "scale=2; $USDC_RAW / 1000000" | bc 2>/dev/null || echo "0")
    echo -e "  💵 USDC:  $USDC_BAL"

    USDBC_RAW=$(cast call --rpc-url $BASE_RPC_URL $ARB_CONTRACT_ADDRESS "getBalance(address)(uint256)" 0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA 2>/dev/null)
    USDBC_BAL=$(echo "scale=2; $USDBC_RAW / 1000000" | bc 2>/dev/null || echo "0")
    echo -e "  💵 USDbC: $USDBC_BAL"

    CBETH_RAW=$(cast call --rpc-url $BASE_RPC_URL $ARB_CONTRACT_ADDRESS "getBalance(address)(uint256)" 0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22 2>/dev/null)
    CBETH_BAL=$(echo "scale=6; $CBETH_RAW / 1000000000000000000" | bc 2>/dev/null || echo "0")
    echo -e "  💎 cbETH: $CBETH_BAL"
fi
echo ""

# ─── Engine Process ───────────────────────────────────────────────
echo -e "${CYAN}[ENGINE]${NC}"
if pgrep -f "ArbEngine" > /dev/null 2>&1; then
    PID=$(pgrep -f "ArbEngine" | head -1)
    echo -e "  ${GREEN}✅ Engine running (PID: $PID)${NC}"
elif pgrep -f "arb-engine" > /dev/null 2>&1; then
    PID=$(pgrep -f "arb-engine" | head -1)
    echo -e "  ${GREEN}✅ Engine running (PID: $PID)${NC}"
else
    echo -e "  ${YELLOW}⚠️  Engine process NOT detected${NC}"
fi

# Check log freshness
if [ -f logs/arb-engine.log ]; then
    LAST_MOD=$(stat -c %Y logs/arb-engine.log 2>/dev/null || stat -f %m logs/arb-engine.log 2>/dev/null)
    NOW=$(date +%s)
    AGE=$((NOW - LAST_MOD))
    if [ $AGE -lt 60 ]; then
        echo -e "  ${GREEN}✅ Logs active (last write ${AGE}s ago)${NC}"
    else
        echo -e "  ${YELLOW}⚠️  Logs stale (last write ${AGE}s ago)${NC}"
    fi
    LAST_LINE=$(tail -1 logs/arb-engine.log 2>/dev/null)
    echo -e "  📝 Last: ${LAST_LINE:0:80}"
else
    echo -e "  ${YELLOW}⚠️  No log file found${NC}"
fi
echo ""

# ─── Aave V3 Status ──────────────────────────────────────────────
echo -e "${CYAN}[AAVE V3]${NC}"
ETH_PRICE=$(cast call --rpc-url $BASE_RPC_URL 0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156 "getAssetPrice(address)(uint256)" 0x4200000000000000000000000000000000000006 2>/dev/null)
if [ -n "$ETH_PRICE" ]; then
    ETH_USD=$(echo "scale=2; $ETH_PRICE / 100000000" | bc 2>/dev/null || echo "N/A")
    echo -e "  ${GREEN}✅ Oracle ETH price: \$$ETH_USD${NC}"
fi

BTC_PRICE=$(cast call --rpc-url $BASE_RPC_URL 0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156 "getAssetPrice(address)(uint256)" 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf 2>/dev/null)
if [ -n "$BTC_PRICE" ]; then
    BTC_USD=$(echo "scale=2; $BTC_PRICE / 100000000" | bc 2>/dev/null || echo "N/A")
    echo -e "  ${GREEN}✅ Oracle BTC price: \$$BTC_USD${NC}"
fi
echo ""

# ─── Summary ──────────────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════"
if [ $ERRORS -eq 0 ]; then
    echo -e "  ${GREEN}✅ ALL CHECKS PASSED${NC}"
else
    echo -e "  ${RED}❌ $ERRORS CHECK(S) FAILED${NC}"
fi
echo "═══════════════════════════════════════════════════════"
echo ""