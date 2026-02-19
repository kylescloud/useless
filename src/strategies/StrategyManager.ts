import { ethers } from "ethers";
import { DEXQuoter, QuoteResult } from "../dex/DEXQuoter";
import { ZeroExClient } from "../dex/ZeroExClient";
import { PoolDiscovery, TradePair } from "../dex/PoolDiscovery";
import { TOKENS, AAVE, HIGH_LIQUIDITY_PAIRS, DEXId } from "../config/addresses";
import { logger, TradeLogger } from "../utils/Logger";

// ═══════════════════════════════════════════════════════════════════
//                    STRATEGY TYPES
// ═══════════════════════════════════════════════════════════════════

export interface ArbOpportunity {
    strategyType: StrategyType;
    borrowAsset: string;
    borrowAmount: bigint;
    legs: SwapLeg[];
    expectedProfit: bigint;
    profitBps: number;
    profitUsd: number;
    totalGasEstimate: bigint;
    gasCostUsd: number;
    netProfitUsd: number;
    timestamp: number;
}

export interface SwapLeg {
    dexId: DEXId;
    dexName: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint;
    expectedAmountOut: bigint;
    amountOutMin: bigint;
    fee: number;
    extraData: string;
}

export enum StrategyType {
    DIRECT_ARB = "DIRECT_ARB",           // Buy on DEX A, sell on DEX B
    TRIANGULAR_ARB = "TRIANGULAR_ARB",   // A→B→C→A across DEXs
    MULTI_HOP_ARB = "MULTI_HOP_ARB",     // Complex multi-hop paths
    ZEROX_ARB = "ZEROX_ARB",             // 0x aggregator vs direct DEX
    STABLE_ARB = "STABLE_ARB",           // Stablecoin depegs
    LST_ARB = "LST_ARB",                 // Liquid staking token arbs
}

// ═══════════════════════════════════════════════════════════════════
//                  STRATEGY MANAGER
// ═══════════════════════════════════════════════════════════════════

export class StrategyManager {
    private quoter: DEXQuoter;
    private zeroEx: ZeroExClient;
    private provider: ethers.Provider;
    private contractAddress: string;
    private minProfitUsd: number;
    private slippageBps: number;
    private flashLoanPremiumBps: number;
    private poolDiscovery: PoolDiscovery;
    private useDynamicDiscovery: boolean = false;

    // Price cache (updated each cycle)
    private ethPriceUsd: number = 0;
    private btcPriceUsd: number = 0;

    constructor(
        provider: ethers.Provider,
        contractAddress: string,
        zeroExApiKey: string,
        config: {
            minProfitUsd: number;
            slippageBps: number;
            flashLoanPremiumBps: number;
            minLiquidityUsd?: number;
            discoveryRefreshMs?: number;
        }
    ) {
        this.provider = provider;
        this.contractAddress = contractAddress;
        this.quoter = new DEXQuoter(provider);
        this.zeroEx = new ZeroExClient(zeroExApiKey);
        this.minProfitUsd = config.minProfitUsd;
        this.slippageBps = config.slippageBps;
        this.flashLoanPremiumBps = config.flashLoanPremiumBps;
        this.poolDiscovery = new PoolDiscovery(provider, {
            minLiquidityUsd: config.minLiquidityUsd || 10000,
            refreshIntervalMs: config.discoveryRefreshMs || 300000,
        });
    }

    /// @notice Starts the dynamic pool discovery engine
    async startDiscovery(ethPrice: number, btcPrice: number): Promise<void> {
        await this.poolDiscovery.start(ethPrice, btcPrice);
        this.useDynamicDiscovery = true;
        const stats = this.poolDiscovery.getStats();
        logger.info(`🔎 Dynamic discovery active: ${stats.activePools} pools → ${stats.arbitrageablePairs} arb pairs → ${stats.triangularPaths} triangles`);
    }

    /// @notice Stops the dynamic pool discovery engine
    stopDiscovery(): void {
        this.poolDiscovery.stop();
        this.useDynamicDiscovery = false;
    }

    /// @notice Returns pool discovery stats
    getDiscoveryStats() {
        return this.poolDiscovery.getStats();
    }

    // ═══════════════════════════════════════════════════════════════
    //                    MAIN SCAN LOOP
    // ═══════════════════════════════════════════════════════════════

    async scanForOpportunities(): Promise<ArbOpportunity[]> {
        const opportunities: ArbOpportunity[] = [];

        // Update pool discovery prices
        if (this.useDynamicDiscovery) {
            this.poolDiscovery.updatePrices(this.ethPriceUsd, this.btcPriceUsd);
        }

        // Strategy 1: Direct cross-DEX arbitrage (static + dynamic pairs)
        const directArbs = await this.findDirectArbs();
        opportunities.push(...directArbs);

        // Strategy 2: Triangular arbitrage (static + dynamic paths)
        const triArbs = await this.findTriangularArbs();
        opportunities.push(...triArbs);

        // Strategy 3: LST arbitrage (ETH derivatives)
        const lstArbs = await this.findLSTArbs();
        opportunities.push(...lstArbs);

        // Strategy 4: Stablecoin arbitrage
        const stableArbs = await this.findStableArbs();
        opportunities.push(...stableArbs);

        // Strategy 5: 0x aggregator arbitrage
        const zeroExArbs = await this.findZeroExArbs();
        opportunities.push(...zeroExArbs);

        // Strategy 6: Dynamic discovery arbitrage (newly discovered pools)
        if (this.useDynamicDiscovery) {
            const dynamicArbs = await this.findDynamicArbs();
            opportunities.push(...dynamicArbs);
        }

        // Filter by minimum profit
        const profitable = opportunities.filter((opp) => opp.netProfitUsd >= this.minProfitUsd);

        // Sort by net profit descending
        profitable.sort((a, b) => b.netProfitUsd - a.netProfitUsd);

        return profitable;
    }

    // ═══════════════════════════════════════════════════════════════
    //              STRATEGY 1: DIRECT CROSS-DEX ARB
    // ═══════════════════════════════════════════════════════════════

    private async findDirectArbs(): Promise<ArbOpportunity[]> {
        const opportunities: ArbOpportunity[] = [];

        // Merge static curated pairs with dynamically discovered pairs
        const staticPairs = HIGH_LIQUIDITY_PAIRS.map((p) => ({ tokenA: p.tokenA, tokenB: p.tokenB }));
        const dynamicPairs = this.useDynamicDiscovery ? this.poolDiscovery.getDynamicPairs() : [];

        // Deduplicate: use Set of sorted pair keys
        const seenKeys = new Set<string>();
        const allPairs: Array<{ tokenA: string; tokenB: string }> = [];

        for (const pair of [...staticPairs, ...dynamicPairs]) {
            const key = [pair.tokenA, pair.tokenB].sort().join("-");
            if (!seenKeys.has(key)) {
                seenKeys.add(key);
                allPairs.push(pair);
            }
        }

        if (dynamicPairs.length > 0) {
            logger.debug(`📊 Direct arb scan: ${staticPairs.length} static + ${dynamicPairs.length} dynamic = ${allPairs.length} unique pairs`);
        }

        for (const pair of allPairs) {
            try {
                const tokenA = TOKENS[pair.tokenA];
                const tokenB = TOKENS[pair.tokenB];
                if (!tokenA || !tokenB) continue;

                // Determine borrow amounts based on token type
                const borrowAmounts = this.getBorrowAmounts(pair.tokenA);

                for (const borrowAmount of borrowAmounts) {
                    // Get all quotes for A→B
                    const buyQuotes = await this.quoter.getAllQuotes(
                        pair.tokenA,
                        pair.tokenB,
                        borrowAmount
                    );

                    if (buyQuotes.length < 2) continue;

                    // For each buy quote, find the best sell quote back
                    for (const buyQuote of buyQuotes) {
                        // Get all quotes for B→A (selling back)
                        const sellQuotes = await this.quoter.getAllQuotes(
                            pair.tokenB,
                            pair.tokenA,
                            buyQuote.amountOut
                        );

                        for (const sellQuote of sellQuotes) {
                            // Skip same DEX (no arb)
                            if (buyQuote.dexId === sellQuote.dexId && buyQuote.fee === sellQuote.fee) continue;

                            // Calculate profit
                            const flashLoanCost = (borrowAmount * BigInt(this.flashLoanPremiumBps)) / 10000n;
                            const totalReturn = sellQuote.amountOut;
                            const totalCost = borrowAmount + flashLoanCost;

                            if (totalReturn <= totalCost) continue;

                            const profit = totalReturn - totalCost;
                            const profitBps = Number((profit * 10000n) / borrowAmount);
                            const profitUsd = this.tokenAmountToUsd(pair.tokenA, profit);
                            const gasEstimate = (buyQuote.gasEstimate || 150000n) + (sellQuote.gasEstimate || 150000n) + 100000n;
                            const gasCostUsd = this.gasToUsd(gasEstimate);
                            const netProfitUsd = profitUsd - gasCostUsd;

                            if (netProfitUsd < this.minProfitUsd) continue;

                            const slippageMultiplier = BigInt(10000 - this.slippageBps);

                            opportunities.push({
                                strategyType: StrategyType.DIRECT_ARB,
                                borrowAsset: pair.tokenA,
                                borrowAmount,
                                legs: [
                                    {
                                        dexId: buyQuote.dexId,
                                        dexName: buyQuote.dexName,
                                        tokenIn: tokenA.address,
                                        tokenOut: tokenB.address,
                                        amountIn: borrowAmount,
                                        expectedAmountOut: buyQuote.amountOut,
                                        amountOutMin: (buyQuote.amountOut * slippageMultiplier) / 10000n,
                                        fee: buyQuote.fee,
                                        extraData: buyQuote.extraData,
                                    },
                                    {
                                        dexId: sellQuote.dexId,
                                        dexName: sellQuote.dexName,
                                        tokenIn: tokenB.address,
                                        tokenOut: tokenA.address,
                                        amountIn: 0n, // Use output from previous leg
                                        expectedAmountOut: sellQuote.amountOut,
                                        amountOutMin: (totalCost * BigInt(10000 + 1)) / 10000n, // At least break even + 0.01%
                                        fee: sellQuote.fee,
                                        extraData: sellQuote.extraData,
                                    },
                                ],
                                expectedProfit: profit,
                                profitBps,
                                profitUsd,
                                totalGasEstimate: gasEstimate,
                                gasCostUsd,
                                netProfitUsd,
                                timestamp: Date.now(),
                            });

                            TradeLogger.logOpportunity({
                                pair: `${pair.tokenA}/${pair.tokenB}`,
                                buyDex: buyQuote.dexName,
                                sellDex: sellQuote.dexName,
                                profitBps,
                                profitUsd: netProfitUsd,
                                borrowAmount: ethers.formatUnits(borrowAmount, tokenA.decimals),
                                asset: pair.tokenA,
                            });
                        }
                    }
                }
            } catch (error: any) {
                logger.debug(`Direct arb scan error for ${pair.tokenA}/${pair.tokenB}: ${error.message}`);
            }
        }

        return opportunities;
    }

    // ═══════════════════════════════════════════════════════════════
    //              STRATEGY 2: TRIANGULAR ARBITRAGE
    // ═══════════════════════════════════════════════════════════════

    private async findTriangularArbs(): Promise<ArbOpportunity[]> {
        const opportunities: ArbOpportunity[] = [];

        // Static curated triangular paths
        const staticPaths = [
            { a: "WETH", b: "USDC", c: "cbETH" },
            { a: "WETH", b: "USDC", c: "wstETH" },
            { a: "WETH", b: "USDC", c: "cbBTC" },
            { a: "USDC", b: "WETH", c: "cbETH" },
            { a: "USDC", b: "WETH", c: "wstETH" },
            { a: "WETH", b: "cbETH", c: "wstETH" },
            { a: "WETH", b: "weETH", c: "wstETH" },
            { a: "cbBTC", b: "WETH", c: "USDC" },
            { a: "USDC", b: "WETH", c: "USDbC" },
            { a: "WETH", b: "USDC", c: "GHO" },
        ];

        // Merge with dynamically discovered triangular paths
        const dynamicPaths = this.useDynamicDiscovery ? this.poolDiscovery.getTriangularPaths() : [];

        // Deduplicate
        const seenKeys = new Set<string>();
        const allPaths: Array<{ a: string; b: string; c: string }> = [];

        for (const path of [...staticPaths, ...dynamicPaths]) {
            const key = [path.a, path.b, path.c].sort().join("-");
            if (!seenKeys.has(key)) {
                seenKeys.add(key);
                allPaths.push(path);
            }
        }

        if (dynamicPaths.length > 0) {
            logger.debug(`📐 Triangular scan: ${staticPaths.length} static + ${dynamicPaths.length} dynamic = ${allPaths.length} unique paths`);
        }

        for (const path of allPaths) {
            try {
                const tokenA = TOKENS[path.a];
                const tokenB = TOKENS[path.b];
                const tokenC = TOKENS[path.c];
                if (!tokenA || !tokenB || !tokenC) continue;

                const borrowAmounts = this.getBorrowAmounts(path.a);

                for (const borrowAmount of borrowAmounts) {
                    // Leg 1: A → B (best quote)
                    const leg1Quote = await this.quoter.getBestQuote(path.a, path.b, borrowAmount);
                    if (!leg1Quote || leg1Quote.amountOut === 0n) continue;

                    // Leg 2: B → C (best quote)
                    const leg2Quote = await this.quoter.getBestQuote(path.b, path.c, leg1Quote.amountOut);
                    if (!leg2Quote || leg2Quote.amountOut === 0n) continue;

                    // Leg 3: C → A (best quote)
                    const leg3Quote = await this.quoter.getBestQuote(path.c, path.a, leg2Quote.amountOut);
                    if (!leg3Quote || leg3Quote.amountOut === 0n) continue;

                    // Calculate profit
                    const flashLoanCost = (borrowAmount * BigInt(this.flashLoanPremiumBps)) / 10000n;
                    const totalReturn = leg3Quote.amountOut;
                    const totalCost = borrowAmount + flashLoanCost;

                    if (totalReturn <= totalCost) continue;

                    const profit = totalReturn - totalCost;
                    const profitBps = Number((profit * 10000n) / borrowAmount);
                    const profitUsd = this.tokenAmountToUsd(path.a, profit);
                    const gasEstimate = (leg1Quote.gasEstimate || 150000n) +
                        (leg2Quote.gasEstimate || 150000n) +
                        (leg3Quote.gasEstimate || 150000n) + 120000n;
                    const gasCostUsd = this.gasToUsd(gasEstimate);
                    const netProfitUsd = profitUsd - gasCostUsd;

                    if (netProfitUsd < this.minProfitUsd) continue;

                    const slippage = BigInt(10000 - this.slippageBps);

                    opportunities.push({
                        strategyType: StrategyType.TRIANGULAR_ARB,
                        borrowAsset: path.a,
                        borrowAmount,
                        legs: [
                            {
                                dexId: leg1Quote.dexId,
                                dexName: leg1Quote.dexName,
                                tokenIn: tokenA.address,
                                tokenOut: tokenB.address,
                                amountIn: borrowAmount,
                                expectedAmountOut: leg1Quote.amountOut,
                                amountOutMin: (leg1Quote.amountOut * slippage) / 10000n,
                                fee: leg1Quote.fee,
                                extraData: leg1Quote.extraData,
                            },
                            {
                                dexId: leg2Quote.dexId,
                                dexName: leg2Quote.dexName,
                                tokenIn: tokenB.address,
                                tokenOut: tokenC.address,
                                amountIn: 0n,
                                expectedAmountOut: leg2Quote.amountOut,
                                amountOutMin: (leg2Quote.amountOut * slippage) / 10000n,
                                fee: leg2Quote.fee,
                                extraData: leg2Quote.extraData,
                            },
                            {
                                dexId: leg3Quote.dexId,
                                dexName: leg3Quote.dexName,
                                tokenIn: tokenC.address,
                                tokenOut: tokenA.address,
                                amountIn: 0n,
                                expectedAmountOut: leg3Quote.amountOut,
                                amountOutMin: (totalCost * BigInt(10000 + 1)) / 10000n,
                                fee: leg3Quote.fee,
                                extraData: leg3Quote.extraData,
                            },
                        ],
                        expectedProfit: profit,
                        profitBps,
                        profitUsd,
                        totalGasEstimate: gasEstimate,
                        gasCostUsd,
                        netProfitUsd,
                        timestamp: Date.now(),
                    });
                }
            } catch (error: any) {
                logger.debug(`Triangular arb error: ${error.message}`);
            }
        }

        return opportunities;
    }

    // ═══════════════════════════════════════════════════════════════
    //              STRATEGY 3: LST ARBITRAGE
    // ═══════════════════════════════════════════════════════════════

    private async findLSTArbs(): Promise<ArbOpportunity[]> {
        const opportunities: ArbOpportunity[] = [];

        // LST pairs that should trade near parity
        const lstPairs = [
            { base: "WETH", lst: "cbETH" },
            { base: "WETH", lst: "wstETH" },
            { base: "WETH", lst: "weETH" },
            { base: "WETH", lst: "ezETH" },
            { base: "WETH", lst: "wrsETH" },
            { base: "cbBTC", lst: "LBTC" },
            { base: "cbBTC", lst: "tBTC" },
        ];

        for (const pair of lstPairs) {
            try {
                const borrowAmounts = this.getBorrowAmounts(pair.base);

                for (const borrowAmount of borrowAmounts) {
                    // Check both directions
                    for (const [buyToken, sellToken] of [[pair.base, pair.lst], [pair.lst, pair.base]]) {
                        const actualBorrow = buyToken === pair.base ? borrowAmount : borrowAmount;
                        const quotes = await this.quoter.getAllQuotes(buyToken, sellToken, actualBorrow);

                        if (quotes.length < 2) continue;

                        const bestBuy = quotes[0];
                        const sellQuotes = await this.quoter.getAllQuotes(sellToken, buyToken, bestBuy.amountOut);

                        for (const sellQuote of sellQuotes) {
                            if (bestBuy.dexId === sellQuote.dexId && bestBuy.fee === sellQuote.fee) continue;

                            const flashLoanCost = (actualBorrow * BigInt(this.flashLoanPremiumBps)) / 10000n;
                            const totalReturn = sellQuote.amountOut;
                            const totalCost = actualBorrow + flashLoanCost;

                            if (totalReturn <= totalCost) continue;

                            const profit = totalReturn - totalCost;
                            const profitBps = Number((profit * 10000n) / actualBorrow);
                            const profitUsd = this.tokenAmountToUsd(buyToken, profit);
                            const gasEstimate = (bestBuy.gasEstimate || 150000n) + (sellQuote.gasEstimate || 150000n) + 100000n;
                            const gasCostUsd = this.gasToUsd(gasEstimate);
                            const netProfitUsd = profitUsd - gasCostUsd;

                            if (netProfitUsd < this.minProfitUsd) continue;

                            const slippage = BigInt(10000 - this.slippageBps);
                            const tokenIn = TOKENS[buyToken];
                            const tokenOut = TOKENS[sellToken];

                            opportunities.push({
                                strategyType: StrategyType.LST_ARB,
                                borrowAsset: buyToken,
                                borrowAmount: actualBorrow,
                                legs: [
                                    {
                                        dexId: bestBuy.dexId,
                                        dexName: bestBuy.dexName,
                                        tokenIn: tokenIn.address,
                                        tokenOut: tokenOut.address,
                                        amountIn: actualBorrow,
                                        expectedAmountOut: bestBuy.amountOut,
                                        amountOutMin: (bestBuy.amountOut * slippage) / 10000n,
                                        fee: bestBuy.fee,
                                        extraData: bestBuy.extraData,
                                    },
                                    {
                                        dexId: sellQuote.dexId,
                                        dexName: sellQuote.dexName,
                                        tokenIn: tokenOut.address,
                                        tokenOut: tokenIn.address,
                                        amountIn: 0n,
                                        expectedAmountOut: sellQuote.amountOut,
                                        amountOutMin: (totalCost * BigInt(10000 + 1)) / 10000n,
                                        fee: sellQuote.fee,
                                        extraData: sellQuote.extraData,
                                    },
                                ],
                                expectedProfit: profit,
                                profitBps,
                                profitUsd,
                                totalGasEstimate: gasEstimate,
                                gasCostUsd,
                                netProfitUsd,
                                timestamp: Date.now(),
                            });
                        }
                    }
                }
            } catch (error: any) {
                logger.debug(`LST arb error: ${error.message}`);
            }
        }

        return opportunities;
    }

    // ═══════════════════════════════════════════════════════════════
    //              STRATEGY 4: STABLECOIN ARBITRAGE
    // ═══════════════════════════════════════════════════════════════

    private async findStableArbs(): Promise<ArbOpportunity[]> {
        const opportunities: ArbOpportunity[] = [];

        const stablePairs = [
            { a: "USDC", b: "USDbC" },
            { a: "USDC", b: "GHO" },
            { a: "USDC", b: "EURC" },
        ];

        for (const pair of stablePairs) {
            try {
                const tokenA = TOKENS[pair.a];
                const tokenB = TOKENS[pair.b];
                if (!tokenA || !tokenB) continue;

                // Stablecoins: use larger amounts for meaningful profit
                const amounts = [
                    ethers.parseUnits("10000", tokenA.decimals),
                    ethers.parseUnits("50000", tokenA.decimals),
                    ethers.parseUnits("100000", tokenA.decimals),
                ];

                for (const borrowAmount of amounts) {
                    const buyQuotes = await this.quoter.getAllQuotes(pair.a, pair.b, borrowAmount);
                    if (buyQuotes.length < 1) continue;

                    for (const buyQuote of buyQuotes) {
                        const sellQuotes = await this.quoter.getAllQuotes(pair.b, pair.a, buyQuote.amountOut);

                        for (const sellQuote of sellQuotes) {
                            if (buyQuote.dexId === sellQuote.dexId && buyQuote.fee === sellQuote.fee) continue;

                            const flashLoanCost = (borrowAmount * BigInt(this.flashLoanPremiumBps)) / 10000n;
                            const totalReturn = sellQuote.amountOut;
                            const totalCost = borrowAmount + flashLoanCost;

                            if (totalReturn <= totalCost) continue;

                            const profit = totalReturn - totalCost;
                            const profitBps = Number((profit * 10000n) / borrowAmount);
                            const profitUsd = Number(ethers.formatUnits(profit, tokenA.decimals));
                            const gasEstimate = (buyQuote.gasEstimate || 120000n) + (sellQuote.gasEstimate || 120000n) + 100000n;
                            const gasCostUsd = this.gasToUsd(gasEstimate);
                            const netProfitUsd = profitUsd - gasCostUsd;

                            if (netProfitUsd < this.minProfitUsd) continue;

                            const slippage = BigInt(10000 - this.slippageBps);

                            opportunities.push({
                                strategyType: StrategyType.STABLE_ARB,
                                borrowAsset: pair.a,
                                borrowAmount,
                                legs: [
                                    {
                                        dexId: buyQuote.dexId,
                                        dexName: buyQuote.dexName,
                                        tokenIn: tokenA.address,
                                        tokenOut: tokenB.address,
                                        amountIn: borrowAmount,
                                        expectedAmountOut: buyQuote.amountOut,
                                        amountOutMin: (buyQuote.amountOut * slippage) / 10000n,
                                        fee: buyQuote.fee,
                                        extraData: buyQuote.extraData,
                                    },
                                    {
                                        dexId: sellQuote.dexId,
                                        dexName: sellQuote.dexName,
                                        tokenIn: tokenB.address,
                                        tokenOut: tokenA.address,
                                        amountIn: 0n,
                                        expectedAmountOut: sellQuote.amountOut,
                                        amountOutMin: (totalCost * BigInt(10000 + 1)) / 10000n,
                                        fee: sellQuote.fee,
                                        extraData: sellQuote.extraData,
                                    },
                                ],
                                expectedProfit: profit,
                                profitBps,
                                profitUsd,
                                totalGasEstimate: gasEstimate,
                                gasCostUsd,
                                netProfitUsd,
                                timestamp: Date.now(),
                            });
                        }
                    }
                }
            } catch (error: any) {
                logger.debug(`Stable arb error: ${error.message}`);
            }
        }

        return opportunities;
    }

    // ═══════════════════════════════════════════════════════════════
    //              STRATEGY 5: 0x AGGREGATOR ARBITRAGE
    // ═══════════════════════════════════════════════════════════════

    private async findZeroExArbs(): Promise<ArbOpportunity[]> {
        const opportunities: ArbOpportunity[] = [];

        // Compare 0x aggregated price vs best single-DEX price
        const pairsToCheck = [
            { a: "WETH", b: "USDC" },
            { a: "WETH", b: "cbETH" },
            { a: "cbBTC", b: "WETH" },
            { a: "USDC", b: "USDbC" },
        ];

        for (const pair of pairsToCheck) {
            try {
                const tokenA = TOKENS[pair.a];
                const tokenB = TOKENS[pair.b];
                if (!tokenA || !tokenB) continue;

                const borrowAmounts = this.getBorrowAmounts(pair.a);

                for (const borrowAmount of borrowAmounts) {
                    // Get 0x price for A→B
                    const zeroExPrice = await this.zeroEx.getPrice(
                        tokenA.address,
                        tokenB.address,
                        borrowAmount.toString(),
                        this.contractAddress
                    );

                    if (!zeroExPrice) continue;

                    const zeroExAmountOut = BigInt(zeroExPrice.buyAmount);

                    // Get best direct DEX quote for B→A
                    const sellQuote = await this.quoter.getBestQuote(pair.b, pair.a, zeroExAmountOut);
                    if (!sellQuote) continue;

                    const flashLoanCost = (borrowAmount * BigInt(this.flashLoanPremiumBps)) / 10000n;
                    const totalReturn = sellQuote.amountOut;
                    const totalCost = borrowAmount + flashLoanCost;

                    if (totalReturn <= totalCost) continue;

                    const profit = totalReturn - totalCost;
                    const profitUsd = this.tokenAmountToUsd(pair.a, profit);
                    const gasEstimate = BigInt(zeroExPrice.estimatedGas) + (sellQuote.gasEstimate || 150000n) + 100000n;
                    const gasCostUsd = this.gasToUsd(gasEstimate);
                    const netProfitUsd = profitUsd - gasCostUsd;

                    if (netProfitUsd < this.minProfitUsd) continue;

                    // Get firm quote with calldata for execution
                    const firmQuote = await this.zeroEx.getQuote(
                        tokenA.address,
                        tokenB.address,
                        borrowAmount.toString(),
                        this.contractAddress,
                        this.slippageBps
                    );

                    if (!firmQuote) continue;

                    const slippage = BigInt(10000 - this.slippageBps);

                    opportunities.push({
                        strategyType: StrategyType.ZEROX_ARB,
                        borrowAsset: pair.a,
                        borrowAmount,
                        legs: [
                            {
                                dexId: DEXId.ZEROX,
                                dexName: `0x (${zeroExPrice.sources?.map((s: any) => s.name).join("+") || "aggregated"})`,
                                tokenIn: tokenA.address,
                                tokenOut: tokenB.address,
                                amountIn: borrowAmount,
                                expectedAmountOut: zeroExAmountOut,
                                amountOutMin: (zeroExAmountOut * slippage) / 10000n,
                                fee: 0,
                                extraData: this.zeroEx.encodeForContract(firmQuote, tokenA.address),
                            },
                            {
                                dexId: sellQuote.dexId,
                                dexName: sellQuote.dexName,
                                tokenIn: tokenB.address,
                                tokenOut: tokenA.address,
                                amountIn: 0n,
                                expectedAmountOut: sellQuote.amountOut,
                                amountOutMin: (totalCost * BigInt(10000 + 1)) / 10000n,
                                fee: sellQuote.fee,
                                extraData: sellQuote.extraData,
                            },
                        ],
                        expectedProfit: profit,
                        profitBps: Number((profit * 10000n) / borrowAmount),
                        profitUsd,
                        totalGasEstimate: gasEstimate,
                        gasCostUsd,
                        netProfitUsd,
                        timestamp: Date.now(),
                    });
                }
            } catch (error: any) {
                logger.debug(`0x arb error: ${error.message}`);
            }
        }

        return opportunities;
    }

    // ═══════════════════════════════════════════════════════════════
    //          STRATEGY 6: DYNAMIC DISCOVERY ARBITRAGE
    // ═══════════════════════════════════════════════════════════════

    private async findDynamicArbs(): Promise<ArbOpportunity[]> {
        const opportunities: ArbOpportunity[] = [];

        if (!this.useDynamicDiscovery) return opportunities;

        // Get all arbitrageable pairs from pool discovery
        // (pairs that exist on ≥2 different DEXs with sufficient liquidity)
        const arbPairs = this.poolDiscovery.getArbitrageablePairs();

        // Filter to pairs NOT already covered by static HIGH_LIQUIDITY_PAIRS
        const staticKeys = new Set(
            HIGH_LIQUIDITY_PAIRS.map((p) => [p.tokenA, p.tokenB].sort().join("-"))
        );

        const novelPairs = arbPairs.filter((pair) => {
            const key = [pair.tokenASymbol, pair.tokenBSymbol].sort().join("-");
            return !staticKeys.has(key);
        });

        if (novelPairs.length === 0) return opportunities;

        logger.debug(`🆕 Dynamic arb scan: ${novelPairs.length} novel pairs from pool discovery`);

        for (const pair of novelPairs) {
            try {
                const tokenA = TOKENS[pair.tokenASymbol];
                const tokenB = TOKENS[pair.tokenBSymbol];

                // Skip pairs where neither token is Aave-borrowable
                if (!tokenA && !tokenB) continue;

                // Determine which token to borrow (must be Aave-borrowable)
                const borrowSymbol = tokenA ? pair.tokenASymbol : pair.tokenBSymbol;
                const otherSymbol = tokenA ? pair.tokenBSymbol : pair.tokenASymbol;
                const borrowToken = TOKENS[borrowSymbol];
                const otherToken = TOKENS[otherSymbol];

                if (!borrowToken || !otherToken) continue;

                const borrowAmounts = this.getBorrowAmounts(borrowSymbol);

                for (const borrowAmount of borrowAmounts) {
                    // Get all quotes for borrow→other
                    const buyQuotes = await this.quoter.getAllQuotes(
                        borrowSymbol,
                        otherSymbol,
                        borrowAmount
                    );

                    if (buyQuotes.length < 2) continue;

                    // For each buy quote, find sell quotes back
                    for (const buyQuote of buyQuotes) {
                        const sellQuotes = await this.quoter.getAllQuotes(
                            otherSymbol,
                            borrowSymbol,
                            buyQuote.amountOut
                        );

                        for (const sellQuote of sellQuotes) {
                            // Skip same DEX + same fee
                            if (buyQuote.dexId === sellQuote.dexId && buyQuote.fee === sellQuote.fee) continue;

                            // Calculate profit
                            const flashLoanCost = (borrowAmount * BigInt(this.flashLoanPremiumBps)) / 10000n;
                            const totalReturn = sellQuote.amountOut;
                            const totalCost = borrowAmount + flashLoanCost;

                            if (totalReturn <= totalCost) continue;

                            const profit = totalReturn - totalCost;
                            const profitBps = Number((profit * 10000n) / borrowAmount);
                            const profitUsd = this.tokenAmountToUsd(borrowSymbol, profit);
                            const gasEstimate = (buyQuote.gasEstimate || 150000n) + (sellQuote.gasEstimate || 150000n) + 100000n;
                            const gasCostUsd = this.gasToUsd(gasEstimate);
                            const netProfitUsd = profitUsd - gasCostUsd;

                            if (netProfitUsd < this.minProfitUsd) continue;

                            const slippageMultiplier = BigInt(10000 - this.slippageBps);

                            opportunities.push({
                                strategyType: StrategyType.MULTI_HOP_ARB,
                                borrowAsset: borrowSymbol,
                                borrowAmount,
                                legs: [
                                    {
                                        dexId: buyQuote.dexId,
                                        dexName: buyQuote.dexName,
                                        tokenIn: borrowToken.address,
                                        tokenOut: otherToken.address,
                                        amountIn: borrowAmount,
                                        expectedAmountOut: buyQuote.amountOut,
                                        amountOutMin: (buyQuote.amountOut * slippageMultiplier) / 10000n,
                                        fee: buyQuote.fee,
                                        extraData: buyQuote.extraData,
                                    },
                                    {
                                        dexId: sellQuote.dexId,
                                        dexName: sellQuote.dexName,
                                        tokenIn: otherToken.address,
                                        tokenOut: borrowToken.address,
                                        amountIn: 0n,
                                        expectedAmountOut: sellQuote.amountOut,
                                        amountOutMin: (totalCost * BigInt(10000 + 1)) / 10000n,
                                        fee: sellQuote.fee,
                                        extraData: sellQuote.extraData,
                                    },
                                ],
                                expectedProfit: profit,
                                profitBps,
                                profitUsd,
                                totalGasEstimate: gasEstimate,
                                gasCostUsd,
                                netProfitUsd,
                                timestamp: Date.now(),
                            });

                            TradeLogger.logOpportunity({
                                pair: `${borrowSymbol}/${otherSymbol} [DYNAMIC]`,
                                buyDex: buyQuote.dexName,
                                sellDex: sellQuote.dexName,
                                profitBps,
                                profitUsd: netProfitUsd,
                                borrowAmount: ethers.formatUnits(borrowAmount, borrowToken.decimals),
                                asset: borrowSymbol,
                            });
                        }
                    }
                }
            } catch (error: any) {
                logger.debug(`Dynamic arb scan error for ${pair.tokenASymbol}/${pair.tokenBSymbol}: ${error.message}`);
            }
        }

        return opportunities;
    }

    // ═══════════════════════════════════════════════════════════════
    //                    HELPER FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    private getBorrowAmounts(tokenSymbol: string): bigint[] {
        const token = TOKENS[tokenSymbol];
        if (!token) return [];

        switch (tokenSymbol) {
            case "WETH":
                return [
                    ethers.parseEther("1"),
                    ethers.parseEther("5"),
                    ethers.parseEther("10"),
                    ethers.parseEther("50"),
                    ethers.parseEther("100"),
                ];
            case "USDC":
            case "USDbC":
            case "GHO":
                return [
                    ethers.parseUnits("5000", 6),
                    ethers.parseUnits("25000", 6),
                    ethers.parseUnits("100000", 6),
                    ethers.parseUnits("250000", 6),
                ];
            case "cbBTC":
            case "LBTC":
                return [
                    ethers.parseUnits("0.1", 8),
                    ethers.parseUnits("0.5", 8),
                    ethers.parseUnits("1", 8),
                    ethers.parseUnits("5", 8),
                ];
            case "cbETH":
            case "wstETH":
            case "weETH":
            case "ezETH":
            case "wrsETH":
                return [
                    ethers.parseEther("1"),
                    ethers.parseEther("5"),
                    ethers.parseEther("25"),
                    ethers.parseEther("50"),
                ];
            case "EURC":
                return [
                    ethers.parseUnits("5000", 6),
                    ethers.parseUnits("25000", 6),
                    ethers.parseUnits("100000", 6),
                ];
            default:
                return [ethers.parseUnits("1", token.decimals)];
        }
    }

    updatePrices(ethPrice: number, btcPrice: number) {
        this.ethPriceUsd = ethPrice;
        this.btcPriceUsd = btcPrice;
        if (this.useDynamicDiscovery) {
            this.poolDiscovery.updatePrices(ethPrice, btcPrice);
        }
    }

    private tokenAmountToUsd(tokenSymbol: string, amount: bigint): number {
        const token = TOKENS[tokenSymbol];
        if (!token) return 0;

        const humanAmount = Number(ethers.formatUnits(amount, token.decimals));

        switch (tokenSymbol) {
            case "WETH":
            case "cbETH":
            case "wstETH":
            case "weETH":
            case "ezETH":
            case "wrsETH":
                return humanAmount * this.ethPriceUsd;
            case "cbBTC":
            case "LBTC":
            case "tBTC":
                return humanAmount * this.btcPriceUsd;
            case "USDC":
            case "USDbC":
            case "GHO":
            case "syrupUSDC":
                return humanAmount;
            case "EURC":
                return humanAmount * 1.08; // Approximate EUR/USD
            case "AAVE":
                return humanAmount * 200; // Approximate AAVE price
            default:
                return 0;
        }
    }

    private gasToUsd(gasUnits: bigint): number {
        // Base chain gas is very cheap (~0.001 gwei)
        const gasPriceGwei = 0.005; // Conservative estimate
        const gasCostEth = Number(gasUnits) * gasPriceGwei * 1e-9;
        return gasCostEth * this.ethPriceUsd;
    }

    // ═══════════════════════════════════════════════════════════════
    //              ENCODE STRATEGY FOR ON-CHAIN
    // ═══════════════════════════════════════════════════════════════

    encodeStrategy(opportunity: ArbOpportunity): string {
        const legsEncoded = opportunity.legs.map((leg) => ({
            dexId: leg.dexId,
            tokenIn: leg.tokenIn,
            tokenOut: leg.tokenOut,
            amountIn: leg.amountIn,
            amountOutMin: leg.amountOutMin,
            extraData: leg.extraData,
        }));

        return ethers.AbiCoder.defaultAbiCoder().encode(
            [
                "tuple(tuple(uint8 dexId, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin, bytes extraData)[] legs, uint256 minProfitAmount, bool useBalanceDiff)",
            ],
            [
                {
                    legs: legsEncoded,
                    minProfitAmount: 0n, // Enforced by amountOutMin on last leg
                    useBalanceDiff: true,
                },
            ]
        );
    }
}