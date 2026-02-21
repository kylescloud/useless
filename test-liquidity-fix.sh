#!/bin/bash

echo "=========================================="
echo "Testing Liquidity Fix"
echo "=========================================="
echo ""

# Check if pools.json exists
if [ -f "data/pools.json" ]; then
    echo "✅ pools.json exists"
    
    # Count total pools
    TOTAL=$(cat data/pools.json | grep -o '"isActive": true' | wc -l)
    echo "📊 Total active pools: $TOTAL"
    
    # Show sample active pools
    echo ""
    echo "Sample active pools:"
    cat data/pools.json | grep -B 5 '"isActive": true' | head -30
    
    # Check for pools with liquidity > 0
    echo ""
    echo "Pools with liquidity > 0:"
    cat data/pools.json | grep -B 3 '"liquidity": "[1-9]' | head -20
    
else
    echo "❌ pools.json does not exist - bot hasn't run yet"
    echo ""
    echo "To test the fix:"
    echo "1. Run: npm run dev"
    echo "2. Wait for pool discovery to complete"
    echo "3. Run this script again: ./test-liquidity-fix.sh"
fi

echo ""
echo "=========================================="
echo "Test Complete"
echo "=========================================="
