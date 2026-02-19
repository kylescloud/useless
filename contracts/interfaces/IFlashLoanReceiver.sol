// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title IFlashLoanReceiver
 * @notice Interface for Aave V3 flash loan callback
 * @author Aave
 */
interface IPoolAddressesProvider {
    function getPool() external view returns (address);
}

interface IPool {
    /**
     * @notice Flash loan callback
     * @param receiverAddress Address of flash loan receiver
     * @param assets List of assets to borrow
     * @param amounts List of amounts to borrow
     * @param interestRateModes List of interest rate modes
     * @param onBehalfOf Address on behalf of
     * @param params User data
     * @param referralCode Referral code
     */
    function flashLoan(
        address receiverAddress,
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata interestRateModes,
        address onBehalfOf,
        bytes calldata params,
        uint16 referralCode
    ) external;
}

/**
 * @notice Interface for flash loan receiver contracts
 */
interface IFlashLoanReceiver {
    /**
     * @notice Flash loan callback
     * @param assets List of borrowed assets
     * @param amounts List of borrowed amounts
     * @param premiums List of premiums (fees)
     * @param initiator Address that initiated the flash loan
     * @param params User data passed to flash loan
     * @return True if successful
     */
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external returns (bool);
}