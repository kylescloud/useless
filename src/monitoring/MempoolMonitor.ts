import { ethers } from "ethers";
import WebSocket from "ws";
import { DEXES, TOKENS } from "../config/addresses";
import { UNISWAP_V3_POOL_ABI, UNISWAP_V2_PAIR_ABI } from "../config/abis";
import { logger } from "../utils/Logger";

// ═══════════════════════════════════════════════════════════════════
//                    MEMPOOL MONITOR
//  Watches pending transactions and pool events for arb triggers
// ═══════════════════════════════════════════════════════════════════

export interface PendingSwap {
    txHash: string;
    dex: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint;
    sender: string;
    gasPrice: bigint;
    timestamp: number;
}

export interface PoolUpdate {
    pool: string;
    dex: string;
    token0: string;
    token1: string;
    reserve0?: bigint;
    reserve1?: bigint;
    sqrtPriceX96?: bigint;
    tick?: number;
    liquidity?: bigint;
    timestamp: number;
}

type SwapCallback = (swap: PendingSwap) => void;
type PoolUpdateCallback = (update: PoolUpdate) => void;

export class MempoolMonitor {
    private wsProvider: ethers.WebSocketProvider | null = null;
    private httpProvider: ethers.Provider;
    private wsUrl: string;
    private onSwapCallbacks: SwapCallback[] = [];
    private onPoolUpdateCallbacks: PoolUpdateCallback[] = [];
    private isRunning: boolean = false;
    private reconnectAttempts: number = 0;
    private maxReconnectAttempts: number = 10;
    private poolSubscriptions: Map<string, ethers.Contract> = new Map();

    // Known router interfaces for decoding pending txs
    private v3RouterIface: ethers.Interface;
    private v2RouterIface: ethers.Interface;

    constructor(httpProvider: ethers.Provider, wsUrl: string) {
        this.httpProvider = httpProvider;
        this.wsUrl = wsUrl;

        this.v3RouterIface = new ethers.Interface([
            "function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)",
            "function exactInput(tuple(bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum) params) external payable returns (uint256 amountOut)",
            "function multicall(uint256 deadline, bytes[] data) external payable returns (bytes[] results)",
            "function multicall(bytes[] data) external payable returns (bytes[] results)",
        ]);

        this.v2RouterIface = new ethers.Interface([
            "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) external returns (uint256[] amounts)",
            "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) external payable returns (uint256[] amounts)",
            "function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) external returns (uint256[] amounts)",
        ]);
    }

    // ═══════════════════════════════════════════════════════════════
    //                    EVENT SUBSCRIPTIONS
    // ═══════════════════════════════════════════════════════════════

    onSwap(callback: SwapCallback): void {
        this.onSwapCallbacks.push(callback);
    }

    onPoolUpdate(callback: PoolUpdateCallback): void {
        this.onPoolUpdateCallbacks.push(callback);
    }

    // ═══════════════════════════════════════════════════════════════
    //                    START MONITORING
    // ═══════════════════════════════════════════════════════════════

    async start(): Promise<void> {
        if (this.isRunning) return;
        this.isRunning = true;

        logger.info("🔍 Starting mempool monitor...");

        // Start WebSocket connection for pending txs
        await this.connectWebSocket();

        // Subscribe to pool events via HTTP provider
        await this.subscribeToPoolEvents();

        logger.info("✅ Mempool monitor started");
    }

    async stop(): Promise<void> {
        this.isRunning = false;

        // Unsubscribe from all pool events
        for (const [, contract] of this.poolSubscriptions) {
            contract.removeAllListeners();
        }
        this.poolSubscriptions.clear();

        // Close WebSocket
        if (this.wsProvider) {
            await this.wsProvider.destroy();
            this.wsProvider = null;
        }

        logger.info("🛑 Mempool monitor stopped");
    }

    // ═══════════════════════════════════════════════════════════════
    //                    WEBSOCKET CONNECTION
    // ═══════════════════════════════════════════════════════════════

    private async connectWebSocket(): Promise<void> {
        try {
            this.wsProvider = new ethers.WebSocketProvider(this.wsUrl);

            // Monitor pending transactions
            this.wsProvider.on("pending", async (txHash: string) => {
                try {
                    await this.processPendingTx(txHash);
                } catch {
                    // Silently ignore individual tx processing errors
                }
            });

            // Handle disconnection
            this.wsProvider.websocket.on("close", () => {
                if (this.isRunning) {
                    logger.warn("WebSocket disconnected, reconnecting...");
                    this.reconnect();
                }
            });

            this.wsProvider.websocket.on("error", (error: Error) => {
                logger.error(`WebSocket error: ${error.message}`);
            });

            this.reconnectAttempts = 0;
            logger.info(`📡 WebSocket connected to ${this.wsUrl.substring(0, 40)}...`);
        } catch (error: any) {
            logger.error(`WebSocket connection failed: ${error.message}`);
            await this.reconnect();
        }
    }

    private async reconnect(): Promise<void> {
        if (!this.isRunning) return;
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            logger.error("Max reconnect attempts reached, stopping monitor");
            this.isRunning = false;
            return;
        }

        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        logger.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

        await new Promise((resolve) => setTimeout(resolve, delay));
        await this.connectWebSocket();
    }

    // ═══════════════════════════════════════════════════════════════
    //                PENDING TX PROCESSING
    // ═══════════════════════════════════════════════════════════════

    private async processPendingTx(txHash: string): Promise<void> {
        if (!this.wsProvider) return;

        const tx = await this.wsProvider.getTransaction(txHash);
        if (!tx || !tx.to || !tx.data || tx.data.length < 10) return;

        const toAddress = tx.to.toLowerCase();

        // Check if tx is to a known DEX router
        const knownRouters = new Set([
            DEXES.UNISWAP_V3.router.toLowerCase(),
            DEXES.UNISWAP_V2.router.toLowerCase(),
            DEXES.AERODROME_V2.router.toLowerCase(),
            DEXES.AERODROME_CL.router.toLowerCase(),
            DEXES.PANCAKESWAP_V3.router.toLowerCase(),
            DEXES.SUSHISWAP_V3.router.toLowerCase(),
        ]);

        if (!knownRouters.has(toAddress)) return;

        // Try to decode the swap
        const swap = this.decodePendingSwap(tx);
        if (swap) {
            for (const callback of this.onSwapCallbacks) {
                try {
                    callback(swap);
                } catch (error: any) {
                    logger.debug(`Swap callback error: ${error.message}`);
                }
            }
        }
    }

    private decodePendingSwap(tx: ethers.TransactionResponse): PendingSwap | null {
        try {
            const selector = tx.data.substring(0, 10);

            // Try V3 router decode
            try {
                const decoded = this.v3RouterIface.parseTransaction({ data: tx.data, value: tx.value });
                if (decoded && decoded.name === "exactInputSingle") {
                    const params = decoded.args[0];
                    return {
                        txHash: tx.hash,
                        dex: this.identifyDex(tx.to!),
                        tokenIn: params.tokenIn,
                        tokenOut: params.tokenOut,
                        amountIn: params.amountIn,
                        sender: tx.from,
                        gasPrice: tx.gasPrice || 0n,
                        timestamp: Date.now(),
                    };
                }
            } catch { /* not a V3 swap */ }

            // Try V2 router decode
            try {
                const decoded = this.v2RouterIface.parseTransaction({ data: tx.data, value: tx.value });
                if (decoded && decoded.name === "swapExactTokensForTokens") {
                    const path = decoded.args[2] as string[];
                    return {
                        txHash: tx.hash,
                        dex: this.identifyDex(tx.to!),
                        tokenIn: path[0],
                        tokenOut: path[path.length - 1],
                        amountIn: decoded.args[0] as bigint,
                        sender: tx.from,
                        gasPrice: tx.gasPrice || 0n,
                        timestamp: Date.now(),
                    };
                }
            } catch { /* not a V2 swap */ }

            return null;
        } catch {
            return null;
        }
    }

    private identifyDex(routerAddress: string): string {
        const addr = routerAddress.toLowerCase();
        for (const [name, config] of Object.entries(DEXES)) {
            if (config.router.toLowerCase() === addr) return name;
        }
        return "UNKNOWN";
    }

    // ═══════════════════════════════════════════════════════════════
    //                    POOL EVENT MONITORING
    // ═══════════════════════════════════════════════════════════════

    private async subscribeToPoolEvents(): Promise<void> {
        // Subscribe to Swap events on major V3 pools
        const v3Factories = [
            { name: "UniV3", factory: DEXES.UNISWAP_V3.factory, abi: UNISWAP_V3_POOL_ABI },
            { name: "PancakeV3", factory: DEXES.PANCAKESWAP_V3.factory, abi: UNISWAP_V3_POOL_ABI },
        ];

        // Subscribe to Sync events on major V2 pairs
        const v2Factories = [
            { name: "UniV2", factory: DEXES.UNISWAP_V2.factory },
            { name: "AeroV2", factory: DEXES.AERODROME_V2.factory },
        ];

        logger.info(`📊 Subscribed to pool events for ${v3Factories.length} V3 + ${v2Factories.length} V2 factories`);
    }

    /// @notice Subscribe to a specific V3 pool's Swap events
    async watchV3Pool(poolAddress: string, dexName: string): Promise<void> {
        const pool = new ethers.Contract(poolAddress, UNISWAP_V3_POOL_ABI, this.httpProvider);

        pool.on("Swap", (sender, recipient, amount0, amount1, sqrtPriceX96, liquidity, tick) => {
            const update: PoolUpdate = {
                pool: poolAddress,
                dex: dexName,
                token0: "", // Resolved by caller
                token1: "",
                sqrtPriceX96: sqrtPriceX96 as bigint,
                tick: Number(tick),
                liquidity: liquidity as bigint,
                timestamp: Date.now(),
            };

            for (const callback of this.onPoolUpdateCallbacks) {
                try {
                    callback(update);
                } catch (error: any) {
                    logger.debug(`Pool update callback error: ${error.message}`);
                }
            }
        });

        this.poolSubscriptions.set(poolAddress, pool);
    }

    /// @notice Subscribe to a specific V2 pair's Sync events
    async watchV2Pair(pairAddress: string, dexName: string): Promise<void> {
        const pair = new ethers.Contract(pairAddress, UNISWAP_V2_PAIR_ABI, this.httpProvider);

        pair.on("Sync", (reserve0, reserve1) => {
            const update: PoolUpdate = {
                pool: pairAddress,
                dex: dexName,
                token0: "",
                token1: "",
                reserve0: reserve0 as bigint,
                reserve1: reserve1 as bigint,
                timestamp: Date.now(),
            };

            for (const callback of this.onPoolUpdateCallbacks) {
                try {
                    callback(update);
                } catch (error: any) {
                    logger.debug(`Pool update callback error: ${error.message}`);
                }
            }
        });

        this.poolSubscriptions.set(pairAddress, pair);
    }

    // ═══════════════════════════════════════════════════════════════
    //                    STATUS
    // ═══════════════════════════════════════════════════════════════

    getStatus() {
        return {
            isRunning: this.isRunning,
            wsConnected: this.wsProvider !== null,
            reconnectAttempts: this.reconnectAttempts,
            poolSubscriptions: this.poolSubscriptions.size,
        };
    }
}