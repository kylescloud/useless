import axios, { AxiosInstance } from "axios";
import { ethers } from "ethers";
import { ZEROX, TOKENS, BASE_CHAIN_ID } from "../config/addresses";
import { logger } from "../utils/Logger";

// ═══════════════════════════════════════════════════════════════════
//                    0x SWAP API V2 CLIENT
// ═══════════════════════════════════════════════════════════════════

export interface ZeroExQuote {
    sellToken: string;
    buyToken: string;
    sellAmount: string;
    buyAmount: string;
    price: string;
    guaranteedPrice: string;
    estimatedGas: string;
    gasPrice: string;
    target: string;     // Contract to call (AllowanceHolder or Settler)
    callData: string;   // Encoded swap calldata
    allowanceTarget: string;
    sources: Array<{ name: string; proportion: string }>;
    estimatedPriceImpact: string;
}

export interface ZeroExPrice {
    sellToken: string;
    buyToken: string;
    sellAmount: string;
    buyAmount: string;
    price: string;
    estimatedGas: string;
    sources: Array<{ name: string; proportion: string }>;
}

export class ZeroExClient {
    private client: AxiosInstance;
    private apiKey: string;
    private rateLimitDelay: number = 100; // ms between requests
    private lastRequestTime: number = 0;

    constructor(apiKey: string) {
        this.apiKey = apiKey;
        this.client = axios.create({
            baseURL: ZEROX.API_URL,
            timeout: 10000,
            headers: {
                "0x-api-key": apiKey,
                "0x-version": "v2",
                "Content-Type": "application/json",
            },
        });
    }

    // ═══════════════════════════════════════════════════════════════
    //                    PRICE QUOTE (NO CALLDATA)
    // ═══════════════════════════════════════════════════════════════
    async getPrice(
        sellToken: string,
        buyToken: string,
        sellAmount: string,
        taker?: string
    ): Promise<ZeroExPrice | null> {
        await this.rateLimit();

        try {
            const params: Record<string, string> = {
                chainId: BASE_CHAIN_ID.toString(),
                sellToken,
                buyToken,
                sellAmount,
            };
            if (taker) params.taker = taker;

            const response = await this.client.get(ZEROX.PRICE_ENDPOINT, { params });
            return response.data as ZeroExPrice;
        } catch (error: any) {
            if (error.response?.status === 429) {
                logger.warn("0x API rate limited, backing off...");
                await this.sleep(2000);
            } else {
                logger.debug(`0x price quote failed: ${error.message}`);
            }
            return null;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //                  FIRM QUOTE (WITH CALLDATA)
    // ═══════════════════════════════════════════════════════════════
    async getQuote(
        sellToken: string,
        buyToken: string,
        sellAmount: string,
        taker: string,
        slippageBps: number = 30
    ): Promise<ZeroExQuote | null> {
        await this.rateLimit();

        try {
            const params: Record<string, string> = {
                chainId: BASE_CHAIN_ID.toString(),
                sellToken,
                buyToken,
                sellAmount,
                taker,
                slippagePercentage: (slippageBps / 10000).toString(),
            };

            const response = await this.client.get(ZEROX.SWAP_ENDPOINT, { params });
            return response.data as ZeroExQuote;
        } catch (error: any) {
            if (error.response?.status === 429) {
                logger.warn("0x API rate limited, backing off...");
                await this.sleep(2000);
            } else {
                logger.debug(`0x firm quote failed: ${error.message}`);
            }
            return null;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //              COMPARE 0x VS DIRECT DEX QUOTES
    // ═══════════════════════════════════════════════════════════════
    async getBestRoute(
        sellTokenSymbol: string,
        buyTokenSymbol: string,
        sellAmount: bigint,
        taker: string
    ): Promise<{
        buyAmount: bigint;
        target: string;
        callData: string;
        sources: Array<{ name: string; proportion: string }>;
        gasEstimate: bigint;
    } | null> {
        const sellToken = TOKENS[sellTokenSymbol];
        const buyToken = TOKENS[buyTokenSymbol];
        if (!sellToken || !buyToken) return null;

        const quote = await this.getQuote(
            sellToken.address,
            buyToken.address,
            sellAmount.toString(),
            taker
        );

        if (!quote) return null;

        return {
            buyAmount: BigInt(quote.buyAmount),
            target: quote.target,
            callData: quote.callData,
            sources: quote.sources,
            gasEstimate: BigInt(quote.estimatedGas),
        };
    }

    // ═══════════════════════════════════════════════════════════════
    //              ENCODE FOR ON-CHAIN EXECUTION
    // ═══════════════════════════════════════════════════════════════
    encodeForContract(quote: ZeroExQuote, tokenIn: string): string {
        return ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "address", "bytes"],
            [quote.target, tokenIn, quote.callData]
        );
    }

    // ═══════════════════════════════════════════════════════════════
    //                    RATE LIMITING
    // ═══════════════════════════════════════════════════════════════
    private async rateLimit(): Promise<void> {
        const now = Date.now();
        const elapsed = now - this.lastRequestTime;
        if (elapsed < this.rateLimitDelay) {
            await this.sleep(this.rateLimitDelay - elapsed);
        }
        this.lastRequestTime = Date.now();
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}