import { ethers } from "ethers";
import dotenv from "dotenv";

/**
 * MempoolAnalyzer - Analyzes pending transactions for MEV protection
 * Detects sandwich attacks, front-running, and competing arbitrage
 */
export class MempoolAnalyzer {
  private wsProvider: ethers.WebSocketProvider;
  private pendingTxCache: Map<string, ethers.TransactionResponse> = new Map();
  private knownArbitrageBots: Set<string> = new Set();
  private sandwichSuspects: Set<string> = new Set();

  constructor(wsRpcUrl: string) {
    this.wsProvider = new ethers.WebSocketProvider(wsRpcUrl);
    this.setupPendingTxListener();
  }

  /**
   * Set up listener for pending transactions
   */
  private setupPendingTxListener(): void {
    this.wsProvider.on("pending", async (txHash: string) => {
      try {
        const tx = await this.wsProvider.getTransaction(txHash);
        if (tx) {
          this.analyzeTransaction(tx);
        }
      } catch (error) {
        // Ignore errors from removed transactions
      }
    });
  }

  /**
   * Analyze a pending transaction for potential threats
   * @param tx Transaction to analyze
   */
  private analyzeTransaction(tx: ethers.TransactionResponse): void {
    if (!tx.to) return;

    // Check for large swaps (potential sandwich targets)
    if (this.isLargeSwap(tx)) {
      console.log(`⚠️ Large swap detected from ${tx.from}: ${tx.hash}`);
      this.markAsSuspect(tx.from);
    }

    // Check for arbitrage patterns
    if (this.isArbitrageTransaction(tx)) {
      this.recordArbitrageBot(tx.from);
      console.log(`🤖 Arbitrage bot detected: ${tx.from}`);
    }

    // Check for potential sandwich attack
    if (this.isPotentialSandwichAttack(tx)) {
      console.log(`⚡ Potential sandwich attack detected: ${tx.hash}`);
      this.markAsSuspect(tx.from);
    }

    // Cache transaction for pattern analysis
    this.pendingTxCache.set(tx.hash, tx);
    
    // Clean old transactions from cache
    if (this.pendingTxCache.size > 1000) {
      const oldestTx = this.pendingTxCache.keys().next().value;
      if (oldestTx) {
        this.pendingTxCache.delete(oldestTx);
      }
    }
  }

  /**
   * Check if transaction is a large swap (potential sandwich target)
   * @param tx Transaction to check
   * @returns True if large swap
   */
  private isLargeSwap(tx: ethers.TransactionResponse): boolean {
    if (!tx.value || tx.value === 0n) return false;
    
    // Consider swaps over 10 ETH as large
    const threshold = ethers.parseEther("10");
    return tx.value >= threshold;
  }

  /**
   * Check if transaction is an arbitrage transaction
   * @param tx Transaction to check
   * @returns True if arbitrage transaction
   */
  private isArbitrageTransaction(tx: ethers.TransactionResponse): boolean {
    if (!tx.data || tx.data.length < 10) return false;

    // Check for common DEX function selectors
    const swapSelectors = [
      "0x38ed1739", // swapExactTokensForTokens
      "0x8803dbee", // swapTokensForExactTokens
      "0x414bf389", // exactInputSingle
      "0xc04b8d59", // exactInput
      "0xdb3e2198", // V3 swap
    ];

    const selector = tx.data.slice(0, 10);
    return swapSelectors.includes(selector);
  }

  /**
   * Check if transaction is part of a potential sandwich attack
   * @param tx Transaction to check
   * @returns True if potential sandwich attack
   */
  private isPotentialSandwichAttack(tx: ethers.TransactionResponse): boolean {
    // Check if this transaction is targeting a recent large swap
    for (const [hash, cachedTx] of this.pendingTxCache) {
      if (this.sandwichSuspects.has(cachedTx.from) &&
          tx.to === cachedTx.to &&
          tx.value && cachedTx.value &&
          tx.value - cachedTx.value < cachedTx.value / 100n) {
        // Same target, similar value - potential sandwich
        return true;
      }
    }
    return false;
  }

  /**
   * Mark an address as a sandwich suspect
   * @param address Address to mark
   */
  private markAsSuspect(address: string): void {
    this.sandwichSuspects.add(address);
    // Auto-remove after 1 hour
    setTimeout(() => {
      this.sandwichSuspects.delete(address);
    }, 3600000);
  }

  /**
   * Record an address as an arbitrage bot
   * @param address Bot address
   */
  private recordArbitrageBot(address: string): void {
    this.knownArbitrageBots.add(address);
  }

  /**
   * Check if an address is a known arbitrage bot
   * @param address Address to check
   * @returns True if known bot
   */
  public isKnownBot(address: string): boolean {
    return this.knownArbitrageBots.has(address);
  }

  /**
   * Check if an address is a sandwich suspect
   * @param address Address to check
   * @returns True if suspect
   */
  public isSandwichSuspect(address: string): boolean {
    return this.sandwichSuspects.has(address);
  }

  /**
   * Get competing arbitrage transactions in mempool
   * @param targetContract Target contract address
   * @returns Array of competing transactions
   */
  public getCompetingTransactions(targetContract: string): ethers.TransactionResponse[] {
    const competing: ethers.TransactionResponse[] = [];

    for (const tx of this.pendingTxCache.values()) {
      if (tx.to === targetContract && 
          this.isArbitrageTransaction(tx) &&
          !this.knownArbitrageBots.has(tx.from)) {
        competing.push(tx);
      }
    }

    return competing;
  }

  /**
   * Analyze gas prices of competing transactions
   * @param targetContract Target contract address
   * @returns Gas price statistics
   */
  public analyzeCompetingGasPrices(targetContract: string): {
    min: bigint;
    max: bigint;
    avg: bigint;
  } {
    const competing = this.getCompetingTransactions(targetContract);
    
    if (competing.length === 0) {
      return { min: 0n, max: 0n, avg: 0n };
    }

    const gasPrices = competing.map(tx => tx.gasPrice || 0n).filter(gp => gp > 0n);

    if (gasPrices.length === 0) {
      return { min: 0n, max: 0n, avg: 0n };
    }

    const min = gasPrices.reduce((a, b) => a < b ? a : b);
    const max = gasPrices.reduce((a, b) => a > b ? a : b);
    const sum = gasPrices.reduce((a, b) => a + b, 0n);
    const avg = sum / BigInt(gasPrices.length);

    return { min, max, avg };
  }

  /**
   * Recommend gas price to beat competition
   * @param targetContract Target contract address
   * @param aggressiveness Aggressiveness level (1-3)
   * @returns Recommended gas price
   */
  public recommendGasPrice(
    targetContract: string,
    aggressiveness: number = 2
  ): bigint {
    const { avg, max } = this.analyzeCompetingGasPrices(targetContract);

    if (avg === 0n) {
      // No competition, use standard gas
      return 20000000000n; // 20 gwei
    }

    // Calculate recommended gas based on aggressiveness
    const multiplier = BigInt(aggressiveness * 10); // 10%, 20%, or 30% above
    
    // Use the higher of average or max, then add margin
    const basePrice = max > avg ? max : avg;
    const recommendedPrice = (basePrice * (100n + multiplier)) / 100n;

    return recommendedPrice;
  }

  /**
   * Simulate a transaction before submission
   * @param tx Transaction to simulate
   * @returns Simulation result
   */
  async simulateTransaction(tx: ethers.TransactionRequest): Promise<{
    success: boolean;
    gasUsed: bigint;
    revertReason?: string;
  }> {
    try {
      const gasEstimate = await this.wsProvider.estimateGas(tx);
      return {
        success: true,
        gasUsed: gasEstimate,
      };
    } catch (error: any) {
      return {
        success: false,
        gasUsed: 0n,
        revertReason: error.message || "Unknown error",
      };
    }
  }

  /**
   * Check for front-running risk
   * @param tx Transaction to check
   * @returns Front-running risk level (0-3)
   */
  public getFrontRunningRisk(tx: ethers.TransactionResponse): number {
    let risk = 0;

    // Check if similar transactions are pending
    for (const cachedTx of this.pendingTxCache.values()) {
      if (cachedTx.to === tx.to &&
          cachedTx.data?.slice(0, 10) === tx.data?.slice(0, 10)) {
        risk += 1;
      }
    }

    // Check if target is a known sandwich victim
    if (this.sandwichSuspects.has(tx.from)) {
      risk += 1;
    }

    return Math.min(risk, 3);
  }

  /**
   * Get MEV protection recommendations
   * @param tx Transaction to analyze
   * @returns Protection recommendations
   */
  public getProtectionRecommendations(tx: ethers.TransactionResponse): {
    usePrivatePool: boolean;
    increaseSlippage: boolean;
    recommendedSlippage: number;
    useFlashbots: boolean;
  } {
    const frontRunningRisk = this.getFrontRunningRisk(tx);
    const hasCompetition = this.getCompetingTransactions(tx.to || "").length > 0;

    return {
      usePrivatePool: frontRunningRisk >= 2 || hasCompetition,
      increaseSlippage: frontRunningRisk >= 1,
      recommendedSlippage: frontRunningRisk * 10, // 0%, 10%, 20%, 30%
      useFlashbots: frontRunningRisk >= 2,
    };
  }

  /**
   * Close the WebSocket connection
   */
  public async close(): Promise<void> {
    this.pendingTxCache.clear();
    this.wsProvider.removeAllListeners();
    // WebSocket provider doesn't have a close method in ethers v6
    // The connection will be cleaned up when the object is garbage collected
  }
}