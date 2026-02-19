import { ethers } from "ethers";

/**
 * RiskManager - Advanced risk management for arbitrage operations
 * Handles dynamic slippage, position sizing, and circuit breakers
 */
export class RiskManager {
  private provider: ethers.JsonRpcProvider;
  private maxDrawdown: bigint;
  private currentDrawdown: bigint = 0n;
  private circuitBreakerEnabled: boolean;
  private circuitBreakerTriggered: boolean = false;
  private tradeHistory: Array<{
    timestamp: number;
    profit: bigint;
    gasCost: bigint;
  }> = [];
  private hourlyTradeCount: number = 0;
  private lastHourReset: number = Date.now();
  
  // Risk parameters
  private maxTradesPerHour: number;
  private minLiquidityUSD: bigint;
  private maxPositionSizeUSD: bigint;
  private volatilityThreshold: number;

  constructor(
    rpcUrl: string,
    config: {
      maxDrawdown?: string; // in ETH
      maxTradesPerHour?: number;
      minLiquidityUSD?: string;
      maxPositionSizeUSD?: string;
      volatilityThreshold?: number; // 0-100
      circuitBreakerEnabled?: boolean;
    } = {}
  ) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.maxDrawdown = ethers.parseEther(config.maxDrawdown || "5");
    this.maxTradesPerHour = config.maxTradesPerHour || 100;
    this.minLiquidityUSD = ethers.parseEther(config.minLiquidityUSD || "100000");
    this.maxPositionSizeUSD = ethers.parseEther(config.maxPositionSizeUSD || "50000");
    this.volatilityThreshold = config.volatilityThreshold || 50;
    this.circuitBreakerEnabled = config.circuitBreakerEnabled ?? true;

    // Start hourly trade count reset timer
    setInterval(() => this.resetHourlyCount(), 3600000); // Every hour
  }

  /**
   * Calculate dynamic slippage based on market volatility
   * @param tokenIn Input token
   * @param tokenOut Output token
   * @param amountIn Input amount
   * @returns Recommended slippage in basis points (0-10000)
   */
  async calculateDynamicSlippage(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint
  ): Promise<number> {
    const baseSlippage = 30; // 0.3% base slippage (30 bps)
    
    // Get price volatility (simplified - in production use proper price feeds)
    const volatility = await this.calculateVolatility(tokenIn, tokenOut);
    
    // Increase slippage with higher volatility
    const volatilityAdjustment = Math.floor((volatility / this.volatilityThreshold) * 50);
    
    // Increase slippage for larger trades (impact cost)
    const sizeAdjustment = Math.floor(Number(amountIn) / 1e18 * 10);
    
    // Total slippage
    let totalSlippage = baseSlippage + volatilityAdjustment + sizeAdjustment;
    
    // Cap at 500 bps (5%)
    totalSlippage = Math.min(totalSlippage, 500);
    
    return totalSlippage;
  }

  /**
   * Calculate price volatility between two tokens
   * @param tokenIn Input token
   * @param tokenOut Output token
   * @returns Volatility score (0-100)
   */
  private async calculateVolatility(tokenIn: string, tokenOut: string): Promise<number> {
    // Simplified volatility calculation
    // In production, use proper price feed data (Chainlink, etc.)
    try {
      // Check recent block times for network congestion
      const latestBlock = await this.provider.getBlock("latest");
      const previousBlock = await this.provider.getBlock(latestBlock!.number - 100);
      
      if (!latestBlock || !previousBlock) {
        return 10; // Default moderate volatility
      }

      // Calculate block time variance
      const avgBlockTime = 2000; // 2 seconds for Base
      const actualAvgBlockTime = (latestBlock.timestamp - previousBlock.timestamp) / 100;
      
      // Higher variance = higher volatility
      const variance = Math.abs(actualAvgBlockTime - avgBlockTime);
      const volatilityScore = Math.min(Math.floor(variance / 100), 100);
      
      return volatilityScore;
    } catch {
      return 10; // Default
    }
  }

  /**
   * Calculate optimal position size based on liquidity and risk
   * @param liquidityUSD Pool liquidity in USD
   * @param profitUSD Expected profit in USD
   * @returns Optimal position size in USD
   */
  calculateOptimalPositionSize(liquidityUSD: bigint, profitUSD: bigint): bigint {
    // Ensure minimum liquidity
    if (liquidityUSD < this.minLiquidityUSD) {
      return 0n;
    }

    // Max position size is capped at 1% of pool liquidity or configured max
    const liquidityBasedMax = liquidityUSD / 100n;
    const configuredMax = this.maxPositionSizeUSD;
    const absoluteMax = liquidityBasedMax < configuredMax ? liquidityBasedMax : configuredMax;

    // Scale down if profit is too low relative to position size
    const profitRatio = profitUSD * 100n / absoluteMax;
    if (profitRatio < 50n) { // Less than 0.5% profit
      return absoluteMax / 2n;
    }

    return absoluteMax;
  }

  /**
   * Validate if trade should be executed
   * @param params Trade parameters
   * @returns Validation result
   */
  async validateTrade(params: {
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint;
    liquidityUSD: bigint;
    expectedProfit: bigint;
    gasCost: bigint;
  }): Promise<{
    valid: boolean;
    reason?: string;
    recommendedSlippage?: number;
    recommendedPositionSize?: bigint;
  }> {
    // Check circuit breaker
    if (this.circuitBreakerTriggered) {
      return { valid: false, reason: "Circuit breaker triggered" };
    }

    // Check hourly trade limit
    if (this.hourlyTradeCount >= this.maxTradesPerHour) {
      return { valid: false, reason: "Hourly trade limit reached" };
    }

    // Check minimum liquidity
    if (params.liquidityUSD < this.minLiquidityUSD) {
      return { valid: false, reason: "Insufficient liquidity" };
    }

    // Calculate dynamic slippage
    const recommendedSlippage = await this.calculateDynamicSlippage(
      params.tokenIn,
      params.tokenOut,
      params.amountIn
    );

    // Calculate optimal position size
    const recommendedPositionSize = this.calculateOptimalPositionSize(
      params.liquidityUSD,
      params.expectedProfit
    );

    // Check profit threshold (should be at least 2x gas cost)
    const profitThreshold = params.gasCost * 2n;
    if (params.expectedProfit < profitThreshold) {
      return {
        valid: false,
        reason: `Insufficient profit: ${params.expectedProfit} < ${profitThreshold}`,
      };
    }

    // Check drawdown
    if (this.currentDrawdown >= this.maxDrawdown) {
      return { valid: false, reason: "Maximum drawdown reached" };
    }

    return {
      valid: true,
      recommendedSlippage,
      recommendedPositionSize,
    };
  }

  /**
   * Record trade result for risk monitoring
   * @param profit Trade profit
   * @param gasCost Gas cost
   */
  recordTradeResult(profit: bigint, gasCost: bigint): void {
    const netProfit = profit - gasCost;
    
    this.tradeHistory.push({
      timestamp: Date.now(),
      profit: netProfit,
      gasCost,
    });

    this.hourlyTradeCount++;

    // Update drawdown
    if (netProfit < 0n) {
      this.currentDrawdown += -netProfit;
    } else {
      // Reduce drawdown on profitable trade
      this.currentDrawdown = this.currentDrawdown > netProfit 
        ? this.currentDrawdown - netProfit 
        : 0n;
    }

    // Keep only last 1000 trades
    if (this.tradeHistory.length > 1000) {
      this.tradeHistory.shift();
    }

    // Check circuit breaker conditions
    this.checkCircuitBreaker();
  }

  /**
   * Check if circuit breaker should be triggered
   */
  private checkCircuitBreaker(): void {
    if (!this.circuitBreakerEnabled) return;

    // Check consecutive losses
    const recentTrades = this.tradeHistory.slice(-20);
    const consecutiveLosses = this.countConsecutiveLosses(recentTrades);

    if (consecutiveLosses >= 10) {
      this.triggerCircuitBreaker("10 consecutive losses");
    }

    // Check if drawdown exceeded
    if (this.currentDrawdown >= this.maxDrawdown) {
      this.triggerCircuitBreaker("Maximum drawdown exceeded");
    }

    // Check for unusual failure rate
    if (recentTrades.length >= 20) {
      const losingTrades = recentTrades.filter(t => t.profit < 0n).length;
      const failureRate = losingTrades / recentTrades.length;
      
      if (failureRate > 0.7) { // 70% failure rate
        this.triggerCircuitBreaker("High failure rate detected");
      }
    }
  }

  /**
   * Count consecutive losses in trade history
   * @param trades Trade array
   * @returns Number of consecutive losses
   */
  private countConsecutiveLosses(trades: Array<{ profit: bigint }>): number {
    let count = 0;
    for (let i = trades.length - 1; i >= 0; i--) {
      if (trades[i].profit < 0n) {
        count++;
      } else {
        break;
      }
    }
    return count;
  }

  /**
   * Trigger circuit breaker
   * @param reason Trigger reason
   */
  private triggerCircuitBreaker(reason: string): void {
    this.circuitBreakerTriggered = true;
    console.error(`🚨 CIRCUIT BREAKER TRIGGERED: ${reason}`);
    // In production, send alert
  }

  /**
   * Reset circuit breaker (owner only)
   */
  public resetCircuitBreaker(): void {
    this.circuitBreakerTriggered = false;
    console.log("✅ Circuit breaker reset");
  }

  /**
   * Get current risk metrics
   * @returns Risk metrics
   */
  getRiskMetrics(): {
    currentDrawdown: bigint;
    maxDrawdown: bigint;
    hourlyTradeCount: number;
    maxTradesPerHour: number;
    circuitBreakerTriggered: boolean;
    totalTrades: number;
    totalProfit: bigint;
    winRate: number;
  } {
    const totalTrades = this.tradeHistory.length;
    const totalProfit = this.tradeHistory.reduce((sum, t) => sum + t.profit, 0n);
    const winningTrades = this.tradeHistory.filter(t => t.profit > 0n).length;
    const winRate = totalTrades > 0 ? winningTrades / totalTrades : 0;

    return {
      currentDrawdown: this.currentDrawdown,
      maxDrawdown: this.maxDrawdown,
      hourlyTradeCount: this.hourlyTradeCount,
      maxTradesPerHour: this.maxTradesPerHour,
      circuitBreakerTriggered: this.circuitBreakerTriggered,
      totalTrades,
      totalProfit,
      winRate,
    };
  }

  /**
   * Reset hourly trade count
   */
  private resetHourlyCount(): void {
    this.hourlyTradeCount = 0;
    this.lastHourReset = Date.now();
  }

  /**
   * Update risk parameters
   * @param params New parameters
   */
  updateRiskParameters(params: {
    maxDrawdown?: string;
    maxTradesPerHour?: number;
    minLiquidityUSD?: string;
    maxPositionSizeUSD?: string;
    volatilityThreshold?: number;
    circuitBreakerEnabled?: boolean;
  }): void {
    if (params.maxDrawdown) {
      this.maxDrawdown = ethers.parseEther(params.maxDrawdown);
    }
    if (params.maxTradesPerHour !== undefined) {
      this.maxTradesPerHour = params.maxTradesPerHour;
    }
    if (params.minLiquidityUSD) {
      this.minLiquidityUSD = ethers.parseEther(params.minLiquidityUSD);
    }
    if (params.maxPositionSizeUSD) {
      this.maxPositionSizeUSD = ethers.parseEther(params.maxPositionSizeUSD);
    }
    if (params.volatilityThreshold !== undefined) {
      this.volatilityThreshold = params.volatilityThreshold;
    }
    if (params.circuitBreakerEnabled !== undefined) {
      this.circuitBreakerEnabled = params.circuitBreakerEnabled;
    }
  }
}