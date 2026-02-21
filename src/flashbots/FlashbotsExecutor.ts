
import { ethers } from "ethers";
import axios from "axios";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * FlashbotsExecutor - Handles private mempool submission via Flashbots
 * Provides MEV protection and faster transaction inclusion
 * Custom implementation for ethers v6 compatibility
 */
export class FlashbotsExecutor {
  private provider: ethers.JsonRpcProvider;
  private signer: ethers.Wallet;
  private chainId: number;
  private flashbotsRelayUrl: string;
  private flashbotsRpcUrl: string;

  constructor(rpcUrl: string, privateKey: string, chainId: number = 8453) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.signer = new ethers.Wallet(privateKey, this.provider);
    this.chainId = chainId;
    
    // Flashbots relay endpoints
    this.flashbotsRelayUrl = "https://relay.flashbots.net";
    this.flashbotsRpcUrl = "https://rpc.flashbots.net";
  }

  /**
   * Submit a transaction bundle to Flashbots relay
   * @param signedTransactions Array of signed transactions
   * @param targetBlock Block number to target (optional)
   * @returns Bundle submission result
   */
  async submitBundle(
    signedTransactions: string[],
    targetBlock?: number
  ): Promise<{ success: boolean; txHash?: string; blockNumber?: number }> {
    const blockNumber = targetBlock || (await this.provider.getBlockNumber());

    try {
      // Build Flashbots bundle
      const bundle = signedTransactions.map(tx => ({
        tx: `0x${tx.replace(/^0x/, "")}`,
        canRevert: false,
      }));

      // Simulate bundle first
      const simulationResult = await this.simulateBundle(bundle, blockNumber);
      
      if (!simulationResult.success) {
        console.error("Bundle simulation failed:", simulationResult.error);
        return { success: false };
      }

      console.log("Bundle simulation successful. Gas used:", simulationResult.gasUsed.toString());

      // Submit bundle to Flashbots relay
      const submitResult = await this.sendBundleToRelay(bundle, blockNumber + 1);
      
      if (submitResult.success) {
        console.log("✅ Bundle submitted to Flashbots relay");
        return {
          success: true,
          txHash: submitResult.txHash,
          blockNumber: blockNumber + 1,
        };
      } else {
        console.error("Bundle submission failed:", submitResult.error);
        return { success: false };
      }
    } catch (error: any) {
      console.error("Flashbots submission error:", error.message);
      return { success: false };
    }
  }

  /**
   * Simulate a bundle before submission
   * @param bundle Bundle to simulate
   * @param blockNumber Block number for simulation
   * @returns Simulation result
   */
  private async simulateBundle(
    bundle: Array<{ tx: string; canRevert: boolean }>,
    blockNumber: number
  ): Promise<{ success: boolean; gasUsed: bigint; error?: string }> {
    try {
      // Simulate using provider's call method
      let totalGasUsed = 0n;

      for (const bundleItem of bundle) {
        try {
          // Parse transaction data
          const txData = ethers.Transaction.from(bundleItem.tx);
          
          // Simulate transaction (ethers v6 call only takes 1 argument)
          await this.provider.call({
            data: txData.data,
            to: txData.to,
            from: await this.signer.getAddress(),
            value: txData.value,
          });
          
          totalGasUsed += 100000n; // Estimate gas per tx
        } catch (error: any) {
          if (!bundleItem.canRevert) {
            return {
              success: false,
              gasUsed: 0n,
              error: error.message,
            };
          }
        }
      }

      return { success: true, gasUsed: totalGasUsed };
    } catch (error: any) {
      return {
        success: false,
        gasUsed: 0n,
        error: error.message,
      };
    }
  }

  /**
   * Send bundle to Flashbots relay
   * @param bundle Bundle to send
   * @param blockNumber Target block number
   * @returns Submission result
   */
  private async sendBundleToRelay(
    bundle: Array<{ tx: string; canRevert: boolean }>,
    blockNumber: number
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      // Flashbots eth_sendBundle RPC call
      const response = await axios.post(
        this.flashbotsRelayUrl,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "eth_sendBundle",
          params: [
            {
              txs: bundle.map(b => b.tx),
              blockNumber: `0x${blockNumber.toString(16)}`,
            },
          ],
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000,
        }
      );

      if (response.data.result) {
        return {
          success: true,
          txHash: response.data.result,
        };
      } else {
        return {
          success: false,
          error: response.data.error?.message || "Unknown error",
        };
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Create and sign a signed transaction for Flashbots
   * @param to Recipient address
   * @param data Transaction data
   * @param value ETH value to send
   * @param gasLimit Gas limit
   * @param maxPriorityFeePerGas Max priority fee per gas
   * @returns Signed transaction string
   */
  async signTransaction(
    to: string,
    data: string,
    value: bigint = 0n,
    gasLimit: bigint = 500000n,
    maxPriorityFeePerGas?: bigint
  ): Promise<string> {
    const nonce = await this.provider.getTransactionCount(this.signer.address);
    
    const currentBlock = await this.provider.getBlock("latest");
    const baseFee = currentBlock?.baseFeePerGas || 0n;
    const maxFeePerGas = maxPriorityFeePerGas || 2000000000n; // 2 gwei default
    const maxPriorityFee = maxPriorityFeePerGas || 2000000000n;

    const tx: ethers.TransactionRequest = {
      to: to as string,
      data,
      value,
      gasLimit,
      nonce,
      type: 2, // EIP-1559
      maxFeePerGas: baseFee + maxFeePerGas,
      maxPriorityFeePerGas: maxPriorityFee,
      chainId: this.chainId,
    };

    const signedTx = await this.signer.signTransaction(tx);
    return signedTx;
  }

  /**
   * Execute arbitrage via Flashbots with optimal tip
   * @param contractAddress Arbitrage contract address
   * @param encodedCallData Encoded function call data
   * @param estimatedProfit Estimated profit in wei
   * @returns Transaction hash if successful
   */
  async executeArbitrageViaFlashbots(
    contractAddress: string,
    encodedCallData: string,
    estimatedProfit: bigint
  ): Promise<string | null> {
    // Calculate optimal miner tip (10-20% of estimated profit)
    const minerTip = estimatedProfit / 10n; // 10% of profit as tip

    try {
      const signedTx = await this.signTransaction(
        contractAddress,
        encodedCallData,
        0n, // No ETH value
        500000n, // Gas limit
        minerTip
      );

      const result = await this.submitBundle([signedTx]);

      if (result.success) {
        console.log("✅ Bundle included in block!");
        return result.txHash || null;
      } else {
        console.log("⚠️ Bundle submission failed");
        return null;
      }
    } catch (error: any) {
      console.error("Flashbots execution failed:", error.message);
      return null;
    }
  }

  /**
   * Check if Flashbots is available for the current network
   * @returns True if Flashbots is available
   */
  async isFlashbotsAvailable(): Promise<boolean> {
    try {
      await this.provider.getBlockNumber();
      // Flashbots supports Ethereum mainnet and Base
      return this.chainId === 1 || this.chainId === 8453;
    } catch {
      return false;
    }
  }

  /**
   * Get current base fee for tip calculation
   * @returns Current base fee per gas
   */
  async getCurrentBaseFee(): Promise<bigint> {
    const currentBlock = await this.provider.getBlock("latest");
    return currentBlock?.baseFeePerGas || 0n;
  }

  /**
   * Execute transaction with fallback to public mempool
   * @param contractAddress Contract address
   * @param encodedCallData Call data
   * @param maxPriorityFeePerGas Max priority fee
   * @returns Transaction hash
   */
  async executeWithFallback(
    contractAddress: string,
    encodedCallData: string,
    maxPriorityFeePerGas?: bigint
  ): Promise<string> {
    // Try Flashbots first
    const flashbotsAvailable = await this.isFlashbotsAvailable();
    
    if (flashbotsAvailable && process.env.FLASHBOTS_ENABLED === "true") {
      const txHash = await this.executeArbitrageViaFlashbots(
        contractAddress,
        encodedCallData,
        ethers.parseEther("0.1") // Estimated profit
      );
      
      if (txHash) {
        return txHash;
      }
      
      console.log("Flashbots failed, falling back to public mempool");
    }

    // Fallback to public mempool
    const tx = await this.signer.sendTransaction({
      to: contractAddress,
      data: encodedCallData,
      maxPriorityFeePerGas: maxPriorityFeePerGas || 2000000000n,
      type: 2,
    });

    await tx.wait();
    return tx.hash;
  }
}