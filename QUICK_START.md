# Quick Start Guide - Base Chain Flash Loan Arbitrage Engine v2.0

Get your top-tier arbitrage bot up and running in minutes!

## 🚀 Installation

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your settings

# 3. Compile contracts
npm run compile

# 4. Run tests
npm test
```

## ⚙️ Essential Configuration

Edit `.env` with these minimum required settings:

```bash
# RPC & Wallet
BASE_RPC_URL=https://mainnet.base.org
PRIVATE_KEY=your_private_key_here

# Contract (after deployment)
CONTRACT_ADDRESS=0x0000000000000000000000000000000000000000

# Aave
AAVE_POOL_ADDRESS=0xA238Dd80C259a72e81d7e4664a9801593F98d1c5
MAX_FLASH_LOAN_AMOUNT=1000

# Gas
MAX_GAS_PRICE=100000000000  # 100 gwei
PRIORITY_FEE=2000000000     # 2 gwei

# Strategy
MIN_PROFIT_THRESHOLD=0.01   # 0.01 ETH
MAX_SLIPPAGE=30             # 30 bps (0.3%)

# Risk
ENABLE_CIRCUIT_BREAKER=true
MAX_DRAWDOWN=5
MAX_TRADES_PER_HOUR=100

# Performance
ENABLE_PARALLEL_QUOTING=true
QUOTING_WORKERS=10
```

## 📦 Deployment

### Deploy to Base Mainnet

```bash
# Deploy contract
npm run deploy:base

# Verify on BaseScan
npm run verify
```

### Deploy to Testnet (Recommended First)

```bash
# Deploy to Base Sepolia
npx hardhat run scripts/deploy.ts --network baseSepolia

# Verify
npm run verify
```

## 🎯 Running the Engine

### Start the Arbitrage Engine

```bash
# Production mode (compiled)
npm start

# Development mode (with hot reload)
npm run dev
```

### Monitor Mempool Only

```bash
npm run monitor
```

## 🧪 Testing

```bash
# All tests
npm test

# With coverage
npm run test:coverage

# Gas report
REPORT_GAS=true npm test

# Run on fork
npm run fork:base
```

## 📊 Key Features Enabled

### ✅ MEV Protection
- Flashbots private pool submission
- Sandwich attack detection
- Front-running prevention

### ✅ Gas Optimization
- Dynamic EIP-1559 pricing
- Base fee prediction
- Priority fee optimization

### ✅ Risk Management
- Dynamic slippage
- Circuit breakers
- Drawdown protection

### ✅ Performance
- Parallel DEX quoting (10 workers)
- Intelligent caching
- WebSocket RPC

## 🔧 Common Tasks

### Upgrade Contract

```bash
# Deploy new implementation
npm run deploy:base

# Upgrade proxy (in code)
await upgrades.upgradeProxy(oldAddress, newImplementation)
```

### Check Health

```bash
./scripts/health_check.sh
```

### Withdraw Profits

```bash
./scripts/withdraw_profits.sh
```

## 📈 Monitoring

The engine automatically logs:
- ✅ Arbitrage opportunities found
- ✅ Trade execution results
- ✅ Gas costs and profits
- ✅ Risk management events
- ✅ MEV protection status

## 🚨 Safety First

Before going to mainnet:

1. **Test on Base Sepolia** first
2. **Start with small amounts** (0.1 ETH max)
3. **Monitor logs** carefully
4. **Check gas prices** before trading
5. **Verify circuit breaker** is enabled

## 🆘 Troubleshooting

### Installation Issues
```bash
rm -rf node_modules package-lock.json
npm install
```

### Compilation Errors
```bash
npm run clean
npm run compile
```

### Test Failures
```bash
npm run clean
npm test -- --no-compile
```

### Deployment Issues
```bash
# Check RPC URL
curl -X POST $BASE_RPC_URL \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

## 📚 Documentation

- **README.md** - Full documentation
- **MIGRATION_GUIDE.md** - Foundry to Hardhat
- **ENHANCEMENTS_SUMMARY.md** - New features
- **DEPLOYMENT.md** - Detailed deployment guide

## 🎓 What's Different from v1.0?

### Before (v1.0)
- ❌ Foundry build system
- ❌ No MEV protection
- ❌ Static gas pricing
- ❌ Sequential quoting
- ❌ Basic risk controls

### After (v2.0)
- ✅ Hardhat with upgradeability
- ✅ Flashbots MEV protection
- ✅ Dynamic gas optimization
- ✅ Parallel quoting (10x faster)
- ✅ Advanced risk management

## 💡 Tips for Success

1. **Start Conservative**
   - Low max flash loan amount (0.1-1 ETH)
   - High minimum profit threshold (0.01 ETH)
   - Conservative slippage (0.5-1%)

2. **Monitor Closely**
   - Watch logs for first 24 hours
   - Check gas costs vs profits
   - Track success rates

3. **Adjust Parameters**
   - Increase limits gradually
   - Optimize based on results
   - Tune slippage per DEX

4. **Stay Safe**
   - Keep circuit breaker enabled
   - Monitor drawdown levels
   - Don't disable protections

## 📞 Support

- Check logs: `logs/` directory
- Review metrics: Engine stats output
- Open issue on GitHub

---

**Ready to start arbitrage?** 
1. Configure `.env` 
2. Deploy contract
3. Run `npm start`

**Good luck!** 🚀💰