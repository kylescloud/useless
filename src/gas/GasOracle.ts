import { ethers } from "ethers";
import axios from "axios";

/**
 * GasOracle - Provides dynamic gas price predictions and optimization
 * Tracks EIP-1559 base fees and calculates optimal gas strategies
 */
export class GasOracle {
  private provider: ethers.JsonRpcProvider;
  private baseFeeHistory: bigint[] = [];
  private maxHistoryLength = 20;
  private gasPriceCache: Map<string, { price: bigint; timestamp: number }> = new Map();
  private cacheTTL = 5000; // 5 seconds

  constructor(rpcUrl: string) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
  }

  /**
   * Get current gas prices with EIP-1559 parameters
   * @returns Gas price data
   */
  async getCurrentGasPrices(): Promise<{
    baseFee: bigint;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
    legacyGasPrice: bigint;
  }> {
    const latestBlock = await this.provider.getBlock("latest");
    if (!latestBlock) {
      throw new Error("Failed to fetch latest block");
    }

    const baseFee = latestBlock.baseFeePerGas || 0n;
    const maxPriorityFeePerGas = this.calculateOptimalPriorityFee(baseFee);
    const maxFeePerGas = baseFee + maxPriorityFeePerGas;
    const legacyGasPrice = maxFeePerGas;

    return {
      baseFee,
      maxFeePerGas,
      maxPriorityFeePerGas,
      legacyGasPrice,
    };
  }

  /**
   * Calculate optimal priority fee based on network conditions
   * @param baseFee Current base fee
   * @returns Optimal priority fee
   */
  private calculateOptimalPriorityFee(baseFee: bigint): bigint {
    // Check recent base fee trends
    if (this.baseFeeHistory.length >= 2) {
      const recentTrend = this.baseFeeHistory[this.baseFeeHistory.length - 1] - 
                         this.baseFeeHistory[this.baseFeeHistory.length - 2];
      
      // If base fee is increasing rapidly, use higher priority fee
      if (recentTrend > baseFee / 10n) {
        return 5000000000n; // 5 gwei for congested network
      }
    }

    // Standard priority fee
    return 2000000000n; // 2 gwei
  }

  /**
   * Predict next block's base fee
   * @returns Predicted base fee
   */
  async predictNextBaseFee(): Promise<bigint> {
    const latestBlock = await this.provider.getBlock("latest");
    if (!latestBlock || !latestBlock.baseFeePerGas) {
      return 20000000000n; // Default 20 gwei
    }

    const currentBaseFee = latestBlock.baseFeePerGas;
    const gasUsed = latestBlock.gasUsed;
    const gasLimit = latestBlock.gasLimit;

    // Calculate gas target (50% of gas limit)
    const gasTarget = gasLimit / 2n;
    
    // Predict next base fee based on EIP-1559 formula
    let baseFeeDelta = 0n;
    if (gasUsed > gasTarget) {
      const excessRatio = ((gasUsed - gasTarget) * 1000000n) / gasTarget;
      baseFeeDelta = (currentBaseFee * excessRatio) / 8n;
    } else if (gasUsed < gasTarget) {
      const deficitRatio = ((gasTarget - gasUsed) * 1000000n) / gasTarget;
      baseFeeDelta = (currentBaseFee * deficitRatio) / 8n;
    }

    const predictedBaseFee = currentBaseFee + baseFeeDelta;
    
    // Update history
    this.baseFeeHistory.push(currentBaseFee);
    if (this.baseFeeHistory.length > this.maxHistoryLength) {
      this.baseFeeHistory.shift();
    }

    return predictedBaseFee;
  }

  /**
   * Estimate gas cost for a transaction
   * @param transaction Transaction object
   * @param gasMultiplier Multiplier for safety margin
   * @returns Estimated gas cost in wei
   */
  async estimateGasCost(
    transaction: ethers.TransactionRequest,
    gasMultiplier: number = 1.2
  ): Promise<bigint> {
    try {
      const gasEstimate = await this.provider.estimateGas(transaction);
      const gasPrices = await this.getCurrentGasPrices();
      
      // Use maxFeePerGas for EIP-1559 transactions
      const gasPrice = gasPrices.maxFeePerGas;
      
      // Apply safety margin
      const adjustedGasLimit = (gasEstimate * BigInt(Math.floor(gasMultiplier * 100))) / 100n;
      
      return adjustedGasLimit * gasPrice;
    } catch (error) {
      console.error("Failed to estimate gas cost:", error);
      // Return conservative estimate
      return 500000n * 50000000000n; // 500k gas * 50 gwei
    }
  }

  /**
   * Get optimal gas parameters for flash loan arbitrage
   * @param urgency Urgency level (1-5, where 5 is highest)
   * @returns Optimized gas parameters
   */
  async getOptimalGasParams(urgency: number = 3): Promise<{
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
    gasLimit: bigint;
  }> {
    const currentGasPrices = await this.getCurrentGasPrices();
    const predictedBaseFee = await this.predictNextBaseFee();

    // Increase priority fee based on urgency
    const urgencyMultiplier = urgency / 3; // 0.33 to 1.67
    const priorityFee = (currentGasPrices.maxPriorityFeePerGas * 
                        BigInt(Math.floor(urgencyMultiplier * 100))) / 100n;

    // Use predicted base fee + priority fee for max fee
    const maxFeePerGas = predictedBaseFee + priorityFee;

    return {
      maxFeePerGas,
      maxPriorityFeePerGas: priorityFee,
      gasLimit: 500000n, // Standard limit for arbitrage
    };
  }

  /**
   * Monitor gas prices and detect spikes
   * @param callback Callback function when gas spikes are detected
   * @param interval Polling interval in ms
   */
  async monitorGasSpikes(
    callback: (gasPrice: bigint) => void,
    interval: number = 5000
  ): Promise<() => void> {
    const threshold = 100000000000n; // 100 gwei threshold

    const intervalId = setInterval(async () => {
      const gasPrices = await this.getCurrentGasPrices();
      
      if (gasPrices.maxFeePerGas > threshold) {
        callback(gasPrices.maxFeePerGas);
      }
    }, interval);

    // Return cleanup function
    return () => clearInterval(intervalId);
  }

  /**
   * Get gas price from external API (Etherscan or similar)
   * @param apiType API type to use
   * @returns Gas price
   */
  async getGasPriceFromAPI(apiType: "etherscan" | "ethgasstation" = "etherscan"): Promise<bigint> {
    try {
      if (apiType === "etherscan") {
        // For Base, we might use BaseScan or a similar service
        const response = await axios.get("https://api.etherscan.io/api", {
          params: {
            module: "gastracker",
            action: "gasoracle",
            apikey: process.env.ETHERSCAN_API_KEY || "",
          },
        });

        if (response.data.status === "1") {
          const gasPrice = parseFloat(response.data.result.FastGasPrice);
          return ethers.parseUnits(gasPrice.toFixed(2), "gwei");
        }
      }

      // Fallback to provider
      const feeData = await this.provider.getFeeData();
      return feeData.maxFeePerGas || feeData.gasPrice || 0n;
    } catch (error) {
      console.error("Failed to fetch gas price from API:", error);
      const feeData = await this.provider.getFeeData();
      return feeData.maxFeePerGas || feeData.gasPrice || 0n;
    }
  }

  /**
   * Check if gas conditions are favorable for arbitrage
   * @param maxAcceptableGasPrice Maximum acceptable gas price in wei
   * @returns True if conditions are favorable
   */
  async areConditionsFavorable(maxAcceptableGasPrice: bigint): Promise<boolean> {
    const gasPrices = await this.getCurrentGasPrices();
    return gasPrices.maxFeePerGas <= maxAcceptableGasPrice;
  }

  /**
   * Calculate optimal transaction timing based on gas trends
   * @returns Recommended delay in milliseconds
   */
  async getOptimalTiming(): Promise<number> {
    const predictedBaseFee = await this.predictNextBaseFee();
    const currentBaseFee = (await this.getCurrentGasPrices()).baseFee;

    // If predicted fee is lower, wait
    if (predictedBaseFee < currentBaseFee) {
      return 12000; // Wait ~12 seconds (2 blocks)
    }

    return 0; // Execute immediately
  }
}