# ⚡ Base Mainnet Deployment Guide

## Complete step-by-step instructions for deploying the Flash Loan Arbitrage system to Base mainnet.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Environment Setup](#2-environment-setup)
3. [Wallet Preparation](#3-wallet-preparation)
4. [Smart Contract Deployment](#4-smart-contract-deployment)
5. [Contract Verification](#5-contract-verification)
6. [Post-Deployment Configuration](#6-post-deployment-configuration)
7. [Engine Configuration](#7-engine-configuration)
8. [Launch the Engine](#8-launch-the-engine)
9. [Monitoring & Operations](#9-monitoring--operations)
10. [Emergency Procedures](#10-emergency-procedures)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Prerequisites

### Required Software

```bash
# Install Foundry (Solidity toolchain)
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Verify Foundry installation
forge --version
cast --version

# Install Node.js 20+ and npm
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs

# Verify Node.js
node --version   # Should be v20+
npm --version
```

### Required Accounts & API Keys

| Service | Purpose | Get It At |
|---------|---------|-----------|
| **Alchemy / QuickNode** | Base RPC (HTTP + WSS) | https://www.alchemy.com or https://www.quicknode.com |
| **BaseScan** | Contract verification | https://basescan.org/register |
| **0x API** | Aggregator quotes | https://dashboard.0x.org |

### Required Funds

| Item | Amount | Purpose |
|------|--------|---------|
| **Deployer wallet** | ~0.005 ETH on Base | Contract deployment gas |
| **Executor wallet** | ~0.01 ETH on Base | Transaction execution gas |

> ⚠️ **SECURITY**: Use separate wallets for deployer (cold) and executor (hot). The executor wallet only needs enough ETH for gas — all profits stay in the contract.

---

## 2. Environment Setup

### Clone and Install Dependencies

```bash
cd base-arb-engine

# Install Foundry dependencies
forge install OpenZeppelin/openzeppelin-contracts --no-commit
forge install foundry-rs/forge-std --no-commit

# Install Node.js dependencies
npm install

# Build TypeScript
npm run build
```

### Configure Environment Variables

```bash
# Copy the example env file
cp .env.example .env
```

Now edit `.env` with your actual values:

```bash
# ═══════════════════════════════════════════════════════════════════
#                    BASE CHAIN RPC CONFIGURATION
# ═══════════════════════════════════════════════════════════════════
# Use a premium RPC for production (Alchemy, QuickNode, Infura)
# Free RPCs will rate-limit and miss opportunities
BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
BASE_RPC_WSS=wss://base-mainnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
BASE_RPC_BACKUP=https://base.llamarpc.com
BASE_CHAIN_ID=8453

# ═══════════════════════════════════════════════════════════════════
#                      WALLET CONFIGURATION
# ═══════════════════════════════════════════════════════════════════
# DEPLOYER: Cold wallet, only used for deployment and admin
DEPLOYER_PRIVATE_KEY=0xYOUR_DEPLOYER_PRIVATE_KEY

# EXECUTOR: Hot wallet, used by the engine to submit trades
EXECUTOR_PRIVATE_KEY=0xYOUR_EXECUTOR_PRIVATE_KEY
EXECUTOR_ADDRESS=0xYOUR_EXECUTOR_PUBLIC_ADDRESS

# ═══════════════════════════════════════════════════════════════════
#                      0x API CONFIGURATION
# ═══════════════════════════════════════════════════════════════════
ZEROX_API_KEY=YOUR_0X_API_KEY
ZEROX_API_URL=https://api.0x.org

# ═══════════════════════════════════════════════════════════════════
#                    ENGINE CONFIGURATION
# ═══════════════════════════════════════════════════════════════════
MIN_PROFIT_BPS=5
MIN_PROFIT_USD=0.50
MAX_GAS_PRICE_GWEI=0.5
POLL_INTERVAL_MS=200
MAX_FLASH_LOAN_USD=500000
SLIPPAGE_BPS=30

# ═══════════════════════════════════════════════════════════════════
#                    MONITORING & LOGGING
# ═══════════════════════════════════════════════════════════════════
LOG_LEVEL=info
METRICS_PORT=9090
BASESCAN_API_KEY=YOUR_BASESCAN_API_KEY
```

---

## 3. Wallet Preparation

### Generate Wallets (if needed)

```bash
# Generate deployer wallet
cast wallet new
# Save the private key and address securely

# Generate executor wallet
cast wallet new
# Save the private key and address securely
```

### Fund Wallets on Base

```bash
# Check deployer balance
cast balance --rpc-url $BASE_RPC_URL $DEPLOYER_ADDRESS --ether

# Check executor balance
cast balance --rpc-url $BASE_RPC_URL $EXECUTOR_ADDRESS --ether
```

You need ETH on Base chain. Bridge from Ethereum mainnet:
- **Official Base Bridge**: https://bridge.base.org
- **Or use Coinbase** to withdraw directly to Base

### Verify Wallet Access

```bash
# Source env vars
source .env

# Verify deployer can sign
cast wallet address --private-key $DEPLOYER_PRIVATE_KEY

# Verify executor can sign
cast wallet address --private-key $EXECUTOR_PRIVATE_KEY
```

---

## 4. Smart Contract Deployment

### Step 4a: Compile Contracts

```bash
# Clean and compile
forge clean
forge build

# Verify compilation succeeded
echo "Compilation output:"
ls -la out/FlashLoanArbitrage.sol/
```

Expected output:
```
FlashLoanArbitrage.json
```

### Step 4b: Run Tests Against Base Fork

```bash
# Run full test suite against Base mainnet fork
forge test \
  --rpc-url $BASE_RPC_URL \
  -vvv \
  --gas-report

# Expected: All tests pass
```

### Step 4c: Dry Run Deployment (Simulation)

```bash
# Simulate deployment without broadcasting
forge script scripts/Deploy.s.sol:DeployFlashLoanArbitrage \
  --rpc-url $BASE_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  -vvvv
```

Check the output for:
- Contract address (predicted)
- Gas estimate
- No errors

### Step 4d: Deploy to Base Mainnet

```bash
# LIVE DEPLOYMENT — This costs real ETH
forge script scripts/Deploy.s.sol:DeployFlashLoanArbitrage \
  --rpc-url $BASE_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast \
  --verify \
  --etherscan-api-key $BASESCAN_API_KEY \
  -vvvv
```

**Save the deployed contract address from the output!**

```bash
# Add to .env
echo "ARB_CONTRACT_ADDRESS=0xYOUR_DEPLOYED_ADDRESS" >> .env
```

### Step 4e: Verify Deployment On-Chain

```bash
source .env

# Check contract exists
cast code --rpc-url $BASE_RPC_URL $ARB_CONTRACT_ADDRESS

# Check owner
cast call --rpc-url $BASE_RPC_URL $ARB_CONTRACT_ADDRESS "owner()(address)"

# Check executor
cast call --rpc-url $BASE_RPC_URL $ARB_CONTRACT_ADDRESS "executor()(address)"

# Check not paused
cast call --rpc-url $BASE_RPC_URL $ARB_CONTRACT_ADDRESS "paused()(bool)"

# Check flash loan premium
cast call --rpc-url $BASE_RPC_URL $ARB_CONTRACT_ADDRESS "getFlashLoanPremium()(uint128)"

# Check min profit bps
cast call --rpc-url $BASE_RPC_URL $ARB_CONTRACT_ADDRESS "minProfitBps()(uint256)"
```

---

## 5. Contract Verification

If verification didn't happen automatically during deployment:

```bash
# Manual verification on BaseScan
forge verify-contract \
  $ARB_CONTRACT_ADDRESS \
  contracts/FlashLoanArbitrage.sol:FlashLoanArbitrage \
  --chain-id 8453 \
  --etherscan-api-key $BASESCAN_API_KEY \
  --constructor-args $(cast abi-encode "constructor(address,uint256)" $EXECUTOR_ADDRESS 5) \
  --watch
```

Verify on BaseScan:
```
https://basescan.org/address/YOUR_CONTRACT_ADDRESS#code
```

---

## 6. Post-Deployment Configuration

### Step 6a: Verify All DEX Router Approvals Work

The contract uses `ensureApproval()` which sets max approval on first swap. No pre-approval needed.

### Step 6b: Test a Direct Swap (Optional Safety Check)

```bash
# Send a tiny amount of WETH to the contract for testing
# First, wrap some ETH to WETH
cast send --rpc-url $BASE_RPC_URL \
  --private-key $EXECUTOR_PRIVATE_KEY \
  0x4200000000000000000000000000000000000006 \
  --value 0.001ether

# Transfer WETH to contract
cast send --rpc-url $BASE_RPC_URL \
  --private-key $EXECUTOR_PRIVATE_KEY \
  0x4200000000000000000000000000000000000006 \
  "transfer(address,uint256)" \
  $ARB_CONTRACT_ADDRESS \
  1000000000000000

# Check contract WETH balance
cast call --rpc-url $BASE_RPC_URL \
  $ARB_CONTRACT_ADDRESS \
  "getBalance(address)(uint256)" \
  0x4200000000000000000000000000000000000006

# Withdraw test funds back
cast send --rpc-url $BASE_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  $ARB_CONTRACT_ADDRESS \
  "emergencyWithdraw(address,uint256)" \
  0x4200000000000000000000000000000000000006 \
  1000000000000000
```

### Step 6c: Adjust Parameters (Optional)

```bash
# Change minimum profit threshold (in basis points)
# Example: set to 10 bps (0.1%)
cast send --rpc-url $BASE_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  $ARB_CONTRACT_ADDRESS \
  "setMinProfitBps(uint256)" \
  10

# Change executor address
cast send --rpc-url $BASE_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  $ARB_CONTRACT_ADDRESS \
  "setExecutor(address)" \
  0xNEW_EXECUTOR_ADDRESS

# Pause contract (emergency)
cast send --rpc-url $BASE_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  $ARB_CONTRACT_ADDRESS \
  "setPaused(bool)" \
  true
```

---

## 7. Engine Configuration

### Step 7a: Create Log Directory

```bash
mkdir -p logs
```

### Step 7b: Build TypeScript Engine

```bash
npm run build
```

### Step 7c: Validate Configuration

```bash
# Quick validation script
node -e "
const dotenv = require('dotenv');
dotenv.config();
const required = [
  'BASE_RPC_URL', 'BASE_RPC_WSS', 'EXECUTOR_PRIVATE_KEY',
  'ARB_CONTRACT_ADDRESS', 'ZEROX_API_KEY'
];
const missing = required.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error('❌ Missing env vars:', missing.join(', '));
  process.exit(1);
} else {
  console.log('✅ All required env vars present');
  console.log('  RPC:', process.env.BASE_RPC_URL?.substring(0, 40) + '...');
  console.log('  Contract:', process.env.ARB_CONTRACT_ADDRESS);
  console.log('  Min Profit:', process.env.MIN_PROFIT_USD, 'USD');
  console.log('  Poll Interval:', process.env.POLL_INTERVAL_MS, 'ms');
}
"
```

---

## 8. Launch the Engine

### Option A: Direct Launch (Foreground)

```bash
# Source environment
source .env

# Start the engine
npm start
```

### Option B: Background with tmux (Recommended for VPS)

```bash
# Create a new tmux session
tmux new-session -d -s arb-engine

# Start the engine inside tmux
tmux send-keys -t arb-engine "cd $(pwd) && source .env && npm start" Enter

# Attach to watch logs
tmux attach -t arb-engine

# Detach: Ctrl+B then D
# Reattach later: tmux attach -t arb-engine
```

### Option C: systemd Service (Production)

```bash
# Create systemd service file
sudo tee /etc/systemd/system/arb-engine.service > /dev/null << 'EOF'
[Unit]
Description=Base Flash Loan Arbitrage Engine
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=/path/to/base-arb-engine
EnvironmentFile=/path/to/base-arb-engine/.env
ExecStart=/usr/bin/node dist/src/engine/ArbEngine.js
Restart=always
RestartSec=10
StandardOutput=append:/path/to/base-arb-engine/logs/stdout.log
StandardError=append:/path/to/base-arb-engine/logs/stderr.log

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/path/to/base-arb-engine/logs

[Install]
WantedBy=multi-user.target
EOF

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable arb-engine
sudo systemctl start arb-engine

# Check status
sudo systemctl status arb-engine

# View logs
sudo journalctl -u arb-engine -f
```

### Option D: Docker (Production)

```bash
# Create Dockerfile
cat > Dockerfile << 'EOF'
FROM node:20-slim

WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist/ ./dist/
COPY .env ./

CMD ["node", "dist/src/engine/ArbEngine.js"]
EOF

# Build and run
docker build -t arb-engine .
docker run -d \
  --name arb-engine \
  --restart unless-stopped \
  --env-file .env \
  -v $(pwd)/logs:/app/logs \
  arb-engine

# View logs
docker logs -f arb-engine
```

---

## 9. Monitoring & Operations

### Watch Live Logs

```bash
# All logs
tail -f logs/arb-engine.log

# Only trades
tail -f logs/arb-trades.log

# Only errors
tail -f logs/arb-errors.log

# Filter for opportunities
tail -f logs/arb-engine.log | grep "OPPORTUNITY"

# Filter for executions
tail -f logs/arb-engine.log | grep "EXECUTED"
```

### Check Contract State

```bash
# Total executions
cast call --rpc-url $BASE_RPC_URL $ARB_CONTRACT_ADDRESS "totalExecutions()(uint256)"

# Check profits (WETH balance)
cast call --rpc-url $BASE_RPC_URL $ARB_CONTRACT_ADDRESS \
  "getBalance(address)(uint256)" \
  0x4200000000000000000000000000000000000006

# Check profits (USDC balance)
cast call --rpc-url $BASE_RPC_URL $ARB_CONTRACT_ADDRESS \
  "getBalance(address)(uint256)" \
  0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913

# Check all token balances at once
cast call --rpc-url $BASE_RPC_URL $ARB_CONTRACT_ADDRESS \
  "getBalances(address[])(uint256[])" \
  "[0x4200000000000000000000000000000000000006,0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913,0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA]"
```

### Withdraw Profits

```bash
# Withdraw all WETH profits
cast send --rpc-url $BASE_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  $ARB_CONTRACT_ADDRESS \
  "withdrawProfits(address)" \
  0x4200000000000000000000000000000000000006

# Withdraw all USDC profits
cast send --rpc-url $BASE_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  $ARB_CONTRACT_ADDRESS \
  "withdrawProfits(address)" \
  0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913

# Batch withdraw all profits
cast send --rpc-url $BASE_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  $ARB_CONTRACT_ADDRESS \
  "batchWithdrawProfits(address[])" \
  "[0x4200000000000000000000000000000000000006,0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913,0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA,0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22,0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452]"
```

### Check Executor Gas Balance

```bash
# Check executor ETH balance
cast balance --rpc-url $BASE_RPC_URL $EXECUTOR_ADDRESS --ether

# Top up executor if low (from deployer)
cast send --rpc-url $BASE_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  $EXECUTOR_ADDRESS \
  --value 0.01ether
```

### Health Check Script

```bash
cat > health_check.sh << 'SCRIPT'
#!/bin/bash
source .env

echo "═══════════════════════════════════════════════"
echo "  ARBITRAGE ENGINE HEALTH CHECK"
echo "═══════════════════════════════════════════════"

# Check RPC
BLOCK=$(cast block-number --rpc-url $BASE_RPC_URL 2>/dev/null)
if [ $? -eq 0 ]; then
    echo "✅ RPC connected (block #$BLOCK)"
else
    echo "❌ RPC connection failed"
fi

# Check contract
PAUSED=$(cast call --rpc-url $BASE_RPC_URL $ARB_CONTRACT_ADDRESS "paused()(bool)" 2>/dev/null)
echo "📋 Contract paused: $PAUSED"

EXECUTIONS=$(cast call --rpc-url $BASE_RPC_URL $ARB_CONTRACT_ADDRESS "totalExecutions()(uint256)" 2>/dev/null)
echo "📊 Total executions: $EXECUTIONS"

# Check executor balance
EXEC_BAL=$(cast balance --rpc-url $BASE_RPC_URL $EXECUTOR_ADDRESS --ether 2>/dev/null)
echo "💰 Executor balance: $EXEC_BAL ETH"

# Check WETH profits
WETH_BAL=$(cast call --rpc-url $BASE_RPC_URL $ARB_CONTRACT_ADDRESS "getBalance(address)(uint256)" 0x4200000000000000000000000000000000000006 2>/dev/null)
echo "💎 Contract WETH: $WETH_BAL"

# Check USDC profits
USDC_BAL=$(cast call --rpc-url $BASE_RPC_URL $ARB_CONTRACT_ADDRESS "getBalance(address)(uint256)" 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 2>/dev/null)
echo "💵 Contract USDC: $USDC_BAL"

# Check engine process
if pgrep -f "ArbEngine" > /dev/null; then
    echo "✅ Engine process running"
else
    echo "❌ Engine process NOT running"
fi

# Check recent logs
LAST_LOG=$(tail -1 logs/arb-engine.log 2>/dev/null)
echo "📝 Last log: $LAST_LOG"

echo "═══════════════════════════════════════════════"
SCRIPT

chmod +x health_check.sh
```

Run it:
```bash
./health_check.sh
```

---

## 10. Emergency Procedures

### Pause the Contract (Stop All Trades)

```bash
# IMMEDIATE PAUSE — no new trades will execute
cast send --rpc-url $BASE_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  $ARB_CONTRACT_ADDRESS \
  "setPaused(bool)" \
  true

# Verify paused
cast call --rpc-url $BASE_RPC_URL $ARB_CONTRACT_ADDRESS "paused()(bool)"
```

### Stop the Engine Process

```bash
# If running in tmux
tmux send-keys -t arb-engine C-c

# If running as systemd service
sudo systemctl stop arb-engine

# If running in Docker
docker stop arb-engine

# Nuclear option: kill all node processes
pkill -f "ArbEngine"
```

### Emergency Withdraw All Funds

```bash
# Withdraw ALL WETH
WETH_BAL=$(cast call --rpc-url $BASE_RPC_URL $ARB_CONTRACT_ADDRESS \
  "getBalance(address)(uint256)" 0x4200000000000000000000000000000000000006)

cast send --rpc-url $BASE_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  $ARB_CONTRACT_ADDRESS \
  "emergencyWithdraw(address,uint256)" \
  0x4200000000000000000000000000000000000006 \
  $WETH_BAL

# Withdraw ALL USDC
USDC_BAL=$(cast call --rpc-url $BASE_RPC_URL $ARB_CONTRACT_ADDRESS \
  "getBalance(address)(uint256)" 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)

cast send --rpc-url $BASE_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  $ARB_CONTRACT_ADDRESS \
  "emergencyWithdraw(address,uint256)" \
  0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  $USDC_BAL
```

### Resume After Emergency

```bash
# 1. Unpause contract
cast send --rpc-url $BASE_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  $ARB_CONTRACT_ADDRESS \
  "setPaused(bool)" \
  false

# 2. Restart engine
npm start
```

---

## 11. Troubleshooting

### Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| `Wrong chain!` | RPC pointing to wrong network | Verify `BASE_RPC_URL` is Base mainnet (chain 8453) |
| `not executor` | Wrong wallet executing | Check `EXECUTOR_PRIVATE_KEY` matches `EXECUTOR_ADDRESS` |
| `Gas estimation failed` | Trade no longer profitable | Normal — market moved. Engine will find next opportunity |
| `Simulation failed` | Stale quote / frontrun | Normal — increase `POLL_INTERVAL_MS` or decrease `SLIPPAGE_BPS` |
| `0x API rate limited` | Too many 0x requests | Upgrade 0x plan or increase rate limit delay |
| `Mempool monitor failed` | WSS connection dropped | Non-critical — engine continues with polling. Check WSS URL |
| `Pool discovery failed` | RPC rate limiting on event queries | Non-critical — falls back to static pairs. Use premium RPC |
| `nonce too low` | Pending tx conflict | Engine auto-resets nonce. If persistent, restart engine |

### Debug Mode

```bash
# Run with verbose logging
LOG_LEVEL=debug npm start

# Run with trace-level Foundry output
forge test --rpc-url $BASE_RPC_URL -vvvvv
```

### Verify Contract Interactions Manually

```bash
# Simulate a flash loan call (will revert but shows gas estimate)
cast estimate --rpc-url $BASE_RPC_URL \
  --from $EXECUTOR_ADDRESS \
  $ARB_CONTRACT_ADDRESS \
  "executeArbitrage(address,uint256,bytes)" \
  0x4200000000000000000000000000000000000006 \
  1000000000000000000 \
  0x

# Check Aave pool flash loan premium
cast call --rpc-url $BASE_RPC_URL \
  0xA238Dd80C259a72e81d7e4664a9801593F98d1c5 \
  "FLASHLOAN_PREMIUM_TOTAL()(uint128)"

# Check Aave oracle ETH price
cast call --rpc-url $BASE_RPC_URL \
  0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156 \
  "getAssetPrice(address)(uint256)" \
  0x4200000000000000000000000000000000000006
```

---

## Quick Reference: Complete Deployment Sequence

```bash
# 1. Setup
cd base-arb-engine
forge install OpenZeppelin/openzeppelin-contracts --no-commit
forge install foundry-rs/forge-std --no-commit
npm install
cp .env.example .env
# Edit .env with your keys

# 2. Compile & Test
source .env
forge build
forge test --rpc-url $BASE_RPC_URL -vvv

# 3. Deploy
forge script scripts/Deploy.s.sol:DeployFlashLoanArbitrage \
  --rpc-url $BASE_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast --verify \
  --etherscan-api-key $BASESCAN_API_KEY -vvvv

# 4. Save contract address to .env
echo "ARB_CONTRACT_ADDRESS=0x_FROM_OUTPUT" >> .env
source .env

# 5. Verify deployment
cast call --rpc-url $BASE_RPC_URL $ARB_CONTRACT_ADDRESS "owner()(address)"
cast call --rpc-url $BASE_RPC_URL $ARB_CONTRACT_ADDRESS "executor()(address)"

# 6. Build & Launch engine
npm run build
mkdir -p logs
tmux new-session -d -s arb-engine "source .env && npm start"
tmux attach -t arb-engine

# 7. Monitor
tail -f logs/arb-engine.log
./health_check.sh
```