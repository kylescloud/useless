#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
#  Withdraw all accumulated profits from the arbitrage contract
# ═══════════════════════════════════════════════════════════════════

set -e

if [ ! -f .env ]; then
    echo "❌ .env file not found"
    exit 1
fi

export $(grep -v '^#' .env | xargs)

if [ -z "$ARB_CONTRACT_ADDRESS" ] || [ -z "$DEPLOYER_PRIVATE_KEY" ]; then
    echo "❌ ARB_CONTRACT_ADDRESS or DEPLOYER_PRIVATE_KEY not set"
    exit 1
fi

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  💰 PROFIT WITHDRAWAL"
echo "═══════════════════════════════════════════════════════"
echo ""

# Token addresses and decimals
declare -A TOKENS
TOKENS[WETH]="0x4200000000000000000000000000000000000006:18"
TOKENS[USDC]="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913:6"
TOKENS[USDbC]="0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA:6"
TOKENS[cbETH]="0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22:18"
TOKENS[wstETH]="0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452:18"
TOKENS[weETH]="0x04C0599Ae5A44757c0af6F9eC3b93da8976c150A:18"
TOKENS[cbBTC]="0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf:8"
TOKENS[ezETH]="0x2416092f143378750bb29b79eD961ab195CcEea5:18"
TOKENS[GHO]="0x6Bb7a212910682DCFdbd5BCBb3e28FB4E8da10Ee:18"
TOKENS[EURC]="0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42:6"
TOKENS[LBTC]="0xecAc9C5F704e954931349Da37F60E39f515c11c1:8"
TOKENS[AAVE]="0x63706e401c06ac8513145b7687A14804d17f814b:18"

TOTAL_VALUE=0
WITHDRAW_TOKENS=""

echo "Checking balances..."
echo ""

for TOKEN_NAME in "${!TOKENS[@]}"; do
    IFS=':' read -r ADDR DECIMALS <<< "${TOKENS[$TOKEN_NAME]}"
    
    RAW_BAL=$(cast call --rpc-url $BASE_RPC_URL $ARB_CONTRACT_ADDRESS \
        "getBalance(address)(uint256)" $ADDR 2>/dev/null || echo "0")
    
    if [ "$RAW_BAL" != "0" ] && [ -n "$RAW_BAL" ]; then
        DIVISOR=$(python3 -c "print(10**$DECIMALS)" 2>/dev/null || echo "1000000000000000000")
        HUMAN_BAL=$(python3 -c "print(f'{int(&quot;$RAW_BAL&quot;) / $DIVISOR:.6f}')" 2>/dev/null || echo "$RAW_BAL")
        
        if [ "$HUMAN_BAL" != "0.000000" ] && [ "$RAW_BAL" != "0" ]; then
            echo "  💎 $TOKEN_NAME: $HUMAN_BAL ($RAW_BAL raw)"
            WITHDRAW_TOKENS="$WITHDRAW_TOKENS $ADDR"
        fi
    fi
done

if [ -z "$WITHDRAW_TOKENS" ]; then
    echo "  No profits to withdraw."
    echo ""
    exit 0
fi

echo ""
echo "Withdraw all profits? (y/N)"
read -r CONFIRM

if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "Withdrawing..."

for ADDR in $WITHDRAW_TOKENS; do
    BAL=$(cast call --rpc-url $BASE_RPC_URL $ARB_CONTRACT_ADDRESS \
        "getBalance(address)(uint256)" $ADDR 2>/dev/null)
    
    if [ -n "$BAL" ] && [ "$BAL" != "0" ]; then
        echo -n "  Withdrawing $ADDR... "
        TX=$(cast send --rpc-url $BASE_RPC_URL \
            --private-key $DEPLOYER_PRIVATE_KEY \
            $ARB_CONTRACT_ADDRESS \
            "emergencyWithdraw(address,uint256)" \
            $ADDR $BAL 2>&1)
        
        if echo "$TX" | grep -q "transactionHash"; then
            HASH=$(echo "$TX" | grep "transactionHash" | awk '{print $2}')
            echo "✅ TX: $HASH"
        else
            echo "✅ Done"
        fi
    fi
done

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  ✅ All profits withdrawn to deployer wallet"
echo "═══════════════════════════════════════════════════════"
echo ""