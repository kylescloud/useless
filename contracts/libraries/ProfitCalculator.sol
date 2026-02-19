// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title ProfitCalculator
 * @notice Library for calculating arbitrage profits
 * @author NinjaTech AI
 */
library ProfitCalculator {
    /**
     * @notice Calculate net profit after fees
     * @param amountIn Input amount
     * @param flashLoanFee Flash loan fee
     * @param gasCost Estimated gas cost
     * @return Net profit
     */
    function calculateNetProfit(
        uint256 amountIn,
        uint256 flashLoanFee,
        uint256 gasCost
    ) internal pure returns (uint256) {
        uint256 grossProfit = amountIn;
        uint256 totalCost = flashLoanFee + gasCost;
        
        if (grossProfit <= totalCost) {
            return 0;
        }
        
        return grossProfit - totalCost;
    }

    /**
     * @notice Calculate profit percentage
     * @param profit Net profit
     * @param capital Amount invested
     * @return Profit percentage in basis points
     */
    function calculateProfitPercentage(
        uint256 profit,
        uint256 capital
    ) internal pure returns (uint256) {
        if (capital == 0) return 0;
        return (profit * 10000) / capital; // Return in basis points
    }

    /**
     * @notice Calculate minimum output amount for a swap
     * @param amountIn Input amount
     * @param slippageBps Maximum slippage in basis points
     * @return Minimum output amount
     */
    function calculateMinAmountOut(
        uint256 amountIn,
        uint256 slippageBps
    ) internal pure returns (uint256) {
        return (amountIn * (10000 - slippageBps)) / 10000;
    }

    /**
     * @notice Validate if arbitrage is profitable
     * @param amountOut Output amount
     * @param amountIn Input amount
     * @param flashLoanFee Flash loan fee
     * @param gasCost Gas cost
     * @return True if profitable
     */
    function isProfitable(
        uint256 amountOut,
        uint256 amountIn,
        uint256 flashLoanFee,
        uint256 gasCost
    ) internal pure returns (bool) {
        uint256 netProfit = calculateNetProfit(amountOut, flashLoanFee, gasCost);
        return netProfit > 0;
    }
}