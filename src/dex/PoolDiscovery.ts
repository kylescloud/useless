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

// ═══════════════════════════════════════════════════════════════════
//                    POOL DISCOVERY ENGINE
//  Dynamically discovers all pools across Base DEX factories,
//  filters by liquidity, and generates tradeable pair combinations
// ═══════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════
//                    EXTENDED ABIs FOR DISCOVERY
// ═══════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════
//                    TOKEN REGISTRY
// ═══════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════
//                    POOL DISCOVERY ENGINE
// ═══════════════════════════════════════════════════════════════════

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
        } = {}
    ) {
        this.provider = provider;
        this.tokenRegistry = new TokenRegistry(provider);
        this.refreshIntervalMs = config.refreshIntervalMs || 300000; // 5 min default
        this.minLiquidityUsd = config.minLiquidityUsd || 10000; // $10k min
    }

    // ═══════════════════════════════════════════════════════════════
    //                    LIFECYCLE
    // ═══════════════════════════════════════════════════════════════

    async start(ethPrice: number, btcPrice: number): Promise<void> {
        logger.info("🔎 Starting dynamic pool discovery engine...");
        this.isRunning = true;
        this.tokenRegistry.updatePrices(ethPrice, btcPrice);

        // Initial full scan
        await this.fullScan();

        // Start periodic refresh
        this.refreshTimer = setInterval(async () => {
            try {
                await this.incrementalScan();
                await this.refreshLiquidity();
            } catch (error: any) {
                logger.error(`Pool discovery refresh error: ${error.message}`);
            }
        }, this.refreshIntervalMs);

        logger.info(`✅ Pool discovery running. Refresh every ${this.refreshIntervalMs / 1000}s. Min liquidity: $${this.minLiquidityUsd}`);
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

    // ═══════════════════════════════════════════════════════════════
    //                    FULL HISTORICAL SCAN
    // ═══════════════════════════════════════════════════════════════

    private async fullScan(): Promise<void> {
        const currentBlock = await this.provider.getBlockNumber();
        logger.info(`📡 Full pool scan from genesis to block ${currentBlock}...`);

        let totalDiscovered = 0;

        for (const factory of this.factories) {
            try {
                const count = await this.scanFactory(factory, factory.startBlock, currentBlock);
                totalDiscovered += count;
                logger.info(`  ✓ ${factory.dexName}: ${count} pools discovered`);
            } catch (error: any) {
                logger.warn(`  ✗ ${factory.dexName} scan failed: ${error.message}`);
            }
        }

        this.lastScanBlock = currentBlock;

        // Fetch liquidity for all discovered pools
        await this.refreshLiquidity();

        // Build trade pairs from discovered pools
        this.buildTradePairs();

        logger.info(`📊 Discovery complete: ${totalDiscovered} pools → ${this.discoveredPools.size} active (≥$${this.minLiquidityUsd} TVL) → ${this.tradePairs.size} tradeable pairs`);
    }

    // ═══════════════════════════════════════════════════════════════
    //                    INCREMENTAL SCAN (NEW BLOCKS)
    // ═══════════════════════════════════════════════════════════════

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

    // ═══════════════════════════════════════════════════════════════
    //                    FACTORY SCANNING
    // ═══════════════════════════════════════════════════════════════

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
                // Reduce block range on RPC errors
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

    // ═══════════════════════════════════════════════════════════════
    //                    LIQUIDITY REFRESH
    // ═══════════════════════════════════════════════════════════════

    private async refreshLiquidity(): Promise<void> {
        const pools = Array.from(this.discoveredPools.values());
        const BATCH_SIZE = 50;

        for (let i = 0; i < pools.length; i += BATCH_SIZE) {
            const batch = pools.slice(i, i + BATCH_SIZE);
            await Promise.allSettled(
                batch.map((pool) => this.updatePoolLiquidity(pool))
            );
        }

        // Mark pools as active/inactive based on liquidity
        let activeCount = 0;
        for (const pool of this.discoveredPools.values()) {
            pool.isActive = pool.liquidityUsd >= this.minLiquidityUsd;
            if (pool.isActive) activeCount++;
        }

        logger.debug(`💧 Liquidity refresh: ${activeCount}/${this.discoveredPools.size} pools active (≥$${this.minLiquidityUsd})`);
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
        } catch {
            pool.isActive = false;
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

        // Estimate TVL from liquidity and price
        // For V3, we approximate using the liquidity value and current price
        if (sqrtPriceX96 > 0n && pool.liquidity > 0n) {
            const price = Number(sqrtPriceX96) / (2 ** 96);
            const priceSquared = price * price;

            // Approximate token amounts from concentrated liquidity
            const liq = Number(pool.liquidity);
            const amount0Approx = liq / (price * (10 ** ((pool.token0Decimals - pool.token1Decimals) / 2)));
            const amount1Approx = liq * price * (10 ** ((pool.token0Decimals - pool.token1Decimals) / 2));

            const value0 = this.tokenRegistry.getTokenValueUsd(
                pool.token0,
                BigInt(Math.floor(Math.abs(amount0Approx)))
            );
            const value1 = this.tokenRegistry.getTokenValueUsd(
                pool.token1,
                BigInt(Math.floor(Math.abs(amount1Approx)))
            );

            pool.liquidityUsd = value0 + value1;
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

    // ═══════════════════════════════════════════════════════════════
    //                    TRADE PAIR GENERATION
    // ═══════════════════════════════════════════════════════════════

    private buildTradePairs(): void {
        this.tradePairs.clear();

        for (const pool of this.discoveredPools.values()) {
            if (!pool.isActive) continue;

            // Normalize pair key (sorted by address)
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

    // ═══════════════════════════════════════════════════════════════
    //                    PUBLIC ACCESSORS
    // ═══════════════════════════════════════════════════════════════

    /// @notice Returns all tradeable pairs with ≥2 pools (arb possible)
    getArbitrageablePairs(): TradePair[] {
        const pairs: TradePair[] = [];
        for (const pair of this.tradePairs.values()) {
            // Need at least 2 pools on different DEXs for arbitrage
            const uniqueDexes = new Set(pair.pools.map((p) => p.dexId));
            if (uniqueDexes.size >= 2) {
                pairs.push(pair);
            }
        }
        return pairs.sort((a, b) => b.bestLiquidityUsd - a.bestLiquidityUsd);
    }

    /// @notice Returns pairs formatted for StrategyManager consumption
    getDynamicPairs(): Array<{ tokenA: string; tokenB: string }> {
        return this.getArbitrageablePairs().map((pair) => ({
            tokenA: pair.tokenASymbol,
            tokenB: pair.tokenBSymbol,
        }));
    }

    /// @notice Returns triangular paths from discovered pools
    getTriangularPaths(): Array<{ a: string; b: string; c: string }> {
        const paths: Array<{ a: string; b: string; c: string }> = [];
        const pairsByToken: Map<string, Set<string>> = new Map();

        // Build adjacency map
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

        // Find triangles: A→B→C→A
        const tokens = Array.from(pairsByToken.keys());
        const seen = new Set<string>();

        for (const a of tokens) {
            const neighborsA = pairsByToken.get(a);
            if (!neighborsA) continue;

            for (const b of neighborsA) {
                if (b <= a) continue; // Avoid duplicates
                const neighborsB = pairsByToken.get(b);
                if (!neighborsB) continue;

                for (const c of neighborsB) {
                    if (c <= b) continue; // Avoid duplicates
                    if (!neighborsA.has(c)) continue; // C must connect back to A

                    const key = [a, b, c].sort().join("-");
                    if (seen.has(key)) continue;
                    seen.add(key);

                    // Only include triangles with known Aave borrowable tokens
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

    /// @notice Get all pools for a specific token pair
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

    /// @notice Get discovery statistics
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

    /// @notice Get the token registry for external use
    getTokenRegistry(): TokenRegistry {
        return this.tokenRegistry;
    }
}