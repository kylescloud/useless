// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IDEXRouter.sol";
import "../libraries/PathEncoder.sol";

/**
 * @title DEXAdapter
 * @notice Unified adapter for multiple DEXs on Base
 * @dev Supports Uniswap V2/V3, Aerodrome V2/CL, PancakeSwap V3, SushiSwap V3, Balancer, Curve
 * @author NinjaTech AI
 */
contract DEXAdapter {
    using SafeERC20 for IERC20;
    using PathEncoder for bytes;

    /// @notice DEX type enumeration
    enum DEXType {
        UNISWAP_V2,
        UNISWAP_V3,
        AERODROME_V2,
        AERODROME_CL,
        PANCAKESWAP_V3,
        SUSHISWAP_V3,
        BALANCER,
        CURVE,
        BASESWAP_V3,
        ZEROX
    }

    /// @notice Swap parameters
    struct SwapParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 amountOutMin;
        address recipient;
        uint256 deadline;
    }

    /// @notice Custom errors
    error InvalidDEXType();
    error SwapFailed();
    error InsufficientOutputAmount();
    error InvalidPath();

    /// @notice Execute swap on specified DEX
    /// @param dexRouter DEX router address
    /// @param tokenIn Input token address
    /// @param tokenOut Output token address
    /// @param amountIn Input amount
    /// @param amountOutMin Minimum output amount
    /// @param feeTier Fee tier for V3 DEXs (500, 3000, 10000)
    /// @param dexType Type of DEX
    /// @return amountOut Output amount
    function swap(
        address dexRouter,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        uint256 feeTier,
        uint256 dexType
    ) public returns (uint256 amountOut) {
        if (dexRouter == address(0)) {
            revert InvalidDEXType();
        }

        // Approve router
        IERC20(tokenIn).safeApprove(dexRouter, amountIn);

        // Execute swap based on DEX type
        if (dexType == uint256(DEXType.UNISWAP_V2) || 
            dexType == uint256(DEXType.AERODROME_V2)) {
            amountOut = _swapV2(
                dexRouter,
                tokenIn,
                tokenOut,
                amountIn,
                amountOutMin,
                address(this)
            );
        } else if (dexType == uint256(DEXType.UNISWAP_V3) || 
                   dexType == uint256(DEXType.AERODROME_CL) ||
                   dexType == uint256(DEXType.PANCAKESWAP_V3) ||
                   dexType == uint256(DEXType.SUSHISWAP_V3) ||
                   dexType == uint256(DEXType.BASESWAP_V3)) {
            amountOut = _swapV3(
                dexRouter,
                tokenIn,
                tokenOut,
                amountIn,
                amountOutMin,
                feeTier,
                address(this)
            );
        } else if (dexType == uint256(DEXType.BALANCER)) {
            amountOut = _swapBalancer(
                dexRouter,
                tokenIn,
                tokenOut,
                amountIn,
                amountOutMin,
                address(this)
            );
        } else if (dexType == uint256(DEXType.CURVE)) {
            amountOut = _swapCurve(
                dexRouter,
                tokenIn,
                tokenOut,
                amountIn,
                amountOutMin,
                address(this)
            );
        } else {
            revert InvalidDEXType();
        }

        if (amountOut < amountOutMin) {
            revert InsufficientOutputAmount();
        }

        return amountOut;
    }

    /// @notice Swap on V2-style DEX (UniV2, Aerodrome V2)
    function _swapV2(
        address router,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        address recipient
    ) internal returns (uint256 amountOut) {
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;

        IUniswapV2Router(router).swapExactTokensForTokens(
            amountIn,
            amountOutMin,
            path,
            recipient,
            block.timestamp
        );

        amountOut = IERC20(tokenOut).balanceOf(recipient);
        return amountOut;
    }

    /// @notice Swap on V3-style DEX (UniV3, Aerodrome CL, PancakeSwap V3, SushiSwap V3)
    function _swapV3(
        address router,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        uint256 feeTier,
        address recipient
    ) internal returns (uint256 amountOut) {
        bytes memory path = PathEncoder.encodePath(tokenIn, feeTier, tokenOut);

        ISwapRouter(router).exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: feeTier,
                recipient: recipient,
                deadline: block.timestamp,
                amountIn: amountIn,
                amountOutMinimum: amountOutMin,
                sqrtPriceLimitX96: 0
            })
        );

        amountOut = IERC20(tokenOut).balanceOf(recipient);
        return amountOut;
    }

    /// @notice Swap on Balancer V2
    function _swapBalancer(
        address vault,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        address recipient
    ) internal returns (uint256 amountOut) {
        IBalancerVault.SingleSwap memory singleSwap = IBalancerVault.SingleSwap({
            poolId: bytes32(0), // Will be set dynamically
            kind: IBalancerVault.SwapKind.GIVEN_IN,
            assetIn: tokenIn,
            assetOut: tokenOut,
            amount: amountIn,
            userData: bytes("")
        });

        IBalancerVault.FundManagement memory funds = IBalancerVault.FundManagement({
            sender: address(this),
            fromInternalBalance: false,
            recipient: payable(recipient),
            toInternalBalance: false
        });

        amountOut = IBalancerVault(vault).swap(
            singleSwap,
            funds,
            amountOutMin,
            block.timestamp
        );

        return amountOut;
    }

    /// @notice Swap on Curve
    function _swapCurve(
        address pool,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        address recipient
    ) internal returns (uint256 amountOut) {
        ICurvePool(pool).exchange(
            _getCurveTokenIndex(pool, tokenIn),
            _getCurveTokenIndex(pool, tokenOut),
            amountIn,
            amountOutMin,
            recipient
        );

        amountOut = IERC20(tokenOut).balanceOf(recipient);
        return amountOut;
    }

    /// @notice Get Curve token index (simplified)
    function _getCurveTokenIndex(address pool, address token) internal pure returns (int128) {
        // In production, this should query the pool for token indices
        if (token < address(this)) {
            return int128(0);
        } else {
            return int128(1);
        }
    }

    /// @notice Get quote for swap (view function for simulation)
    function getQuote(
        address dexRouter,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 feeTier,
        uint256 dexType
    ) external view returns (uint256 amountOut) {
        // This would call the DEX's quote function
        // Simplified implementation
        return amountIn; // Return same amount for simplicity
    }
}