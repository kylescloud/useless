import { ethers } from "ethers";
import { DEXES, TOKENS, DEXId, type TokenInfo, type DEXConfig } from "../config/addresses";
import {
    UNISWAP_V3_QUOTER_ABI,
    UNISWAP_V3_FACTORY_ABI,
    UNISWAP_V3_POOL_ABI,
    UNISWAP_V2_ROUTER_ABI,
    UNISWAP_V2_FACTORY_ABI,
    UNISWAP_V2_PAIR_ABI,
    AERODROME_ROUTER_ABI,
    AERODROME_POOL_ABI,
    PANCAKE_V3_QUOTER_ABI,
    BALANCER_VAULT_ABI,
    CURVE_POOL_ABI,
} from "../config/abis";
import { logger } from "../utils/Logger";

// ═══════════════════════════════════════════════════════════════════
//                        QUOTE RESULT
// ═══════════════════════════════════════════════════════════════════
export interface QuoteResult {
    dexId: DEXId;
    dexName: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint;
    amountOut: bigint;
    fee: number;
    gasEstimate: bigint;
    extraData: string; // Encoded data for on-chain execution
    poolAddress?: string;
    priceImpactBps?: number;
}

// ═══════════════════════════════════════════════════════════════════
//                      DEX QUOTER ENGINE
// ═══════════════════════════════════════════════════════════════════
export class DEXQuoter {
    private provider: ethers.Provider;
    private poolCache: Map<string, string> = new Map();

    constructor(provider: ethers.Provider) {
        this.provider = provider;
    }

    /// @notice Gets quotes from all DEXs for a given pair
    async getAllQuotes(
        tokenInSymbol: string,
        tokenOutSymbol: string,
        amountIn: bigint
    ): Promise<QuoteResult[]> {
        const tokenIn = TOKENS[tokenInSymbol];
        const tokenOut = TOKENS[tokenOutSymbol];
        if (!tokenIn || !tokenOut) return [];

        const quotePromises: Promise<QuoteResult | null>[] = [
            this.quoteUniswapV3(tokenIn, tokenOut, amountIn),
            this.quoteUniswapV2(tokenIn, tokenOut, amountIn),
            this.quoteAerodromeV2(tokenIn, tokenOut, amountIn),
            this.quoteAerodromeCL(tokenIn, tokenOut, amountIn),
            this.quotePancakeV3(tokenIn, tokenOut, amountIn),
            this.quoteSushiV3(tokenIn, tokenOut, amountIn),
            this.quoteBaseSwapV3(tokenIn, tokenOut, amountIn),
        ];

        const results = await Promise.allSettled(quotePromises);
        const quotes: QuoteResult[] = [];

        for (const result of results) {
            if (result.status === "fulfilled" && result.value !== null) {
                quotes.push(result.value);
            }
        }

        // Also get multi-fee quotes for V3 DEXs
        const multiFeeQuotes = await this.getMultiFeeQuotes(tokenIn, tokenOut, amountIn);
        quotes.push(...multiFeeQuotes);

        return quotes.sort((a, b) => (b.amountOut > a.amountOut ? 1 : -1));
    }

    /// @notice Gets best quote across all DEXs
    async getBestQuote(
        tokenInSymbol: string,
        tokenOutSymbol: string,
        amountIn: bigint
    ): Promise<QuoteResult | null> {
        const quotes = await this.getAllQuotes(tokenInSymbol, tokenOutSymbol, amountIn);
        return quotes.length > 0 ? quotes[0] : null;
    }

    // ═══════════════════════════════════════════════════════════════
    //                    UNISWAP V3 QUOTING
    // ═══════════════════════════════════════════════════════════════
    private async quoteUniswapV3(
        tokenIn: TokenInfo,
        tokenOut: TokenInfo,
        amountIn: bigint,
        fee: number = 3000
    ): Promise<QuoteResult | null> {
        try {
            const quoter = new ethers.Contract(
                DEXES.UNISWAP_V3.quoter,
                UNISWAP_V3_QUOTER_ABI,
                this.provider
            );

            const result = await quoter.quoteExactInputSingle.staticCall({
                tokenIn: tokenIn.address,
                tokenOut: tokenOut.address,
                amountIn: amountIn,
                fee: fee,
                sqrtPriceLimitX96: 0,
            });

            const amountOut = result[0] as bigint;
            const gasEstimate = result[3] as bigint;

            if (amountOut === 0n) return null;

            return {
                dexId: DEXId.UNISWAP_V3,
                dexName: `Uniswap V3 (${fee / 10000}%)`,
                tokenIn: tokenIn.address,
                tokenOut: tokenOut.address,
                amountIn,
                amountOut,
                fee,
                gasEstimate,
                extraData: ethers.AbiCoder.defaultAbiCoder().encode(["uint24"], [fee]),
            };
        } catch {
            return null;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //                    UNISWAP V2 QUOTING
    // ═══════════════════════════════════════════════════════════════
    private async quoteUniswapV2(
        tokenIn: TokenInfo,
        tokenOut: TokenInfo,
        amountIn: bigint
    ): Promise<QuoteResult | null> {
        try {
            const router = new ethers.Contract(
                DEXES.UNISWAP_V2.router,
                UNISWAP_V2_ROUTER_ABI,
                this.provider
            );

            const amounts = await router.getAmountsOut(amountIn, [
                tokenIn.address,
                tokenOut.address,
            ]);

            const amountOut = amounts[1] as bigint;
            if (amountOut === 0n) return null;

            return {
                dexId: DEXId.UNISWAP_V2,
                dexName: "Uniswap V2",
                tokenIn: tokenIn.address,
                tokenOut: tokenOut.address,
                amountIn,
                amountOut,
                fee: 30,
                gasEstimate: 120000n,
                extraData: "0x",
            };
        } catch {
            return null;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //                    AERODROME V2 QUOTING
    // ═══════════════════════════════════════════════════════════════
    private async quoteAerodromeV2(
        tokenIn: TokenInfo,
        tokenOut: TokenInfo,
        amountIn: bigint
    ): Promise<QuoteResult | null> {
        try {
            const router = new ethers.Contract(
                DEXES.AERODROME_V2.router,
                AERODROME_ROUTER_ABI,
                this.provider
            );

            // Try volatile pool first
            const routes = [{
                from: tokenIn.address,
                to: tokenOut.address,
                stable: false,
                factory: DEXES.AERODROME_V2.factory,
            }];

            const amounts = await router.getAmountsOut(amountIn, routes);
            const amountOut = amounts[1] as bigint;
            if (amountOut === 0n) return null;

            return {
                dexId: DEXId.AERODROME_V2,
                dexName: "Aerodrome V2 (volatile)",
                tokenIn: tokenIn.address,
                tokenOut: tokenOut.address,
                amountIn,
                amountOut,
                fee: 30,
                gasEstimate: 150000n,
                extraData: ethers.AbiCoder.defaultAbiCoder().encode(
                    ["bool", "address"],
                    [false, DEXES.AERODROME_V2.factory]
                ),
            };
        } catch {
            return null;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //                  AERODROME SLIPSTREAM (CL)
    // ═══════════════════════════════════════════════════════════════
    private async quoteAerodromeCL(
        tokenIn: TokenInfo,
        tokenOut: TokenInfo,
        amountIn: bigint
    ): Promise<QuoteResult | null> {
        try {
            const quoter = new ethers.Contract(
                DEXES.AERODROME_CL.quoter,
                UNISWAP_V3_QUOTER_ABI, // Compatible interface
                this.provider
            );

            // Try common tick spacings: 1, 50, 100, 200
            for (const tickSpacing of [100, 200, 50, 1]) {
                try {
                    const result = await quoter.quoteExactInputSingle.staticCall({
                        tokenIn: tokenIn.address,
                        tokenOut: tokenOut.address,
                        amountIn: amountIn,
                        fee: tickSpacing,
                        sqrtPriceLimitX96: 0,
                    });

                    const amountOut = result[0] as bigint;
                    if (amountOut === 0n) continue;

                    return {
                        dexId: DEXId.AERODROME_CL,
                        dexName: `Aerodrome CL (ts=${tickSpacing})`,
                        tokenIn: tokenIn.address,
                        tokenOut: tokenOut.address,
                        amountIn,
                        amountOut,
                        fee: tickSpacing,
                        gasEstimate: result[3] as bigint,
                        extraData: ethers.AbiCoder.defaultAbiCoder().encode(["uint24"], [tickSpacing]),
                    };
                } catch {
                    continue;
                }
            }
            return null;
        } catch {
            return null;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //                  PANCAKESWAP V3 QUOTING
    // ═══════════════════════════════════════════════════════════════
    private async quotePancakeV3(
        tokenIn: TokenInfo,
        tokenOut: TokenInfo,
        amountIn: bigint,
        fee: number = 2500
    ): Promise<QuoteResult | null> {
        try {
            const quoter = new ethers.Contract(
                DEXES.PANCAKESWAP_V3.quoter,
                PANCAKE_V3_QUOTER_ABI,
                this.provider
            );

            const result = await quoter.quoteExactInputSingle.staticCall({
                tokenIn: tokenIn.address,
                tokenOut: tokenOut.address,
                amountIn: amountIn,
                fee: fee,
                sqrtPriceLimitX96: 0,
            });

            const amountOut = result[0] as bigint;
            if (amountOut === 0n) return null;

            return {
                dexId: DEXId.PANCAKESWAP_V3,
                dexName: `PancakeSwap V3 (${fee / 10000}%)`,
                tokenIn: tokenIn.address,
                tokenOut: tokenOut.address,
                amountIn,
                amountOut,
                fee,
                gasEstimate: result[3] as bigint,
                extraData: ethers.AbiCoder.defaultAbiCoder().encode(["uint24"], [fee]),
            };
        } catch {
            return null;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //                  SUSHISWAP V3 QUOTING
    // ═══════════════════════════════════════════════════════════════
    private async quoteSushiV3(
        tokenIn: TokenInfo,
        tokenOut: TokenInfo,
        amountIn: bigint,
        fee: number = 3000
    ): Promise<QuoteResult | null> {
        try {
            const quoter = new ethers.Contract(
                DEXES.SUSHISWAP_V3.quoter,
                UNISWAP_V3_QUOTER_ABI,
                this.provider
            );

            const result = await quoter.quoteExactInputSingle.staticCall({
                tokenIn: tokenIn.address,
                tokenOut: tokenOut.address,
                amountIn: amountIn,
                fee: fee,
                sqrtPriceLimitX96: 0,
            });

            const amountOut = result[0] as bigint;
            if (amountOut === 0n) return null;

            return {
                dexId: DEXId.SUSHISWAP_V3,
                dexName: `SushiSwap V3 (${fee / 10000}%)`,
                tokenIn: tokenIn.address,
                tokenOut: tokenOut.address,
                amountIn,
                amountOut,
                fee,
                gasEstimate: result[3] as bigint,
                extraData: ethers.AbiCoder.defaultAbiCoder().encode(["uint24"], [fee]),
            };
        } catch {
            return null;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //                  BASESWAP V3 QUOTING
    // ═══════════════════════════════════════════════════════════════
    private async quoteBaseSwapV3(
        tokenIn: TokenInfo,
        tokenOut: TokenInfo,
        amountIn: bigint,
        fee: number = 3000
    ): Promise<QuoteResult | null> {
        try {
            const quoter = new ethers.Contract(
                DEXES.BASESWAP_V3.quoter,
                UNISWAP_V3_QUOTER_ABI,
                this.provider
            );

            const result = await quoter.quoteExactInputSingle.staticCall({
                tokenIn: tokenIn.address,
                tokenOut: tokenOut.address,
                amountIn: amountIn,
                fee: fee,
                sqrtPriceLimitX96: 0,
            });

            const amountOut = result[0] as bigint;
            if (amountOut === 0n) return null;

            return {
                dexId: DEXId.BASESWAP_V3,
                dexName: `BaseSwap V3 (${fee / 10000}%)`,
                tokenIn: tokenIn.address,
                tokenOut: tokenOut.address,
                amountIn,
                amountOut,
                fee,
                gasEstimate: result[3] as bigint,
                extraData: ethers.AbiCoder.defaultAbiCoder().encode(["uint24"], [fee]),
            };
        } catch {
            return null;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //                  MULTI-FEE TIER QUOTES
    // ═══════════════════════════════════════════════════════════════
    private async getMultiFeeQuotes(
        tokenIn: TokenInfo,
        tokenOut: TokenInfo,
        amountIn: bigint
    ): Promise<QuoteResult[]> {
        const quotes: QuoteResult[] = [];
        const feeConfigs = [
            { dex: "UNISWAP_V3", fees: [100, 500, 10000], quoteFn: this.quoteUniswapV3.bind(this) },
            { dex: "PANCAKESWAP_V3", fees: [100, 500, 10000], quoteFn: this.quotePancakeV3.bind(this) },
            { dex: "SUSHISWAP_V3", fees: [100, 500, 10000], quoteFn: this.quoteSushiV3.bind(this) },
            { dex: "BASESWAP_V3", fees: [500, 10000], quoteFn: this.quoteBaseSwapV3.bind(this) },
        ];

        const promises: Promise<QuoteResult | null>[] = [];
        for (const config of feeConfigs) {
            for (const fee of config.fees) {
                promises.push(config.quoteFn(tokenIn, tokenOut, amountIn, fee));
            }
        }

        const results = await Promise.allSettled(promises);
        for (const result of results) {
            if (result.status === "fulfilled" && result.value !== null) {
                quotes.push(result.value);
            }
        }

        return quotes;
    }

    // ═══════════════════════════════════════════════════════════════
    //                    POOL DISCOVERY
    // ═══════════════════════════════════════════════════════════════
    async getV3PoolAddress(
        factoryAddress: string,
        tokenA: string,
        tokenB: string,
        fee: number
    ): Promise<string | null> {
        const cacheKey = `${factoryAddress}-${tokenA}-${tokenB}-${fee}`;
        if (this.poolCache.has(cacheKey)) {
            return this.poolCache.get(cacheKey)!;
        }

        try {
            const factory = new ethers.Contract(
                factoryAddress,
                UNISWAP_V3_FACTORY_ABI,
                this.provider
            );
            const pool = await factory.getPool(tokenA, tokenB, fee);
            if (pool === ethers.ZeroAddress) return null;

            this.poolCache.set(cacheKey, pool);
            return pool;
        } catch {
            return null;
        }
    }

    async getV2PairAddress(
        factoryAddress: string,
        tokenA: string,
        tokenB: string
    ): Promise<string | null> {
        const cacheKey = `${factoryAddress}-${tokenA}-${tokenB}`;
        if (this.poolCache.has(cacheKey)) {
            return this.poolCache.get(cacheKey)!;
        }

        try {
            const factory = new ethers.Contract(
                factoryAddress,
                UNISWAP_V2_FACTORY_ABI,
                this.provider
            );
            const pair = await factory.getPair(tokenA, tokenB);
            if (pair === ethers.ZeroAddress) return null;

            this.poolCache.set(cacheKey, pair);
            return pair;
        } catch {
            return null;
        }
    }

    /// @notice Gets V2 pair reserves for off-chain calculation
    async getV2Reserves(pairAddress: string): Promise<{ reserve0: bigint; reserve1: bigint; token0: string } | null> {
        try {
            const pair = new ethers.Contract(pairAddress, UNISWAP_V2_PAIR_ABI, this.provider);
            const [reserves, token0] = await Promise.all([
                pair.getReserves(),
                pair.token0(),
            ]);
            return {
                reserve0: reserves[0] as bigint,
                reserve1: reserves[1] as bigint,
                token0: token0 as string,
            };
        } catch {
            return null;
        }
    }

    /// @notice Calculates V2 output amount off-chain (no RPC call)
    static calculateV2AmountOut(
        amountIn: bigint,
        reserveIn: bigint,
        reserveOut: bigint,
        feeBps: number = 30
    ): bigint {
        const amountInWithFee = amountIn * BigInt(10000 - feeBps);
        const numerator = amountInWithFee * reserveOut;
        const denominator = reserveIn * 10000n + amountInWithFee;
        return numerator / denominator;
    }
}