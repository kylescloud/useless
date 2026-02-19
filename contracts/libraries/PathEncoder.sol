// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title PathEncoder
 * @notice Library for encoding/decoding Uniswap V3 paths
 * @author NinjaTech AI
 */
library PathEncoder {
    /**
     * @notice Encode a single-hop path
     * @param tokenIn Input token
     * @param fee Fee tier
     * @param tokenOut Output token
     * @return Encoded path
     */
    function encodePath(
        address tokenIn,
        uint24 fee,
        address tokenOut
    ) internal pure returns (bytes memory) {
        return abi.encodePacked(tokenIn, fee, tokenOut);
    }

    /**
     * @notice Encode a multi-hop path
     * @param tokens Array of tokens
     * @param fees Array of fees
     * @return Encoded path
     */
    function encodeMultiHopPath(
        address[] memory tokens,
        uint24[] memory fees
    ) internal pure returns (bytes memory) {
        require(tokens.length == fees.length + 1, "Invalid path length");

        bytes memory path;
        for (uint256 i = 0; i < fees.length; i++) {
            path = abi.encodePacked(path, tokens[i], fees[i]);
        }
        path = abi.encodePacked(path, tokens[tokens.length - 1]);

        return path;
    }

    /**
     * @notice Decode path to get tokens and fees
     * @param path Encoded path
     * @return tokens Array of tokens
     * @return fees Array of fees
     */
    function decodePath(bytes memory path) internal pure returns (address[] memory tokens, uint24[] memory fees) {
        uint256 numPools = (path.length - 20) / 23;
        tokens = new address[](numPools + 1);
        fees = new uint24[](numPools);

        uint256 index;
        for (uint256 i = 0; i < numPools; i++) {
            tokens[i] = address(bytes20(path[index:index + 20]));
            fees[i] = uint24(bytes3(path[index + 20:index + 23]));
            index += 23;
        }
        tokens[numPools] = address(bytes20(path[index:index + 20]));

        return (tokens, fees);
    }

    /**
     * @notice Get first pool in path
     * @param path Encoded path
     * @return token0 First token
     * @return token1 Second token
     * @return fee Fee tier
     */
    function getFirstPool(bytes memory path) internal pure returns (address token0, address token1, uint24 fee) {
        token0 = address(bytes20(path[0:20]));
        fee = uint24(bytes3(path[20:23]));
        token1 = address(bytes20(path[23:43]));
        return (token0, token1, fee);
    }
}