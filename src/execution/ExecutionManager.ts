import { ethers } from "ethers";
import { FLASH_ARB_ABI } from "../config/abis";
import { TOKENS, AAVE } from "../config/addresses";
import { ArbOpportunity, StrategyManager } from "../strategies/StrategyManager";
import { logger, TradeLogger } from "../utils/Logger";

// ═══════════════════════════════════════════════════════════════════
//                    EXECUTION MANAGER
//  Handles transaction submission, gas optimization, MEV protection
// ═══════════════════════════════════════════════════════════════════

export interface ExecutionResult {
    success: boolean;
    txHash?: string;
    gasUsed?: bigint;
    gasCost?: bigint;
    profit?: bigint;
    error?: string;
    duration: number;
}

export class ExecutionManager {
    private wallet: ethers.Wallet;
    private contract: ethers.Contract;
    private strategyManager: StrategyManager;
    private provider: ethers.Provider;
    private maxGasPriceGwei: number;
    private nonce: number = -1;
    private pendingTxs: Set<string> = new Set();

    // Execution stats
    private totalExecutions: number = 0;
    private successfulExecutions: number = 0;
    private totalProfit: bigint = 0n;
    private totalGasCost: bigint = 0n;

    constructor(
        provider: ethers.Provider,
        executorPrivateKey: string,
        contractAddress: string,
        strategyManager: StrategyManager,
        maxGasPriceGwei: number
    ) {
        this.provider = provider;
        this.wallet = new ethers.Wallet(executorPrivateKey, provider);
        this.contract = new ethers.Contract(contractAddress, FLASH_ARB_ABI, this.wallet);
        this.strategyManager = strategyManager;
        this.maxGasPriceGwei = maxGasPriceGwei;
    }

    // ═══════════════════════════════════════════════════════════════
    //                    EXECUTE OPPORTUNITY
    // ═══════════════════════════════════════════════════════════════

    async execute(opportunity: ArbOpportunity): Promise<ExecutionResult> {
        const startTime = Date.now();

        try {
            // 1. Pre-flight checks
            const preflight = await this.preflightChecks(opportunity);
            if (!preflight.pass) {
                return { success: false, error: preflight.reason, duration: Date.now() - startTime };
            }

            // 2. Encode strategy for on-chain execution
            const encodedParams = this.strategyManager.encodeStrategy(opportunity);

            // 3. Estimate gas
            const gasEstimate = await this.estimateGas(opportunity, encodedParams);
            if (!gasEstimate) {
                return { success: false, error: "Gas estimation failed (likely unprofitable)", duration: Date.now() - startTime };
            }

            // 4. Build transaction with optimal gas settings
            const txParams = await this.buildTransaction(opportunity, encodedParams, gasEstimate);

            // 5. Simulate transaction
            const simResult = await this.simulateTransaction(opportunity, encodedParams);
            if (!simResult.success) {
                TradeLogger.logFailure({
                    pair: `${opportunity.borrowAsset}`,
                    reason: "Simulation failed",
                    error: simResult.error,
                });
                return { success: false, error: `Simulation failed: ${simResult.error}`, duration: Date.now() - startTime };
            }

            // 6. Submit transaction
            logger.info(`🚀 Submitting TX: ${opportunity.strategyType} | Expected profit: $${opportunity.netProfitUsd.toFixed(4)}`);

            const tx = await this.wallet.sendTransaction(txParams);
            this.pendingTxs.add(tx.hash);

            logger.info(`📤 TX submitted: ${tx.hash}`);

            // 7. Wait for confirmation
            const receipt = await tx.wait(1);

            this.pendingTxs.delete(tx.hash);

            if (!receipt || receipt.status === 0) {
                this.totalExecutions++;
                TradeLogger.logFailure({
                    pair: `${opportunity.borrowAsset}`,
                    reason: "TX reverted on-chain",
                    error: tx.hash,
                });
                return { success: false, txHash: tx.hash, error: "Transaction reverted", duration: Date.now() - startTime };
            }

            // 8. Calculate actual results
            const gasUsed = receipt.gasUsed;
            const gasCost = receipt.gasUsed * receipt.gasPrice;

            this.totalExecutions++;
            this.successfulExecutions++;
            this.totalGasCost += gasCost;

            const duration = Date.now() - startTime;

            TradeLogger.logExecution({
                txHash: tx.hash,
                pair: `${opportunity.borrowAsset} (${opportunity.strategyType})`,
                profit: `$${opportunity.profitUsd.toFixed(4)}`,
                gasUsed: gasUsed.toString(),
                gasCost: ethers.formatEther(gasCost),
                netProfit: `$${opportunity.netProfitUsd.toFixed(4)}`,
                duration,
            });

            return {
                success: true,
                txHash: tx.hash,
                gasUsed,
                gasCost,
                profit: opportunity.expectedProfit,
                duration,
            };
        } catch (error: any) {
            this.totalExecutions++;
            const duration = Date.now() - startTime;

            TradeLogger.logFailure({
                pair: `${opportunity.borrowAsset}`,
                reason: "Execution error",
                error: error.message?.substring(0, 200),
            });

            return { success: false, error: error.message, duration };
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //                    PRE-FLIGHT CHECKS
    // ═══════════════════════════════════════════════════════════════

    private async preflightChecks(opportunity: ArbOpportunity): Promise<{ pass: boolean; reason?: string }> {
        // Check if contract is paused
        try {
            const paused = await this.contract.paused();
            if (paused) return { pass: false, reason: "Contract is paused" };
        } catch {
            return { pass: false, reason: "Cannot read contract state" };
        }

        // Check gas price
        const feeData = await this.provider.getFeeData();
        if (feeData.gasPrice && feeData.gasPrice > ethers.parseUnits(this.maxGasPriceGwei.toString(), "gwei")) {
            return { pass: false, reason: `Gas price too high: ${ethers.formatUnits(feeData.gasPrice, "gwei")} gwei` };
        }

        // Check opportunity freshness (max 5 seconds old)
        if (Date.now() - opportunity.timestamp > 5000) {
            return { pass: false, reason: "Opportunity too stale" };
        }

        // Check for pending transactions
        if (this.pendingTxs.size > 0) {
            return { pass: false, reason: "Pending transaction exists" };
        }

        // Check executor balance for gas
        const balance = await this.provider.getBalance(this.wallet.address);
        const minBalance = ethers.parseEther("0.01"); // 0.01 ETH minimum
        if (balance < minBalance) {
            return { pass: false, reason: "Insufficient ETH for gas" };
        }

        return { pass: true };
    }

    // ═══════════════════════════════════════════════════════════════
    //                    GAS ESTIMATION
    // ═══════════════════════════════════════════════════════════════

    private async estimateGas(opportunity: ArbOpportunity, encodedParams: string): Promise<bigint | null> {
        try {
            const token = TOKENS[opportunity.borrowAsset];
            if (!token) return null;

            const gasEstimate = await this.contract.executeArbitrage.estimateGas(
                token.address,
                opportunity.borrowAmount,
                encodedParams
            );

            // Add 20% buffer
            return (gasEstimate * 120n) / 100n;
        } catch (error: any) {
            logger.debug(`Gas estimation failed: ${error.message?.substring(0, 100)}`);
            return null;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //                    TRANSACTION BUILDING
    // ═══════════════════════════════════════════════════════════════

    private async buildTransaction(
        opportunity: ArbOpportunity,
        encodedParams: string,
        gasLimit: bigint
    ): Promise<ethers.TransactionRequest> {
        const token = TOKENS[opportunity.borrowAsset];
        const feeData = await this.provider.getFeeData();

        // Get nonce (manage locally for speed)
        if (this.nonce === -1) {
            this.nonce = await this.provider.getTransactionCount(this.wallet.address, "pending");
        }

        const txData = this.contract.interface.encodeFunctionData("executeArbitrage", [
            token!.address,
            opportunity.borrowAmount,
            encodedParams,
        ]);

        // Base chain uses EIP-1559
        const maxFeePerGas = feeData.maxFeePerGas || ethers.parseUnits("0.5", "gwei");
        const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || ethers.parseUnits("0.001", "gwei");

        const tx: ethers.TransactionRequest = {
            to: await this.contract.getAddress(),
            data: txData,
            gasLimit,
            maxFeePerGas,
            maxPriorityFeePerGas,
            nonce: this.nonce,
            chainId: 8453,
            type: 2,
        };

        this.nonce++;
        return tx;
    }

    // ═══════════════════════════════════════════════════════════════
    //                    SIMULATION
    // ═══════════════════════════════════════════════════════════════

    private async simulateTransaction(
        opportunity: ArbOpportunity,
        encodedParams: string
    ): Promise<{ success: boolean; error?: string }> {
        try {
            const token = TOKENS[opportunity.borrowAsset];
            if (!token) return { success: false, error: "Unknown token" };

            await this.contract.executeArbitrage.staticCall(
                token.address,
                opportunity.borrowAmount,
                encodedParams
            );

            return { success: true };
        } catch (error: any) {
            const reason = error.reason || error.message?.substring(0, 200) || "Unknown error";
            return { success: false, error: reason };
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //                    NONCE MANAGEMENT
    // ═══════════════════════════════════════════════════════════════

    async resetNonce(): Promise<void> {
        this.nonce = await this.provider.getTransactionCount(this.wallet.address, "pending");
        logger.info(`Nonce reset to ${this.nonce}`);
    }

    // ═══════════════════════════════════════════════════════════════
    //                    STATS
    // ═══════════════════════════════════════════════════════════════

    getStats() {
        return {
            totalExecutions: this.totalExecutions,
            successfulExecutions: this.successfulExecutions,
            successRate: this.totalExecutions > 0 ? (this.successfulExecutions / this.totalExecutions) * 100 : 0,
            totalGasCost: this.totalGasCost,
            pendingTxs: this.pendingTxs.size,
            walletAddress: this.wallet.address,
        };
    }
}