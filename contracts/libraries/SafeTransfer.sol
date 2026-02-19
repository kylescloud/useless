// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title SafeTransfer
 * @notice Library for safe token transfers
 * @author NinjaTech AI
 */
library SafeTransfer {
    using SafeERC20 for IERC20;

    error TransferFailed();
    error ZeroAddress();

    /**
     * @notice Safely transfer tokens
     * @param token Token address
     * @param to Recipient address
     * @param amount Amount to transfer
     */
    function safeTransfer(
        address token,
        address to,
        uint256 amount
    ) internal {
        if (to == address(0)) revert ZeroAddress();

        uint256 balanceBefore = IERC20(token).balanceOf(to);
        IERC20(token).safeTransferFrom(msg.sender, to, amount);
        uint256 balanceAfter = IERC20(token).balanceOf(to);

        if (balanceAfter - balanceBefore != amount) revert TransferFailed();
    }

    /**
     * @notice Safely transfer ETH
     * @param to Recipient address
     * @param amount Amount to transfer
     */
    function safeTransferETH(address to, uint256 amount) internal {
        if (to == address(0)) revert ZeroAddress();
        
        (bool success, ) = to.call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    /**
     * @notice Get token balance
     * @param token Token address
     * @param account Account address
     * @return Balance
     */
    function balanceOf(
        address token,
        address account
    ) internal view returns (uint256) {
        return IERC20(token).balanceOf(account);
    }
}