import winston from "winston";

const customFormat = winston.format.printf(({ level, message, timestamp, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
    return `${timestamp} [${level.toUpperCase().padEnd(5)}] ${message}${metaStr}`;
});

export const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || "info",
    format: winston.format.combine(
        winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
        winston.format.errors({ stack: true }),
        customFormat
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.timestamp({ format: "HH:mm:ss.SSS" }),
                customFormat
            ),
        }),
        new winston.transports.File({
            filename: "logs/arb-engine.log",
            maxsize: 50 * 1024 * 1024, // 50MB
            maxFiles: 10,
        }),
        new winston.transports.File({
            filename: "logs/arb-errors.log",
            level: "error",
            maxsize: 20 * 1024 * 1024,
            maxFiles: 5,
        }),
        new winston.transports.File({
            filename: "logs/arb-trades.log",
            level: "info",
            maxsize: 50 * 1024 * 1024,
            maxFiles: 20,
        }),
    ],
});

export class TradeLogger {
    static logOpportunity(params: {
        pair: string;
        buyDex: string;
        sellDex: string;
        profitBps: number;
        profitUsd: number;
        borrowAmount: string;
        asset: string;
    }) {
        logger.info(`🔍 OPPORTUNITY: ${params.pair} | Buy@${params.buyDex} Sell@${params.sellDex} | +${params.profitBps}bps ($${params.profitUsd.toFixed(4)}) | Borrow: ${params.borrowAmount} ${params.asset}`);
    }

    static logExecution(params: {
        txHash: string;
        pair: string;
        profit: string;
        gasUsed: string;
        gasCost: string;
        netProfit: string;
        duration: number;
    }) {
        logger.info(`✅ EXECUTED: ${params.pair} | Profit: ${params.profit} | Gas: ${params.gasUsed} (${params.gasCost} ETH) | Net: ${params.netProfit} | ${params.duration}ms | TX: ${params.txHash}`);
    }

    static logFailure(params: {
        pair: string;
        reason: string;
        error?: string;
    }) {
        logger.warn(`❌ FAILED: ${params.pair} | ${params.reason}${params.error ? ` | ${params.error}` : ""}`);
    }

    static logSkip(params: {
        pair: string;
        reason: string;
    }) {
        logger.debug(`⏭️  SKIP: ${params.pair} | ${params.reason}`);
    }

    static logCycle(params: {
        cycleNum: number;
        pairsScanned: number;
        opportunities: number;
        executed: number;
        duration: number;
    }) {
        logger.info(`📊 CYCLE #${params.cycleNum}: Scanned ${params.pairsScanned} pairs | Found ${params.opportunities} opps | Executed ${params.executed} | ${params.duration}ms`);
    }

    static logStats(params: {
        totalProfit: string;
        totalTrades: number;
        successRate: number;
        uptime: string;
        avgCycleTime: number;
    }) {
        logger.info(`📈 STATS: Total Profit: ${params.totalProfit} | Trades: ${params.totalTrades} | Success: ${params.successRate.toFixed(1)}% | Uptime: ${params.uptime} | Avg Cycle: ${params.avgCycleTime}ms`);
    }
}