# Base Chain Flash Loan Arbitrage Engine v2.0

A production-grade, MEV-protected Aave V3 flash loan arbitrage system on Base chain with multi-DEX support, advanced gas optimization, and top-tier execution capabilities.

## 🚀 What's New in v2.0

### Major Enhancements

- **✅ Hardhat Migration**: Full migration from Foundry to Hardhat with upgradeable contracts
- **✅ Flashbots Integration**: Private mempool submission via Flashbots for MEV protection
- **✅ Advanced Gas Oracle**: Dynamic EIP-1559 gas pricing with prediction algorithms
- **✅ Mempool Analyzer**: Real-time detection of sandwich attacks, front-running, and competing bots
- **✅ Risk Manager**: Dynamic slippage, position sizing, circuit breakers, and drawdown protection
- **✅ Parallel Processing**: Worker pools for concurrent DEX quoting and strategy evaluation
- **✅ Intelligent Caching**: LRU and TTL-based caching for optimal performance

### Top-Tier Features

1. **MEV Protection**
   - Flashbots private pool integration
   - Sandwich attack detection
   - Front-running prevention
   - Mempool intelligence

2. **Gas Optimization**
   - EIP-1559 base fee prediction
   - Priority fee optimization
   - Dynamic gas limits
   - Gas spike monitoring

3. **Risk Management**
   - Dynamic slippage based on volatility
   - Position size optimization
   - Circuit breakers
   - Drawdown protection

4. **Performance**
   - Parallel DEX quoting (10+ workers)
   - In-memory caching (pools, prices, reserves)
   - WebSocket RPC with keep-alive
   - Optimized data structures

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Arbitrage Engine                          │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │  Strategy   │  │   Risk      │  │    Gas      │          │
│  │  Manager    │  │  Manager    │  │   Oracle    │          │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘          │
│         │                │                │                 │
│  ┌──────▼────────────────▼────────────────▼──────┐         │
│  │           Execution Manager                    │         │
│  │  • Pre-flight checks                          │         │
│  │  • Transaction simulation                     │         │
│  │  • Gas estimation                             │         │
│  └──────┬────────────────────────────────────────┘         │
│         │                                                  │
│  ┌──────▼──────┐  ┌─────────────┐  ┌─────────────┐         │
│  │  Flashbots  │  │   Mempool   │  │   Worker    │         │
│  │  Executor   │  │   Analyzer  │  │    Pool     │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
└─────────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
┌─────────────────┐           ┌─────────────────┐
│  Base Mainnet   │           │   DEX Aggreg.   │
│  (Aave V3)      │           │  (11 DEXs)      │
└─────────────────┘           └─────────────────┘
```

## 📦 Supported DEXs on Base

| DEX | Type | Router Address | Status |
|-----|------|----------------|--------|
| Aerodrome SlipStream | CL | `0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5` | ✅ |
| PancakeSwap V3 | CL | `0x678Aa4bF4E210cf2166753e054d5b7c31cc7fa86` | ✅ |
| Uniswap V3 | CL | `0x2626664c2603336E57B271c5C0b26F421741e481` | ✅ |
| Uniswap V2 | AMM | `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24` | ✅ |
| Aerodrome V2 | AMM | `0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43` | ✅ |
| SushiSwap V3 | CL | `0xc35DADB65012eC5796536bD9864eD8773aBc74C4` | ✅ |
| Balancer V2 | Ba | `0xBA12222222228d8Ba445958a75a0704d566BF2C8` | ✅ |
| Curve | Stable | Various | ✅ |
| BaseSwap V3 | CL | Various | ✅ |
| 0x API | Aggregator | API-based | ✅ |

## 💰 Supported Assets

**15 Borrowable Assets on Aave V3 Base:**
- WETH, cbETH, USDbC, wstETH, USDC, weETH, cbBTC, ezETH
- GHO, wrsETH, LBTC, EURC, AAVE, tBTC, syrupUSDC

## 🔧 Installation

```bash
# Clone the repository
git clone <repository-url>
cd base-arb-engine

# Install dependencies
npm install

# Configure environment variables
cp .env.example .env
# Edit .env with your configuration

# Compile contracts
npm run compile

# Run tests
npm test
```

## ⚙️ Configuration

### Environment Variables

```bash
# RPC Configuration
BASE_RPC_URL=https://mainnet.base.org
PRIVATE_KEY=your_private_key_here

# Aave V3 Configuration
AAVE_POOL_ADDRESS=0xA238Dd80C259a72e81d7e4664a9801593F98d1c5
MAX_FLASH_LOAN_AMOUNT=1000

# Gas Configuration
MAX_GAS_PRICE=100000000000 # 100 gwei
PRIORITY_FEE=2000000000 # 2 gwei

# 0x API
ZEROX_API_KEY=your_0x_api_key

# Flashbots
FLASHBOTS_ENABLED=true
FLASHBOTS_MINER_TIP=1000000000 # 1 gwei

# Strategy Configuration
MIN_PROFIT_THRESHOLD=0.01 # ETH
MAX_SLIPPAGE=30 # 30 bps (0.3%)
MIN_LIQUIDITY=100000 # USD

# Risk Management
ENABLE_CIRCUIT_BREAKER=true
MAX_DRAWDOWN=5 # % of portfolio
MAX_TRADES_PER_HOUR=100

# Performance
ENABLE_PARALLEL_QUOTING=true
QUOTING_WORKERS=10
ENABLE_POOL_CACHE=true
```

## 🚀 Deployment

### Deploy to Base Mainnet

```bash
# Deploy contract
npm run deploy:base

# Verify on BaseScan
npm run verify
```

### Deploy to Local Fork

```bash
# Start local fork
npm run fork:base

# Deploy to fork
npm run deploy:base:fork
```

## 📊 Arbitrage Strategies

### 1. Direct Cross-DEX Arbitrage
- Execute simple arbitrage between two DEXs
- Example: Buy WETH on Uniswap V3, sell on Aerodrome

### 2. Triangular Arbitrage
- Multi-hop arbitrage across 3 tokens
- Example: WETH → USDC → USDbC → WETH

### 3. LST Arbitrage
- Exploit price differences between liquid staking tokens
- Example: cbETH ↔ wstETH ↔ weETH

### 4. Stablecoin Arbitrage
- Capitalize on stablecoin depeg opportunities
- Example: USDC ↔ USDbC ↔ EURC

### 5. 0x Aggregator Arbitrage
- Use 0x API for optimal routing
- Finds best path across all integrated DEXs

## 🔒 Security Features

### Smart Contract Security
- ✅ UUPS upgradeable pattern
- ✅ Reentrancy protection
- ✅ Pausable contract
- ✅ Access control (Ownable)
- ✅ Emergency withdrawal

### MEV Protection
- ✅ Flashbots private pool
- ✅ Sandwich attack detection
- ✅ Front-running prevention
- ✅ Mempool monitoring
- ✅ Competitive gas bidding

### Risk Management
- ✅ Dynamic slippage
- ✅ Position size limits
- ✅ Circuit breakers
- ✅ Drawdown protection
- ✅ Hourly trade limits

## 📈 Performance Optimizations

### Parallel Processing
- 10+ worker threads for concurrent DEX quoting
- Parallel strategy evaluation
- Asynchronous price feed updates

### Caching
- Pool reserves cache (30s TTL)
- Price cache (5s TTL)
- LRU cache for frequently accessed data
- Cache hit rate tracking

### Connection Optimization
- WebSocket RPC with keep-alive
- Connection pooling
- Automatic failover
- Request queuing

## 🧪 Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run gas report
npm run test:gas

# Run specific test file
npx hardhat test test/FlashLoanArbitrage.test.ts
```

## 📊 Monitoring & Analytics

### Real-Time Metrics
- Success rate per strategy
- P&L tracking
- Gas efficiency
- Latency metrics
- Cache hit rates

### Alerts
- Telegram integration
- Slack webhooks
- Circuit breaker triggers
- High failure rate detection

## 🛠️ Development

```bash
# Compile contracts
npm run compile

# Clean build artifacts
npm run clean

# Start local node
npm run node

# Run in development mode
npm run dev

# Monitor mempool
npm run monitor
```

## 📝 Project Structure

```
base-arb-engine/
├── contracts/           # Solidity smart contracts
│   ├── adapters/        # DEX adapters
│   ├── interfaces/      # Contract interfaces
│   ├── libraries/       # Utility libraries
│   └── FlashLoanArbitrage.sol
├── scripts/             # Deployment scripts
├── test/                # Hardhat tests
├── src/
│   ├── engine/          # Main orchestrator
│   ├── strategies/      # Arbitrage strategies
│   ├── dex/             # DEX integration
│   ├── flashbots/       # Flashbots executor
│   ├── gas/             # Gas oracle
│   ├── mempool/         # Mempool analyzer
│   ├── risk/            # Risk manager
│   ├── monitoring/      # Monitoring tools
│   ├── execution/       # Execution manager
│   ├── config/          # Configuration
│   └── utils/           # Utilities (Cache, WorkerPool)
├── hardhat.config.ts    # Hardhat configuration
├── package.json         # Dependencies
├── tsconfig.json        # TypeScript config
└── README.md
```

## 🔗 Important Links

- [Aave V3 on Base](https://docs.aave.com/developers/deployed-contracts/v3-market-addresses)
- [Base Network Docs](https://docs.base.org/)
- [Flashbots Docs](https://docs.flashbots.net/flashbots-protect/rpc)
- [0x API Docs](https://docs.0x.org/)

## ⚠️ Disclaimer

This software is provided for educational and research purposes only. Use at your own risk. Cryptocurrency trading involves substantial risk of loss. The authors are not responsible for any financial losses incurred.

## 📄 License

MIT License - See LICENSE file for details

## 🤝 Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## 💬 Support

For questions or support, please open an issue on GitHub.

---

**Built with ❤️ by NinjaTech AI**