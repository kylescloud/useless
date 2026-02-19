# Migration Guide: Foundry to Hardhat

This guide explains the changes made when migrating from Foundry to Hardhat and how to use the new system.

## Overview

The Base Flash Loan Arbitrage Engine has been migrated from Foundry to Hardhat with significant enhancements including MEV protection, advanced gas optimization, and top-tier execution capabilities.

## Major Changes

### 1. Build System

**Before (Foundry):**
- `forge test` for testing
- `forge script` for deployment
- `foundry.toml` for configuration
- `.sol` test files

**After (Hardhat):**
- `npm test` for testing
- `npm run deploy:base` for deployment
- `hardhat.config.ts` for configuration
- `.test.ts` test files with Mocha/Chai

### 2. Smart Contract Updates

#### FlashLoanArbitrage.sol
- Now uses OpenZeppelin upgradeable contracts
- Implements UUPS proxy pattern for gas efficiency
- Enhanced with Pausable and Ownable features
- Improved error handling with custom errors
- Better reentrancy protection

#### Key Changes:
```solidity
// Old
import "@openzeppelin/contracts/access/Ownable.sol";

// New
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
```

### 3. New Dependencies

Added to `package.json`:
```json
{
  "hardhat": "^2.22.17",
  "@nomicfoundation/hardhat-toolbox": "^5.0.0",
  "@openzeppelin/contracts": "^5.1.0",
  "@openzeppelin/hardhat-upgrades": "^3.6.0",
  "@flashbots/ethers-provider-bundle": "^0.7.2",
  "hardhat-gas-reporter": "^2.2.2",
  "@typechain/hardhat": "^9.1.0"
}
```

### 4. New Features

#### Flashbots Integration (`src/flashbots/FlashbotsExecutor.ts`)
- Private mempool submission
- Bundle simulation
- Competitive bidding for miner tips
- Automatic fallback to public mempool

#### Gas Oracle (`src/gas/GasOracle.ts`)
- EIP-1559 base fee tracking
- Priority fee prediction
- Gas spike monitoring
- Optimal timing recommendations

#### Mempool Analyzer (`src/mempool/MempoolAnalyzer.ts`)
- Sandwich attack detection
- Front-running prevention
- Competing bot tracking
- MEV protection recommendations

#### Risk Manager (`src/risk/RiskManager.ts`)
- Dynamic slippage calculation
- Position size optimization
- Circuit breakers
- Drawdown protection

#### Worker Pool (`src/utils/WorkerPool.ts`)
- Parallel DEX quoting
- Concurrent strategy evaluation
- Configurable concurrency
- Task queue management

#### Cache System (`src/utils/Cache.ts`)
- LRU cache for pools
- TTL-based caching for prices
- Automatic cleanup
- Cache statistics tracking

## Migration Steps

### For Existing Users

1. **Update Dependencies**
```bash
rm -rf node_modules package-lock.json
npm install
```

2. **Update Environment Variables**
Add these new variables to your `.env`:
```bash
# Flashbots Configuration
FLASHBOTS_ENABLED=true
FLASHBOTS_MINER_TIP=1000000000

# Risk Management
ENABLE_CIRCUIT_BREAKER=true
MAX_DRAWDOWN=5
MAX_TRADES_PER_HOUR=100

# Performance
ENABLE_PARALLEL_QUOTING=true
QUOTING_WORKERS=10
ENABLE_POOL_CACHE=true
```

3. **Update Deployment Script**
```bash
# Old (Foundry)
forge script scripts/Deploy.s.sol --rpc-url $BASE_RPC_URL --broadcast

# New (Hardhat)
npm run deploy:base
```

4. **Update Testing**
```bash
# Old (Foundry)
forge test -vvv

# New (Hardhat)
npm test
```

### Contract Upgrade Path

If you have a deployed contract from the Foundry version:

1. **Deploy New Proxy**
```typescript
const FlashLoanArbitrage = await ethers.getContractFactory("FlashLoanArbitrage");
const newImplementation = await FlashLoanArbitrage.deploy();

await upgrades.upgradeProxy(
  oldContractAddress,
  newImplementation
);
```

2. **Verify Functions**
Ensure all your existing functions work with the new contract:
- `executeFlashLoan`
- `emergencyWithdraw`
- `setMaxFlashLoanAmount`

## Configuration Changes

### Hardhat Config

New `hardhat.config.ts` includes:
- Base mainnet configuration
- BaseScan API for verification
- Gas reporting
- Typechain integration
- Fork support

### Networks

```typescript
networks: {
  base: {
    url: process.env.BASE_RPC_URL,
    chainId: 8453,
    accounts: [process.env.PRIVATE_KEY],
  },
  hardhat: {
    forking: {
      url: process.env.BASE_RPC_URL,
      enabled: true,
    },
  },
}
```

## Testing Changes

### Test Structure

**Foundry Style:**
```solidity
function test_ExecuteFlashLoan() public {
    // Test logic
}
```

**Hardhat Style:**
```typescript
describe("FlashLoanArbitrage", function () {
    it("Should execute flash loan successfully", async function () {
        // Test logic
    });
});
```

### Running Tests

```bash
# All tests
npm test

# With coverage
npm run test:coverage

# With gas report
REPORT_GAS=true npm test

# Specific test file
npx hardhat test test/FlashLoanArbitrage.test.ts
```

## Performance Improvements

### Before
- Sequential DEX quoting
- No caching
- Single-threaded execution
- Basic gas pricing

### After
- Parallel quoting (10+ workers)
- Intelligent caching (pools, prices, reserves)
- WebSocket RPC with keep-alive
- Dynamic gas optimization
- MEV protection via Flashbots

## Security Enhancements

### New Security Features

1. **MEV Protection**
   - Flashbots private pool
   - Mempool monitoring
   - Sandwich attack detection

2. **Risk Management**
   - Dynamic slippage
   - Circuit breakers
   - Drawdown protection

3. **Contract Security**
   - UUPS upgradeable
   - Reentrancy guards
   - Pausable emergency stop

## Troubleshooting

### Common Issues

**Issue: Module not found errors**
```bash
# Solution
rm -rf node_modules
npm install
```

**Issue: Contract verification fails**
```bash
# Ensure BASESCAN_API_KEY is set in .env
# Check contract address is correct
```

**Issue: Tests fail after migration**
```bash
# Check that all imports are updated
# Ensure OpenZeppelin contracts are v5.1.0
# Verify contract interfaces match
```

## Next Steps

1. **Review New Features**
   - Read the updated README.md
   - Explore new modules in `src/`

2. **Test Locally**
   - Run `npm test`
   - Test with fork: `npm run fork:base`

3. **Deploy to Testnet**
   - Use Base Sepolia for testing
   - Verify contract works as expected

4. **Deploy to Mainnet**
   - Follow deployment guide
   - Monitor initial trades
   - Adjust parameters as needed

## Support

For issues or questions:
- Check the updated README.md
- Review todo.md for implementation status
- Open an issue on GitHub

## Summary

The migration to Hardhat brings significant improvements:
- ✅ Better tooling and ecosystem
- ✅ Enhanced security features
- ✅ Superior performance
- ✅ MEV protection
- ✅ Advanced risk management
- ✅ Production-ready architecture

The new system is ready for mainnet deployment with top-tier arbitrage execution capabilities.