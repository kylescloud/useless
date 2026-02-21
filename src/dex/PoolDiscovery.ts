import { ethers } from "ethers";
import { DEXES, TOKENS, DEXId, type TokenInfo } from "../config/addresses";
import {
    UNISWAP_V3_FACTORY_ABI,
    UNISWAP_V2_FACTORY_ABI,
    UNISWAP_V3_POOL_ABI,
    UNISWAP_V2_PAIR_ABI,
    ERC20_ABI,
} from "../config/abis";
import { logger } from "../utils/Logger";
import * as fs from "fs";
import * as path from "path";

// ═══════════════════════════════════════════════════════════════════════════════
//                    POOL DISCOVERY ENGINE
//  Dynamically discovers all pools across Base DEX factories,
//  filters by liquidity, and generates tradeable pair combinations
// ═══════════════════════════════════════════════════════════════════════════════

export interface DiscoveredPool {
    dexId: DEXId;
    dexName: string;
    poolAddress: string;
    token0: string;
    token1: string;
    token0Symbol: string;
    token1Symbol: string;
    token0Decimals: number;
    token1Decimals: number;
    fee: number;
    liquidity: bigint;
    liquidityUsd: number;
    reserve0: bigint;
    reserve1: bigint;
    lastUpdated: number;
    isActive: boolean;
}

export interface TradePair {
    tokenA: string;
    tokenB: string;
    tokenASymbol: string;
    tokenBSymbol: string;
    pools: DiscoveredPool[];
    bestLiquidityUsd: number;
}

interface FactoryConfig {
    dexId: DEXId;
    dexName: string;
    factoryAddress: string;
    type: "v2" | "v3" | "aerodrome" | "aerodrome_cl";
    startBlock: number;
    feeTiers?: number[];
}

// ═══════════════════════════════════════════════════════════════════════════════
//                    EXTENDED ABIs FOR DISCOVERY
// ═══════════════════════════════════════════════════════════════════════════════

const V3_FACTORY_FULL_ABI = [
    "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)",
    "event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)",
];

const V2_FACTORY_FULL_ABI = [
    "function getPair(address tokenA, address tokenB) external view returns (address pair)",
    "function allPairsLength() external view returns (uint256)",
    "function allPairs(uint256) external view returns (address)",
    "event PairCreated(address indexed token0, address indexed token1, address pair, uint256)",
];

const AERODROME_FACTORY_ABI = [
    "function allPoolsLength() external view returns (uint256)",
    "function allPools(uint256) external view returns (address)",
    "function getPool(address tokenA, address tokenB, bool stable) external view returns (address)",
    "function isPool(address pool) external view returns (bool)",
    "event PoolCreated(address indexed token0, address indexed token1, bool indexed stable, address pool, uint256)",
];

const AERODROME_CL_FACTORY_ABI = [
    "function getPool(address tokenA, address tokenB, int24 tickSpacing) external view returns (address pool)",
    "event PoolCreated(address indexed token0, address indexed token1, int24 indexed tickSpacing, address pool)",
];

const V3_POOL_LIQUIDITY_ABI = [
    "function token0() external view returns (address)",
    "function token1() external view returns (address)",
    "function fee() external view returns (uint24)",
    "function liquidity() external view returns (uint128)",
    "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
];

const V2_PAIR_FULL_ABI = [
    "function token0() external view returns (address)",
    "function token1() external view returns (address)",
    "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
    "function totalSupply() external view returns (uint256)",
];

const AERODROME_POOL_FULL_ABI = [
    "function token0() external view returns (address)",
    "function token1() external view returns (address)",
    "function stable() external view returns (bool)",
    "function getReserves() external view returns (uint256 reserve0, uint256 reserve1, uint256 blockTimestampLast)",
    "function getAmountOut(uint256 amountIn, address tokenIn) external view returns (uint256)",
];

// ═══════════════════════════════════════════════════════════════════════════════
//                    TOKEN REGISTRY
// ═══════════════════════════════════════════════════════════════════════════════

class TokenRegistry {
    private tokens: Map<string, { symbol: string; decimals: number; priceUsd: number }> = new Map();
    private provider: ethers.Provider;

    constructor(provider: ethers.Provider) {
        this.provider = provider;
        this.initKnownTokens();
    }

    private initKnownTokens(): void {
        for (const [symbol, info] of Object.entries(TOKENS)) {
            this.tokens.set(info.address.toLowerCase(), {
                symbol,
                decimals: info.decimals,
                priceUsd: 0,
            });
        }
    }

    updatePrice(address: string, priceUsd: number): void {
        const key = address.toLowerCase();
        const existing = this.tokens.get(key);
        if (existing) {
            existing.priceUsd = priceUsd;
        }
    }

    updatePrices(ethPrice: number, btcPrice: number): void {
        for (const [addr, info] of this.tokens.entries()) {
            switch (info.symbol) {
                case "WETH": case "cbETH": case "wstETH": case "weETH":
                case "ezETH": case "wrsETH":
                    info.priceUsd = ethPrice;
                    break;
                case "cbBTC": case "LBTC": case "tBTC":
                    info.priceUsd = btcPrice;
                    break;
                case "USDC": case "USDbC": case "GHO": case "syrupUSDC":
                    info.priceUsd = 1.0;
                    break;
                case "EURC":
                    info.priceUsd = 1.08;
                    break;
                case "AAVE":
                    info.priceUsd = 200;
                    break;
            }
        }
    }

    getToken(address: string): { symbol: string; decimals: number; priceUsd: number } | null {
        return this.tokens.get(address.toLowerCase()) || null;
    }

    isKnown(address: string): boolean {
        return this.tokens.has(address.toLowerCase());
    }

    async resolveToken(address: string): Promise<{ symbol: string; decimals: number; priceUsd: number } | null> {
        const key = address.toLowerCase();
        if (this.tokens.has(key)) return this.tokens.get(key)!;

        try {
            const contract = new ethers.Contract(address, ERC20_ABI, this.provider);
            const [symbol, decimals] = await Promise.all([
                contract.symbol().catch(() => "UNKNOWN"),
                contract.decimals().catch(() => 18),
            ]);

            const info = { symbol: symbol as string, decimals: Number(decimals), priceUsd: 0 };
            this.tokens.set(key, info);
            return info;
        } catch {
            return null;
        }
    }

    getTokenValueUsd(address: string, amount: bigint): number {
        const token = this.getToken(address);
        if (!token || token.priceUsd === 0) return 0;
        return Number(ethers.formatUnits(amount, token.decimals)) * token.priceUsd;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//                    POOL DISCOVERY ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

export class PoolDiscovery {
    private provider: ethers.Provider;
    private tokenRegistry: TokenRegistry;
    private discoveredPools: Map<string, DiscoveredPool> = new Map();
    private tradePairs: Map<string, TradePair> = new Map();
    private isRunning: boolean = false;
    private refreshIntervalMs: number;
    private minLiquidityUsd: number;
    private lastScanBlock: number = 0;
    private refreshTimer: NodeJS.Timeout | null = null;
    private persistencePath: string;
    private autoSave: boolean;

    // Factory configurations for all Base DEXs
    private factories: FactoryConfig[] = [
        {
            dexId: DEXId.UNISWAP_V3,
            dexName: "Uniswap V3",
            factoryAddress: DEXES.UNISWAP_V3.factory,
            type: "v3",
            startBlock: 2000000,
            feeTiers: [100, 500, 3000, 10000],
        },
        {
            dexId: DEXId.UNISWAP_V2,
            dexName: "Uniswap V2",
            factoryAddress: "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6",
            type: "v2",
            startBlock: 2000000,
        },
        {
            dexId: DEXId.AERODROME_V2,
            dexName: "Aerodrome V2",
            factoryAddress: DEXES.AERODROME_V2.factory,
            type: "aerodrome",
            startBlock: 3000000,
        },
        {
            dexId: DEXId.AERODROME_CL,
            dexName: "Aerodrome CL",
            factoryAddress: "0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A",
            type: "aerodrome_cl",
            startBlock: 5000000,
        },
        {
            dexId: DEXId.PANCAKESWAP_V3,
            dexName: "PancakeSwap V3",
            factoryAddress: DEXES.PANCAKESWAP_V3.factory,
            type: "v3",
            startBlock: 2000000,
            feeTiers: [100, 500, 2500, 10000],
        },
        {
            dexId: DEXId.SUSHISWAP_V3,
            dexName: "SushiSwap V3",
            factoryAddress: DEXES.SUSHISWAP_V3.factory,
            type: "v3",
            startBlock: 2000000,
            feeTiers: [100, 500, 3000, 10000],
        },
        {
            dexId: DEXId.BASESWAP_V3,
            dexName: "BaseSwap V3",
            factoryAddress: "0x38015D05f4fEC8AFe15D7cc0386a126574e8077B",
            type: "v3",
            startBlock: 2000000,
            feeTiers: [500, 3000, 10000],
        },
    ];

    constructor(
        provider: ethers.Provider,
        config: {
            refreshIntervalMs?: number;
            minLiquidityUsd?: number;
            persistencePath?: string;
            autoSave?: boolean;
        } = {}
    ) {
        this.provider = provider;
        this.tokenRegistry = new TokenRegistry(provider);
        this.refreshIntervalMs = config.refreshIntervalMs || (7 * 24 * 60 * 60 * 1000); // 7 days default
        this.minLiquidityUsd = config.minLiquidityUsd || 10000; // $10k min
        this.persistencePath = config.persistencePath || path.join(process.cwd(), "data", "pools.json");
        this.autoSave = config.autoSave !== false; // Default to true
        
        // Ensure data directory exists
        const dataDir = path.dirname(this.persistencePath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                    PERSISTENCE
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * Save discovered pools to disk
     */
    private savePools(): void {
        if (!this.autoSave) return;

        try {
            const data = {
                version: "1.0",
                timestamp: Date.now(),
                lastScanBlock: this.lastScanBlock,
                pools: Array.from(this.discoveredPools.entries()).map(([key, pool]) => [
                    key,
                    {
                        ...pool,
                        liquidity: pool.liquidity.toString(),
                        reserve0: pool.reserve0.toString(),
                        reserve1: pool.reserve1.toString(),
                    }
                ]),
                tradePairs: Array.from(this.tradePairs.entries()),
            };

            fs.writeFileSync(this.persistencePath, JSON.stringify(data, null, 2));
            logger.debug(`💾 Saved ${this.discoveredPools.size} pools to ${this.persistencePath}`);
        } catch (error: any) {
            logger.error(`Failed to save pools: ${error.message}`);
        }
    }

    /**
     * Load discovered pools from disk
     */
    private loadPools(): boolean {
        if (!fs.existsSync(this.persistencePath)) {
            logger.info("📂 No saved pools found, will perform full scan");
            return false;
        }

        try {
            const data = JSON.parse(fs.readFileSync(this.persistencePath, "utf-8"));
            
            // Validate data structure
            if (!data.pools || !Array.isArray(data.pools)) {
                logger.warn("⚠️  Invalid pool data format, will perform full scan");
                return false;
            }

            // Check if data is stale (older than 7 days)
            const ageDays = (Date.now() - data.timestamp) / (1000 * 60 * 60 * 24);
            if (ageDays > 7) {
                logger.info(`📂 Pool data is ${ageDays.toFixed(1)} days old, will perform full scan`);
                return false;
            }

            // Restore pools and convert BigInt strings back to BigInt
            this.discoveredPools = new Map(
                data.pools.map(([key, pool]: [string, any]) => [
                    key,
                    {
                        ...pool,
                        liquidity: BigInt(pool.liquidity),
                        reserve0: BigInt(pool.reserve0),
                        reserve1: BigInt(pool.reserve1),
                    }
                ])
            );
            this.lastScanBlock = data.lastScanBlock || 0;

            // Restore trade pairs if available
            if (data.tradePairs && Array.isArray(data.tradePairs)) {
                this.tradePairs = new Map(data.tradePairs);
            }

            logger.info(`✅ Loaded ${this.discoveredPools.size} pools from ${this.persistencePath}`);
            logger.info(`   Last scan: block ${this.lastScanBlock} (${ageDays.toFixed(1)} days ago)`);
            
            return true;
        } catch (error: any) {
            logger.warn(`⚠️  Failed to load pools: ${error.message}, will perform full scan`);
            return false;
        }
    }

    /**
     * Clear saved pool data (useful for forcing a fresh scan)
     */
    clearSavedPools(): void {
        try {
            if (fs.existsSync(this.persistencePath)) {
                fs.unlinkSync(this.persistencePath);
                logger.info("🗑️  Cleared saved pool data");
            }
        } catch (error: any) {
            logger.error(`Failed to clear saved pools: ${error.message}`);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                    LIFECYCLE
    // ═══════════════════════════════════════════════════════════════════════════════

    async start(ethPrice: number, btcPrice: number): Promise<void> {
        logger.info("🔍 Starting dynamic pool discovery engine...");
        this.isRunning = true;
        this.tokenRegistry.updatePrices(ethPrice, btcPrice);

        // Try to load saved pools first
        const loaded = this.loadPools();
        
        if (loaded) {
            // Refresh liquidity for loaded pools
            await this.refreshLiquidity();
            // Build trade pairs from loaded pools
            this.buildTradePairs();
            // Perform incremental scan for new blocks
            await this.incrementalScan();
        } else {
            // Initial full scan
            await this.fullScan();
        }

        // Start periodic refresh (every 7 days by default)
        this.refreshTimer = setInterval(async () => {
            try {
                await this.incrementalScan();
                await this.refreshLiquidity();
                // Auto-save after each refresh
                this.savePools();
            } catch (error: any) {
                logger.error(`Pool discovery refresh error: ${error.message}`);
            }
        }, this.refreshIntervalMs);

        const refreshDays = (this.refreshIntervalMs / (1000 * 60 * 60 * 24)).toFixed(1);
        logger.info(`✅ Pool discovery running. Refresh every ${refreshDays} days. Min liquidity: $${this.minLiquidityUsd}`);
    }

    stop(): void {
        this.isRunning = false;
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
        logger.info("🛑 Pool discovery stopped.");
    }

    updatePrices(ethPrice: number, btcPrice: number): void {
        this.tokenRegistry.updatePrices(ethPrice, btcPrice);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                    FULL HISTORICAL SCAN
    // ═══════════════════════════════════════════════════════════════════════════════

    private async fullScan(): Promise<void> {
        const currentBlock = await this.provider.getBlockNumber();
        logger.info(`📡 Full pool scan from genesis to block ${currentBlock}...`);

        let totalDiscovered = 0;

        for (const factory of this.factories) {
            try {
                const count = await this.scanFactory(factory, factory.startBlock, currentBlock);
                totalDiscovered += count;
                logger.info(`  ✓ ${factory.dexName}: ${count} pools discovered`);
                
                // Save progress after each DEX
                this.savePools();
                logger.debug(`  💾 Saved progress: ${this.discoveredPools.size} pools total`);
            } catch (error: any) {
                logger.warn(`  ✗ ${factory.dexName} scan failed: ${error.message}`);
            }
        }

        this.lastScanBlock = currentBlock;

        // Fetch liquidity for all discovered pools
        await this.refreshLiquidity();

        // Build trade pairs from discovered pools
        this.buildTradePairs();

        // Final save with complete data
        this.savePools();

        logger.info(`📊 Discovery complete: ${totalDiscovered} pools → ${this.discoveredPools.size} active (≥$${this.minLiquidityUsd} TVL) → ${this.tradePairs.size} tradeable pairs`);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                    INCREMENTAL SCAN (NEW BLOCKS)
    // ═══════════════════════════════════════════════════════════════════════════════

    private async incrementalScan(): Promise<void> {
        const currentBlock = await this.provider.getBlockNumber();
        if (currentBlock <= this.lastScanBlock) return;

        const fromBlock = this.lastScanBlock + 1;
        logger.debug(`🔄 Incremental scan: blocks ${fromBlock}→${currentBlock}`);

        let newPools = 0;
        for (const factory of this.factories) {
            try {
                const count = await this.scanFactory(factory, fromBlock, currentBlock);
                newPools += count;
            } catch (error: any) {
                logger.debug(`Incremental scan error for ${factory.dexName}: ${error.message}`);
            }
        }

        this.lastScanBlock = currentBlock;
        if (newPools > 0) {
            logger.info(`🆕 Discovered ${newPools} new pools in blocks ${fromBlock}→${currentBlock}`);
            this.buildTradePairs();
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                    FACTORY SCANNING
    // ═══════════════════════════════════════════════════════════════════════════════

    private async scanFactory(
        factory: FactoryConfig,
        fromBlock: number,
        toBlock: number
    ): Promise<number> {
        switch (factory.type) {
            case "v3":
                return this.scanV3Factory(factory, fromBlock, toBlock);
            case "v2":
                return this.scanV2Factory(factory, fromBlock, toBlock);
            case "aerodrome":
                return this.scanAerodromeFactory(factory, fromBlock, toBlock);
            case "aerodrome_cl":
                return this.scanAerodromeCLFactory(factory, fromBlock, toBlock);
            default:
                return 0;
        }
    }

    private async scanV3Factory(
        factory: FactoryConfig,
        fromBlock: number,
        toBlock: number
    ): Promise<number> {
        const contract = new ethers.Contract(
            factory.factoryAddress,
            V3_FACTORY_FULL_ABI,
            this.provider
        );

        let discovered = 0;
        const BLOCK_RANGE = 10000;

        for (let start = fromBlock; start <= toBlock; start += BLOCK_RANGE) {
            const end = Math.min(start + BLOCK_RANGE - 1, toBlock);

            try {
                const events = await contract.queryFilter(
                    contract.filters.PoolCreated(),
                    start,
                    end
                );

                for (const event of events) {
                    const args = (event as ethers.EventLog).args;
                    if (!args) continue;

                    const token0 = args[0] as string;
                    const token1 = args[1] as string;
                    const fee = Number(args[2]);
                    const poolAddress = args[4] as string;

                    const token0Info = await this.tokenRegistry.resolveToken(token0);
                    const token1Info = await this.tokenRegistry.resolveToken(token1);

                    if (!token0Info || !token1Info) continue;

                    const pool: DiscoveredPool = {
                        dexId: factory.dexId,
                        dexName: factory.dexName,
                        poolAddress: poolAddress.toLowerCase(),
                        token0: token0.toLowerCase(),
                        token1: token1.toLowerCase(),
                        token0Symbol: token0Info.symbol,
                        token1Symbol: token1Info.symbol,
                        token0Decimals: token0Info.decimals,
                        token1Decimals: token1Info.decimals,
                        fee,
                        liquidity: 0n,
                        liquidityUsd: 0,
                        reserve0: 0n,
                        reserve1: 0n,
                        lastUpdated: Date.now(),
                        isActive: false,
                    };

                    this.discoveredPools.set(poolAddress.toLowerCase(), pool);
                    discovered++;
                }
            } catch (error: any) {
                logger.debug(`V3 scan chunk error at ${start}-${end}: ${error.message}`);
            }
        }

        return discovered;
    }

    private async scanV2Factory(
        factory: FactoryConfig,
        fromBlock: number,
        toBlock: number
    ): Promise<number> {
        const contract = new ethers.Contract(
            factory.factoryAddress,
            V2_FACTORY_FULL_ABI,
            this.provider
        );

        let discovered = 0;
        const BLOCK_RANGE = 10000;

        for (let start = fromBlock; start <= toBlock; start += BLOCK_RANGE) {
            const end = Math.min(start + BLOCK_RANGE - 1, toBlock);

            try {
                const events = await contract.queryFilter(
                    contract.filters.PairCreated(),
                    start,
                    end
                );

                for (const event of events) {
                    const args = (event as ethers.EventLog).args;
                    if (!args) continue;

                    const token0 = args[0] as string;
                    const token1 = args[1] as string;
                    const pairAddress = args[2] as string;

                    const token0Info = await this.tokenRegistry.resolveToken(token0);
                    const token1Info = await this.tokenRegistry.resolveToken(token1);
                    if (!token0Info || !token1Info) continue;

                    const pool: DiscoveredPool = {
                        dexId: factory.dexId,
                        dexName: factory.dexName,
                        poolAddress: pairAddress.toLowerCase(),
                        token0: token0.toLowerCase(),
                        token1: token1.toLowerCase(),
                        token0Symbol: token0Info.symbol,
                        token1Symbol: token1Info.symbol,
                        token0Decimals: token0Info.decimals,
                        token1Decimals: token1Info.decimals,
                        fee: 30,
                        liquidity: 0n,
                        liquidityUsd: 0,
                        reserve0: 0n,
                        reserve1: 0n,
                        lastUpdated: Date.now(),
                        isActive: false,
                    };

                    this.discoveredPools.set(pairAddress.toLowerCase(), pool);
                    discovered++;
                }
            } catch (error: any) {
                logger.debug(`V2 scan chunk error at ${start}-${end}: ${error.message}`);
            }
        }

        return discovered;
    }

    private async scanAerodromeFactory(
        factory: FactoryConfig,
        fromBlock: number,
        toBlock: number
    ): Promise<number> {
        const contract = new ethers.Contract(
            factory.factoryAddress,
            AERODROME_FACTORY_ABI,
            this.provider
        );

        let discovered = 0;
        const BLOCK_RANGE = 10000;

        for (let start = fromBlock; start <= toBlock; start += BLOCK_RANGE) {
            const end = Math.min(start + BLOCK_RANGE - 1, toBlock);

            try {
                const events = await contract.queryFilter(
                    contract.filters.PoolCreated(),
                    start,
                    end
                );

                for (const event of events) {
                    const args = (event as ethers.EventLog).args;
                    if (!args) continue;

                    const token0 = args[0] as string;
                    const token1 = args[1] as string;
                    const stable = args[2] as boolean;
                    const poolAddress = args[3] as string;
                    const token0Info = await this.tokenRegistry.resolveToken(token0);
                    const token1Info = await this.tokenRegistry.resolveToken(token1);
                    if (!token0Info || !token1Info) continue;

                    const pool: DiscoveredPool = {
                        dexId: factory.dexId,
                        dexName: `Aerodrome V2 (${stable ? "stable" : "volatile"})`,
                        poolAddress: poolAddress.toLowerCase(),
                        token0: token0.toLowerCase(),
                        token1: token1.toLowerCase(),
                        token0Symbol: token0Info.symbol,
                        token1Symbol: token1Info.symbol,
                        token0Decimals: token0Info.decimals,
                        token1Decimals: token1Info.decimals,
                        fee: stable ? 5 : 30,
                        liquidity: 0n,
                        liquidityUsd: 0,
                        reserve0: 0n,
                        reserve1: 0n,
                        lastUpdated: Date.now(),
                        isActive: false,
                    };

                    this.discoveredPools.set(poolAddress.toLowerCase(), pool);
                    discovered++;
                }
            } catch (error: any) {
                logger.debug(`Aerodrome scan chunk error at ${start}-${end}: ${error.message}`);
            }
        }

        return discovered;
    }

    private async scanAerodromeCLFactory(
        factory: FactoryConfig,
        fromBlock: number,
        toBlock: number
    ): Promise<number> {
        const contract = new ethers.Contract(
            factory.factoryAddress,
            AERODROME_CL_FACTORY_ABI,
            this.provider
        );

        let discovered = 0;
        const BLOCK_RANGE = 10000;

        for (let start = fromBlock; start <= toBlock; start += BLOCK_RANGE) {
            const end = Math.min(start + BLOCK_RANGE - 1, toBlock);

            try {
                const events = await contract.queryFilter(
                    contract.filters.PoolCreated(),
                    start,
                    end
                );

                for (const event of events) {
                    const args = (event as ethers.EventLog).args;
                    if (!args) continue;

                    const token0 = args[0] as string;
                    const token1 = args[1] as string;
                    const tickSpacing = Number(args[2]);
                    const poolAddress = args[3] as string;
                    const token0Info = await this.tokenRegistry.resolveToken(token0);
                    const token1Info = await this.tokenRegistry.resolveToken(token1);
                    if (!token0Info || !token1Info) continue;

                    const pool: DiscoveredPool = {
                        dexId: factory.dexId,
                        dexName: `Aerodrome CL (ts=${tickSpacing})`,
                        poolAddress: poolAddress.toLowerCase(),
                        token0: token0.toLowerCase(),
                        token1: token1.toLowerCase(),
                        token0Symbol: token0Info.symbol,
                        token1Symbol: token1Info.symbol,
                        token0Decimals: token0Info.decimals,
                        token1Decimals: token1Info.decimals,
                        fee: tickSpacing,
                        liquidity: 0n,
                        liquidityUsd: 0,
                        reserve0: 0n,
                        reserve1: 0n,
                        lastUpdated: Date.now(),
                        isActive: false,
                    };

                    this.discoveredPools.set(poolAddress.toLowerCase(), pool);
                    discovered++;
                }
            } catch (error: any) {
                logger.debug(`Aerodrome CL scan chunk error at ${start}-${end}: ${error.message}`);
            }
        }

        return discovered;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                    LIQUIDITY REFRESH
    // ═══════════════════════════════════════════════════════════════════════════════

    private async refreshLiquidity(): Promise<void> {
        const allPools = Array.from(this.discoveredPools.values());
        
        // Only fetch liquidity for pools with at least one known token
        // This avoids wasting RPC calls on random shitcoin pools
        const knownTokenAddresses = new Set(
            Object.values(TOKENS).map(t => t.address.toLowerCase())
        );
        
        const relevantPools = allPools.filter(pool => 
            knownTokenAddresses.has(pool.token0.toLowerCase()) || 
            knownTokenAddresses.has(pool.token1.toLowerCase())
        );
        
        logger.info(`💧 Refreshing liquidity for ${relevantPools.length} relevant pools (out of ${allPools.length} total, filtered to pools with known tokens)`);
        
        if (relevantPools.length === 0) {
            logger.warn(`⚠️  No relevant pools found! This means none of the discovered pools contain known tokens.`);
            logger.warn(`⚠️  Known tokens: ${Array.from(knownTokenAddresses).slice(0, 5).map(a => a.slice(0, 10))}...`);
            return;
        }
        
        const BATCH_SIZE = 20; // Smaller batches to avoid rate limits
        const BATCH_DELAY_MS = 200; // Delay between batches to avoid 429s
        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < relevantPools.length; i += BATCH_SIZE) {
            const batch = relevantPools.slice(i, i + BATCH_SIZE);
            const results = await Promise.allSettled(
                batch.map((pool) => this.updatePoolLiquidity(pool))
            );
            
            // Count successes and failures
            for (let j = 0; j < results.length; j++) {
                const result = results[j];
                const pool = batch[j];
                if (result.status === "fulfilled") {
                    successCount++;
                    // Log pools with liquidity > 0
                    if (pool.liquidityUsd > 0) {
                        logger.debug(`  ✅ ${pool.dexName} ${pool.poolAddress.slice(0, 10)}...: $${pool.liquidityUsd.toFixed(2)} TVL`);
                    }
                } else {
                    failCount++;
                    logger.debug(`  ❌ ${pool.dexName} ${pool.poolAddress.slice(0, 10)}...: ${result.reason?.message || 'Unknown error'}`);
                }
            }
            
            // Save progress every 5 batches (100 pools)
            if ((i / BATCH_SIZE) % 5 === 0 && i > 0) {
                this.savePools();
                logger.debug(`  💾 Saved liquidity progress: ${i}/${relevantPools.length} pools (✅ ${successCount} ❌ ${failCount})`);
            }
            
            // Rate limit delay between batches
            if (i + BATCH_SIZE < relevantPools.length) {
                await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
            }
        }

        // Mark pools as active/inactive based on liquidity
        let activeCount = 0;
        let zeroLiquidityCount = 0;
        let belowThresholdCount = 0;
        
        for (const pool of this.discoveredPools.values()) {
            // Only mark relevant pools as active
            const isRelevant = knownTokenAddresses.has(pool.token0.toLowerCase()) || 
                               knownTokenAddresses.has(pool.token1.toLowerCase());
            
            if (pool.liquidityUsd === 0) {
                zeroLiquidityCount++;
            } else if (pool.liquidityUsd < this.minLiquidityUsd) {
                belowThresholdCount++;
            }
            
            pool.isActive = isRelevant && pool.liquidityUsd >= this.minLiquidityUsd;
            if (pool.isActive) activeCount++;
        }

        logger.info(`💧 Liquidity refresh complete: ${activeCount} active pools (✅ ${successCount} fetched, ❌ ${failCount} failed, ≥$${this.minLiquidityUsd} TVL)`);
        logger.info(`   📊 Pool breakdown: ${zeroLiquidityCount} with $0 TVL, ${belowThresholdCount} below threshold, ${activeCount} active`);
    }

    private async updatePoolLiquidity(pool: DiscoveredPool): Promise<void> {
        try {
            if (pool.dexId === DEXId.UNISWAP_V2) {
                await this.updateV2Liquidity(pool);
            } else if (pool.dexId === DEXId.AERODROME_V2) {
                await this.updateAerodromeLiquidity(pool);
            } else {
                await this.updateV3Liquidity(pool);
            }
            pool.lastUpdated = Date.now();
        } catch (error: any) {
            // Log first few errors to help debug
            if (error.message?.includes("429") || error.message?.includes("rate")) {
                logger.debug(`⚠️  Rate limited on pool ${pool.poolAddress.slice(0, 10)}...`);
            }
            pool.isActive = false;
            throw error; // Re-throw so Promise.allSettled can track it
        }
    }

    private async updateV3Liquidity(pool: DiscoveredPool): Promise<void> {
        const contract = new ethers.Contract(
            pool.poolAddress,
            V3_POOL_LIQUIDITY_ABI,
            this.provider
        );

        const [liquidity, slot0] = await Promise.all([
            contract.liquidity(),
            contract.slot0(),
        ]);

        pool.liquidity = liquidity as bigint;
        const sqrtPriceX96 = slot0[0] as bigint;

        if (sqrtPriceX96 > 0n && pool.liquidity > 0n) {
            // For V3 pools, we estimate TVL using a simpler approach:
            // Use the token with a known price and estimate total value
            const token0Info = this.tokenRegistry.getToken(pool.token0);
            const token1Info = this.tokenRegistry.getToken(pool.token1);

            // Calculate price ratio from sqrtPriceX96
            // price = (sqrtPriceX96 / 2^96)^2 * 10^(token0Decimals - token1Decimals)
            const sqrtPrice = Number(sqrtPriceX96) / (2 ** 96);
            const priceToken1PerToken0 = sqrtPrice * sqrtPrice * (10 ** (pool.token0Decimals - pool.token1Decimals));

            // Try to calculate TVL using whichever token has a known price
            let tvlCalculated = false;

            if (token0Info && token0Info.priceUsd > 0) {
                // Estimate TVL as 2x the value of one side
                // Use liquidity as a rough proxy for pool depth
                const liq = Number(pool.liquidity);
                const amount0 = liq / (sqrtPrice * (10 ** pool.token0Decimals));
                const tvl0 = Math.abs(amount0) * token0Info.priceUsd;
                pool.liquidityUsd = tvl0 * 2; // Both sides roughly equal
                tvlCalculated = true;
            } else if (token1Info && token1Info.priceUsd > 0) {
                const liq = Number(pool.liquidity);
                const amount1 = liq * sqrtPrice / (10 ** pool.token1Decimals);
                const tvl1 = Math.abs(amount1) * token1Info.priceUsd;
                pool.liquidityUsd = tvl1 * 2;
                tvlCalculated = true;
            } else {
                // No known prices - try to estimate using liquidity alone
                // This is a rough estimate but better than 0
                // Assume average liquidity of $1000 per unit of liquidity
                const liq = Number(pool.liquidity);
                pool.liquidityUsd = liq * 1000; // Very rough estimate
                tvlCalculated = true;
            }

            // Sanity check - cap at reasonable values
            if (!isFinite(pool.liquidityUsd) || isNaN(pool.liquidityUsd) || pool.liquidityUsd < 0) {
                pool.liquidityUsd = 0;
            }

            // Log if we're using estimated liquidity
            if (!tvlCalculated || (token0Info?.priceUsd === 0 && token1Info?.priceUsd === 0)) {
                logger.debug(`  📊 Pool ${pool.poolAddress.slice(0, 10)}...: Estimated TVL $${pool.liquidityUsd.toFixed(2)} (no price data)`);
            }
        }
    }

    private async updateV2Liquidity(pool: DiscoveredPool): Promise<void> {
        const contract = new ethers.Contract(
            pool.poolAddress,
            V2_PAIR_FULL_ABI,
            this.provider
        );

        const reserves = await contract.getReserves();
        pool.reserve0 = reserves[0] as bigint;
        pool.reserve1 = reserves[1] as bigint;

        const value0 = this.tokenRegistry.getTokenValueUsd(pool.token0, pool.reserve0);
        const value1 = this.tokenRegistry.getTokenValueUsd(pool.token1, pool.reserve1);
        pool.liquidityUsd = value0 + value1;
    }

    private async updateAerodromeLiquidity(pool: DiscoveredPool): Promise<void> {
        const contract = new ethers.Contract(
            pool.poolAddress,
            AERODROME_POOL_FULL_ABI,
            this.provider
        );

        const reserves = await contract.getReserves();
        pool.reserve0 = reserves[0] as bigint;
        pool.reserve1 = reserves[1] as bigint;
        const value0 = this.tokenRegistry.getTokenValueUsd(pool.token0, pool.reserve0);
        const value1 = this.tokenRegistry.getTokenValueUsd(pool.token1, pool.reserve1);
        pool.liquidityUsd = value0 + value1;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                    TRADE PAIR GENERATION
    // ═══════════════════════════════════════════════════════════════════════════════

    private buildTradePairs(): void {
        this.tradePairs.clear();

        for (const pool of this.discoveredPools.values()) {
            if (!pool.isActive) continue;

            const [addrA, addrB] = pool.token0 < pool.token1
                ? [pool.token0, pool.token1]
                : [pool.token1, pool.token0];
            const pairKey = `${addrA}-${addrB}`;

            let pair = this.tradePairs.get(pairKey);
            if (!pair) {
                const symbolA = pool.token0 < pool.token1 ? pool.token0Symbol : pool.token1Symbol;
                const symbolB = pool.token0 < pool.token1 ? pool.token1Symbol : pool.token0Symbol;

                pair = {
                    tokenA: addrA,
                    tokenB: addrB,
                    tokenASymbol: symbolA,
                    tokenBSymbol: symbolB,
                    pools: [],
                    bestLiquidityUsd: 0,
                };
                this.tradePairs.set(pairKey, pair);
            }

            pair.pools.push(pool);
            if (pool.liquidityUsd > pair.bestLiquidityUsd) {
                pair.bestLiquidityUsd = pool.liquidityUsd;
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                    PUBLIC ACCESSORS
    // ═══════════════════════════════════════════════════════════════════════════════

    getArbitrageablePairs(): TradePair[] {
        const pairs: TradePair[] = [];
        for (const pair of this.tradePairs.values()) {
            const uniqueDexes = new Set(pair.pools.map((p) => p.dexId));
            if (uniqueDexes.size >= 2) {
                pairs.push(pair);
            }
        }
        return pairs.sort((a, b) => b.bestLiquidityUsd - a.bestLiquidityUsd);
    }

    getDynamicPairs(): Array<{ tokenA: string; tokenB: string }> {
        return this.getArbitrageablePairs().map((pair) => ({
            tokenA: pair.tokenASymbol,
            tokenB: pair.tokenBSymbol,
        }));
    }

    getTriangularPaths(): Array<{ a: string; b: string; c: string }> {
        const paths: Array<{ a: string; b: string; c: string }> = [];
        const pairsByToken: Map<string, Set<string>> = new Map();

        for (const pair of this.tradePairs.values()) {
            if (pair.pools.length < 1) continue;

            if (!pairsByToken.has(pair.tokenASymbol)) {
                pairsByToken.set(pair.tokenASymbol, new Set());
            }
            if (!pairsByToken.has(pair.tokenBSymbol)) {
                pairsByToken.set(pair.tokenBSymbol, new Set());
            }
            pairsByToken.get(pair.tokenASymbol)!.add(pair.tokenBSymbol);
            pairsByToken.get(pair.tokenBSymbol)!.add(pair.tokenASymbol);
        }

        const tokens = Array.from(pairsByToken.keys());
        const seen = new Set<string>();

        for (const a of tokens) {
            const neighborsA = pairsByToken.get(a);
            if (!neighborsA) continue;

            for (const b of neighborsA) {
                if (b <= a) continue;
                const neighborsB = pairsByToken.get(b);
                if (!neighborsB) continue;

                for (const c of neighborsB) {
                    if (c <= b) continue;
                    if (!neighborsA.has(c)) continue;

                    const key = [a, b, c].sort().join("-");
                    if (seen.has(key)) continue;
                    seen.add(key);

                    const borrowable = Object.keys(TOKENS);
                    if (borrowable.includes(a)) {
                        paths.push({ a, b, c });
                    } else if (borrowable.includes(b)) {
                        paths.push({ a: b, b: c, c: a });
                    } else if (borrowable.includes(c)) {
                        paths.push({ a: c, b: a, c: b });
                    }
                }
            }
        }

        return paths;
    }

    getPoolsForPair(tokenA: string, tokenB: string): DiscoveredPool[] {
        const addrA = tokenA.toLowerCase();
        const addrB = tokenB.toLowerCase();

        return Array.from(this.discoveredPools.values()).filter(
            (pool) =>
                pool.isActive &&
                ((pool.token0 === addrA && pool.token1 === addrB) ||
                    (pool.token0 === addrB && pool.token1 === addrA))
        );
    }

    getStats(): {
        totalPools: number;
        activePools: number;
        tradeablePairs: number;
        arbitrageablePairs: number;
        triangularPaths: number;
        lastScanBlock: number;
    } {
        return {
            totalPools: this.discoveredPools.size,
            activePools: Array.from(this.discoveredPools.values()).filter((p) => p.isActive).length,
            tradeablePairs: this.tradePairs.size,
            arbitrageablePairs: this.getArbitrageablePairs().length,
            triangularPaths: this.getTriangularPaths().length,
            lastScanBlock: this.lastScanBlock,
        };
    }

    getTokenRegistry(): TokenRegistry {
        return this.tokenRegistry;
    }
}
