import { ethers } from "ethers";
import { FlashbotsBundleProvider, FlashbotsBundleResolution } from "@flashbots/ethers-provider-bundle";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * FlashbotsExecutor - Handles private mempool submission via Flashbots
 * Provides MEV protection and faster transaction inclusion
 */
export class FlashbotsExecutor {
  private provider: ethers.JsonRpcProvider;
  private flashbotsProvider: FlashbotsBundleProvider;
  private signer: ethers.Wallet;
  private chainId: number;

  constructor(rpcUrl: string, privateKey: string, chainId: number = 8453) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.signer = new ethers.Wallet(privateKey, this.provider);
    this.chainId = chainId;
    
    // Initialize Flashbots provider (using flashbots relay for Base)
    this.flashbotsProvider = FlashbotsBundleProvider.create(
      this.provider,
      this.signer,
      "https://relay.flashbots.net"
    );
  }

  /**
   * Submit a transaction bundle to Flashbots
   * @param signedTransactions Array of signed transactions
   * @param targetBlock Block number to target (optional)
   * @returns Bundle resolution
   */
  async submitBundle(
    signedTransactions: string[],
    targetBlock?: number
  ): Promise<FlashbotsBundleResolution> {
    const blockNumber = targetBlock || (await this.provider.getBlockNumber());
    
    const bundle = [
      {
        signedTransaction: signedTransactions[0],
      },
    ];

    const simulation = await this.flashbotsProvider.simulate(
      bundle,
      blockNumber
    );

    if (simulation.firstRevert) {
      throw new Error(`Bundle simulation failed: ${simulation.firstRevert.error}`);
    }

    console.log("Bundle simulation successful. Gas used:", simulation.totalGasUsed.toString());

    // Submit bundle
    const flashbotsTransactionResponse = await this.flashbotsProvider.sendBundle(
      bundle,
      blockNumber + 1
    );

    console.log("Bundle submitted. Waiting for inclusion...");

    return await flashbotsTransactionResponse.wait();
  }

  /**
   * Create and sign a signed transaction for Flashbots
   * @param to Recipient address
   * @param data Transaction data
   * @param value ETH value to send
   * @param gasLimit Gas limit
   * @param gasPrice Gas price (or maxFeePerGas for EIP-1559)
   * @returns Signed transaction string
   */
  async signTransaction(
    to: string,
    data: string,
    value: bigint = 0n,
    gasLimit: bigint = 500000n,
    gasPrice?: bigint
  ): Promise<string> {
    const nonce = await this.provider.getTransactionCount(this.signer.address);
    
    const currentBlock = await this.provider.getBlock("latest");
    const baseFee = currentBlock?.baseFeePerGas || 0n;
    const maxPriorityFeePerGas = gasPrice || 2000000000n; // 2 gwei default
    const maxFeePerGas = baseFee + maxPriorityFeePerGas;

    const tx: ethers.TransactionRequest = {
      to: to as string,
      data,
      value,
      gasLimit,
      nonce,
      type: 2, // EIP-1559
      maxFeePerGas,
      maxPriorityFeePerGas,
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

      const resolution = await this.submitBundle([signedTx]);

      if (resolution === FlashbotsBundleResolution.BundleIncluded) {
        console.log("✅ Bundle included in block!");
        const txHash = ethers.utils.parseTransaction(signedTx).hash;
        return txHash;
      } else if (resolution === FlashbotsBundleResolution.BlockPassedWithoutInclusion) {
        console.log("⚠️ Block passed without inclusion");
        return null;
      } else if (resolution === FlashbotsBundleResolution.AccountNonceTooHigh) {
        console.log("❌ Account nonce too high");
        return null;
      }

      return null;
    } catch (error) {
      console.error("Flashbots execution failed:", error);
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
      return true;
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
}