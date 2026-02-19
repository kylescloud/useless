import { ethers } from "ethers";
import dotenv from "dotenv";
import { StrategyManager, ArbOpportunity } from "../strategies/StrategyManager";
import { ExecutionManager, ExecutionResult } from "../execution/ExecutionManager";
import { MempoolMonitor } from "../monitoring/MempoolMonitor";
import { AAVE, TOKENS, BASE_CHAIN_ID } from "../config/addresses";
import { AAVE_POOL_ABI, ERC20_ABI } from "../config/abis";
import { logger, TradeLogger } from "../utils/Logger";

dotenv.config();

// ═══════════════════════════════════════════════════════════════════
//                    MAIN ARBITRAGE ENGINE
//  Production-grade orchestrator for Aave V3 flash loan arbitrage
//  on Base chain with multi-strategy, multi-DEX support
// ═══════════════════════════════════════════════════════════════════

interface EngineConfig {
    rpcUrl: string;
    rpcWss: string;
    rpcBackup: string;
    executorPrivateKey: string;
    contractAddress: string;
    zeroExApiKey: string;
    minProfitUsd: number;
    maxGasPriceGwei: number;
    pollIntervalMs: number;
    slippageBps: number;
    maxConcurrentOpps: number;
}

export class ArbEngine {
    private config: EngineConfig;
    private provider: ethers.JsonRpcProvider;
    private backupProvider: ethers.JsonRpcProvider;
    private strategyManager: StrategyManager;
    private executionManager: ExecutionManager;
    private mempoolMonitor: MempoolMonitor;
    private isRunning: boolean = false;
    private cycleCount: number = 0;
    private startTime: number = 0;

    // Stats
    private totalOpportunities: number = 0;
    private totalExecuted: number = 0;
    private totalSuccessful: number = 0;
    private totalProfitUsd: number = 0;
    private cycleTimes: number[] = [];

    constructor(config: EngineConfig) {
        this.config = config;

        // Initialize providers
        this.provider = new ethers.JsonRpcProvider(config.rpcUrl, {
            chainId: BASE_CHAIN_ID,
            name: "base",
        });
        this.backupProvider = new ethers.JsonRpcProvider(config.rpcBackup, {
            chainId: BASE_CHAIN_ID,
            name: "base-backup",
        });

        // Initialize strategy manager
        this.strategyManager = new StrategyManager(
            this.provider,
            config.contractAddress,
            config.zeroExApiKey,
            {
                minProfitUsd: config.minProfitUsd,
                slippageBps: config.slippageBps,
                flashLoanPremiumBps: AAVE.FLASHLOAN_PREMIUM_BPS,
            }
        );

        // Initialize execution manager
        this.executionManager = new ExecutionManager(
            this.provider,
            config.executorPrivateKey,
            config.contractAddress,
            this.strategyManager,
            config.maxGasPriceGwei
        );

        // Initialize mempool monitor
        this.mempoolMonitor = new MempoolMonitor(this.provider, config.rpcWss);
    }

    // ═══════════════════════════════════════════════════════════════
    //                    ENGINE LIFECYCLE
    // ═══════════════════════════════════════════════════════════════

    async start(): Promise<void> {
        logger.info("═══════════════════════════════════════════════════════");
        logger.info("  BASE CHAIN FLASH LOAN ARBITRAGE ENGINE v1.0.0");
        logger.info("  Aave V3 + 10 DEXs + 0x Aggregator");
        logger.info("═══════════════════════════════════════════════════════");

        this.isRunning = true;
        this.startTime = Date.now();

        // 1. Verify connectivity
        await this.verifyConnectivity();

        // 2. Verify contract deployment
        await this.verifyContract();

        // 3. Log borrowable assets
        await this.logBorrowableAssets();

        // 4. Start mempool monitor
        try {
            this.mempoolMonitor.onSwap((swap) => {
                logger.debug(`📡 Pending swap: ${swap.dex} ${swap.tokenIn.substring(0, 10)}→${swap.tokenOut.substring(0, 10)} ${swap.amountIn}`);
            });
            await this.mempoolMonitor.start();
        } catch (error: any) {
            logger.warn(`Mempool monitor failed to start (non-critical): ${error.message}`);
        }

        // 5. Start dynamic pool discovery
        try {
            const ethPrice = await this.getEthPrice();
            const btcPrice = await this.getBtcPrice();
            await this.strategyManager.startDiscovery(ethPrice, btcPrice);
            const stats = this.strategyManager.getDiscoveryStats();
            logger.info(`🔎 Pool discovery: ${stats.totalPools} total → ${stats.activePools} active → ${stats.arbitrageablePairs} arb pairs → ${stats.triangularPaths} triangles`);
        } catch (error: any) {
            logger.warn(`Pool discovery failed to start (non-critical, using static pairs): ${error.message}`);
        }

        // 6. Start main loop
        logger.info(`\n🚀 Engine started! Polling every ${this.config.pollIntervalMs}ms`);
        logger.info(`   Min profit: $${this.config.minProfitUsd} | Max gas: ${this.config.maxGasPriceGwei} gwei | Slippage: ${this.config.slippageBps}bps\n`);

        await this.mainLoop();
    }

    async stop(): Promise<void> {
        logger.info("🛑 Stopping engine...");
        this.isRunning = false;
        await this.mempoolMonitor.stop();
        this.strategyManager.stopDiscovery();
        this.logFinalStats();
    }

    // ═══════════════════════════════════════════════════════════════
    //                    MAIN EXECUTION LOOP
    // ═══════════════════════════════════════════════════════════════

    private async mainLoop(): Promise<void> {
        while (this.isRunning) {
            const cycleStart = Date.now();
            this.cycleCount++;

            try {
                // Update price feeds
                await this.updatePrices();

                // Scan for opportunities across all strategies
                const opportunities = await this.strategyManager.scanForOpportunities();
                this.totalOpportunities += opportunities.length;

                if (opportunities.length > 0) {
                    logger.info(`\n🔍 Cycle #${this.cycleCount}: Found ${opportunities.length} opportunities`);

                    // Execute the best opportunity (or top N if concurrent)
                    const toExecute = opportunities.slice(0, this.config.maxConcurrentOpps);

                    for (const opp of toExecute) {
                        this.totalExecuted++;

                        const result = await this.executionManager.execute(opp);

                        if (result.success) {
                            this.totalSuccessful++;
                            this.totalProfitUsd += opp.netProfitUsd;
                        }
                    }
                }

                const cycleDuration = Date.now() - cycleStart;
                this.cycleTimes.push(cycleDuration);

                // Keep only last 100 cycle times
                if (this.cycleTimes.length > 100) {
                    this.cycleTimes = this.cycleTimes.slice(-100);
                }

                // Log cycle stats periodically
                if (this.cycleCount % 50 === 0) {
                    this.logPeriodicStats();
                }

                // Wait for next cycle
                const elapsed = Date.now() - cycleStart;
                const waitTime = Math.max(0, this.config.pollIntervalMs - elapsed);
                if (waitTime > 0) {
                    await new Promise((resolve) => setTimeout(resolve, waitTime));
                }
            } catch (error: any) {
                logger.error(`Cycle #${this.cycleCount} error: ${error.message}`);

                // Reset nonce on error
                try {
                    await this.executionManager.resetNonce();
                } catch { /* ignore */ }

                // Back off on repeated errors
                await new Promise((resolve) => setTimeout(resolve, 2000));
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //                    PRICE FEEDS
    // ═══════════════════════════════════════════════════════════════

    private async updatePrices(): Promise<void> {
        try {
            const ethPriceUsd = await this.getEthPrice();
            const btcPriceUsd = await this.getBtcPrice();
            this.strategyManager.updatePrices(ethPriceUsd, btcPriceUsd);
        } catch (error: any) {
            logger.debug(`Price update failed: ${error.message}`);
        }
    }

    private async getEthPrice(): Promise<number> {
        try {
            const oracle = new ethers.Contract(
                AAVE.ORACLE,
                ["function getAssetPrice(address asset) external view returns (uint256)"],
                this.provider
            );
            const ethPrice = await oracle.getAssetPrice(TOKENS.WETH.address);
            return Number(ethPrice) / 1e8; // Aave oracle: 8 decimals
        } catch {
            return 2500; // Fallback
        }
    }

    private async getBtcPrice(): Promise<number> {
        try {
            const oracle = new ethers.Contract(
                AAVE.ORACLE,
                ["function getAssetPrice(address asset) external view returns (uint256)"],
                this.provider
            );
            const btcPrice = await oracle.getAssetPrice(TOKENS.cbBTC.address);
            return Number(btcPrice) / 1e8; // Aave oracle: 8 decimals
        } catch {
            return 60000; // Fallback
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //                    VERIFICATION
    // ═══════════════════════════════════════════════════════════════

    private async verifyConnectivity(): Promise<void> {
        const network = await this.provider.getNetwork();
        if (Number(network.chainId) !== BASE_CHAIN_ID) {
            throw new Error(`Wrong chain! Expected ${BASE_CHAIN_ID}, got ${network.chainId}`);
        }

        const blockNumber = await this.provider.getBlockNumber();
        logger.info(`✅ Connected to Base chain (block #${blockNumber})`);

        const feeData = await this.provider.getFeeData();
        logger.info(`⛽ Gas price: ${ethers.formatUnits(feeData.gasPrice || 0n, "gwei")} gwei`);
    }

    private async verifyContract(): Promise<void> {
        try {
            const code = await this.provider.getCode(this.config.contractAddress);
            if (code === "0x") {
                logger.warn(`⚠️  Contract not deployed at ${this.config.contractAddress}`);
                logger.warn("   Engine will run in simulation mode (no actual trades)");
                return;
            }

            const contract = new ethers.Contract(
                this.config.contractAddress,
                [
                    "function owner() view returns (address)",
                    "function executor() view returns (address)",
                    "function paused() view returns (bool)",
                    "function getFlashLoanPremium() view returns (uint128)",
                ],
                this.provider
            );

            const [owner, executor, paused, premium] = await Promise.all([
                contract.owner(),
                contract.executor(),
                contract.paused(),
                contract.getFlashLoanPremium(),
            ]);

            logger.info(`✅ Contract verified at ${this.config.contractAddress}`);
            logger.info(`   Owner: ${owner}`);
            logger.info(`   Executor: ${executor}`);
            logger.info(`   Paused: ${paused}`);
            logger.info(`   Flash Loan Premium: ${premium} bps`);
        } catch (error: any) {
            logger.warn(`Contract verification failed: ${error.message}`);
        }
    }

    private async logBorrowableAssets(): Promise<void> {
        logger.info("\n📋 Aave V3 Base - Borrowable Assets:");
        logger.info("─".repeat(60));

        for (const [symbol, token] of Object.entries(TOKENS)) {
            try {
                const erc20 = new ethers.Contract(token.aToken, ERC20_ABI, this.provider);
                const supply = await erc20.balanceOf(token.aToken).catch(() => 0n);
                logger.info(`   ${symbol.padEnd(10)} ${token.address.substring(0, 10)}... (${token.decimals} dec)`);
            } catch {
                logger.info(`   ${symbol.padEnd(10)} ${token.address.substring(0, 10)}... (${token.decimals} dec)`);
            }
        }
        logger.info("─".repeat(60));
    }

    // ═══════════════════════════════════════════════════════════════
    //                    STATS & LOGGING
    // ═══════════════════════════════════════════════════════════════

    private logPeriodicStats(): void {
        const uptime = this.formatUptime(Date.now() - this.startTime);
        const avgCycleTime = this.cycleTimes.length > 0
            ? Math.round(this.cycleTimes.reduce((a, b) => a + b, 0) / this.cycleTimes.length)
            : 0;

        const execStats = this.executionManager.getStats();
        const monitorStatus = this.mempoolMonitor.getStatus();
        const discoveryStats = this.strategyManager.getDiscoveryStats();

        TradeLogger.logStats({
            totalProfit: `$${this.totalProfitUsd.toFixed(4)}`,
            totalTrades: this.totalExecuted,
            successRate: execStats.successRate,
            uptime,
            avgCycleTime,
        });

        TradeLogger.logCycle({
            cycleNum: this.cycleCount,
            pairsScanned: this.totalOpportunities,
            opportunities: this.totalOpportunities,
            executed: this.totalExecuted,
            duration: avgCycleTime,
        });

        if (discoveryStats) {
            logger.info(`🔎 Discovery: ${discoveryStats.totalPools} pools | ${discoveryStats.activePools} active | ${discoveryStats.arbitrageablePairs} arb pairs | ${discoveryStats.triangularPaths} triangles | Last block: ${discoveryStats.lastScanBlock}`);
        }
    }

    private logFinalStats(): void {
        const discoveryStats = this.strategyManager.getDiscoveryStats();

        logger.info("\n═══════════════════════════════════════════════════════");
        logger.info("                    FINAL STATISTICS");
        logger.info("═══════════════════════════════════════════════════════");
        logger.info(`  Uptime:           ${this.formatUptime(Date.now() - this.startTime)}`);
        logger.info(`  Total Cycles:     ${this.cycleCount}`);
        logger.info(`  Opportunities:    ${this.totalOpportunities}`);
        logger.info(`  Executed:         ${this.totalExecuted}`);
        logger.info(`  Successful:       ${this.totalSuccessful}`);
        logger.info(`  Success Rate:     ${this.totalExecuted > 0 ? ((this.totalSuccessful / this.totalExecuted) * 100).toFixed(1) : 0}%`);
        logger.info(`  Total Profit:     $${this.totalProfitUsd.toFixed(4)}`);
        if (discoveryStats) {
            logger.info("───────────────────────────────────────────────────────");
            logger.info(`  Pools Discovered: ${discoveryStats.totalPools}`);
            logger.info(`  Active Pools:     ${discoveryStats.activePools}`);
            logger.info(`  Arb Pairs:        ${discoveryStats.arbitrageablePairs}`);
            logger.info(`  Tri Paths:        ${discoveryStats.triangularPaths}`);
        }
        logger.info("═══════════════════════════════════════════════════════\n");
    }

    private formatUptime(ms: number): string {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
        if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
    }
}

// ═══════════════════════════════════════════════════════════════════
//                    ENTRY POINT
// ═══════════════════════════════════════════════════════════════════

async function main() {
    dotenv.config();

    const config: EngineConfig = {
        rpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",
        rpcWss: process.env.BASE_RPC_WSS || "",
        rpcBackup: process.env.BASE_RPC_BACKUP || "https://base.llamarpc.com",
        executorPrivateKey: process.env.EXECUTOR_PRIVATE_KEY || "",
        contractAddress: process.env.ARB_CONTRACT_ADDRESS || ethers.ZeroAddress,
        zeroExApiKey: process.env.ZEROX_API_KEY || "",
        minProfitUsd: parseFloat(process.env.MIN_PROFIT_USD || "0.50"),
        maxGasPriceGwei: parseFloat(process.env.MAX_GAS_PRICE_GWEI || "0.5"),
        pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || "200"),
        slippageBps: parseInt(process.env.SLIPPAGE_BPS || "30"),
        maxConcurrentOpps: 1,
    };

    if (!config.executorPrivateKey) {
        logger.error("EXECUTOR_PRIVATE_KEY is required");
        process.exit(1);
    }

    const engine = new ArbEngine(config);

    // Graceful shutdown
    process.on("SIGINT", async () => {
        logger.info("\nReceived SIGINT, shutting down gracefully...");
        await engine.stop();
        process.exit(0);
    });

    process.on("SIGTERM", async () => {
        logger.info("\nReceived SIGTERM, shutting down gracefully...");
        await engine.stop();
        process.exit(0);
    });

    process.on("uncaughtException", (error) => {
        logger.error(`Uncaught exception: ${error.message}`);
        logger.error(error.stack || "");
    });

    process.on("unhandledRejection", (reason) => {
        logger.error(`Unhandled rejection: ${reason}`);
    });

    await engine.start();
}

// Run if executed directly
main().catch((error) => {
    logger.error(`Fatal error: ${error.message}`);
    process.exit(1);
});

interface EngineConfig {
    rpcUrl: string;
    rpcWss: string;
    rpcBackup: string;
    executorPrivateKey: string;
    contractAddress: string;
    zeroExApiKey: string;
    minProfitUsd: number;
    maxGasPriceGwei: number;
    pollIntervalMs: number;
    slippageBps: number;
    maxConcurrentOpps: number;
}