// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/IFlashLoanReceiver.sol";
import "./adapters/DEXAdapter.sol";
import "./libraries/SafeTransfer.sol";
import "./libraries/ProfitCalculator.sol";

/**
 * @title FlashLoanArbitrage
 * @notice Aave V3 Flash Loan Arbitrage Contract with Multi-DEX Support
 * @dev Uses UUPS upgradeable pattern for gas efficiency
 * @author NinjaTech AI
 */
contract FlashLoanArbitrage is
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    PausableUpgradeable,
    IFlashLoanReceiver
{
    using SafeERC20 for IERC20;
    using SafeTransfer for address;

    /// @notice Aave V3 Pool address
    IPoolAddressesProvider public immutable poolAddressesProvider;
    IPool public immutable pool;

    /// @notice Maximum flash loan amount per transaction
    uint256 public maxFlashLoanAmount;

    /// @notice Aave flash loan premium (5 bps = 0.05%)
    uint256 public constant FLASH_LOAN_PREMIUM = 5; // 5 basis points

    /// @notice Minimum profit threshold (in wei)
    uint256 public minProfitThreshold;

    /// @notice Emergency withdrawal state
    bool public emergencyWithdrawEnabled;

    /// @notice Track processed flash loans to prevent reentrancy
    bytes32 private lastFlashLoanId;

    /// @notice Events
    event FlashLoanExecuted(
        address indexed asset,
        uint256 amount,
        uint256 premium,
        uint256 gasUsed,
        bool success
    );
    event ArbitrageExecuted(
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 profit
    );
    event EmergencyWithdrawal(address indexed token, uint256 amount);
    event MaxFlashLoanAmountUpdated(uint256 oldAmount, uint256 newAmount);
    event MinProfitThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);

    /// @notice Custom errors
    error FlashLoanFailed();
    error InvalidAmount();
    error InvalidAddress();
    error MaxAmountExceeded();
    error MinProfitNotReached();
    error ReentrancyDetected();
    error NotAavePool();

    /// @notice Modifier to only allow Aave pool
    modifier onlyAavePool() {
        if (msg.sender != address(pool)) {
            revert NotAavePool();
        }
        _;
    }

    /**
     * @notice Initialize the contract
     * @param _poolAddressesProvider Aave PoolAddressesProvider address
     * @param _owner Contract owner address
     * @param _maxFlashLoanAmount Maximum flash loan amount
     */
    function initialize(
        address _poolAddressesProvider,
        address _owner,
        uint256 _maxFlashLoanAmount
    ) public initializer {
        __UUPSUpgradeable_init();
        __Ownable_init(_owner);
        __Pausable_init();

        if (_poolAddressesProvider == address(0)) {
            revert InvalidAddress();
        }

        poolAddressesProvider = IPoolAddressesProvider(_poolAddressesProvider);
        pool = IPool(poolAddressesProvider.getPool());

        maxFlashLoanAmount = _maxFlashLoanAmount;
        minProfitThreshold = 0.01 ether; // Default 0.01 ETH
        emergencyWithdrawEnabled = false;
    }

    /**
     * @notice Execute flash loan from Aave V3
     * @param asset Address of the asset to borrow
     * @param amount Amount to borrow
     * @param params Encoded parameters for arbitrage strategy
     */
    function executeFlashLoan(
        address asset,
        uint256 amount,
        bytes calldata params
    ) external onlyOwner whenNotPaused {
        if (amount == 0 || amount > maxFlashLoanAmount) {
            revert InvalidAmount();
        }

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;

        address[] memory assets = new address[](1);
        assets[0] = asset;

        bytes memory userData = abi.encode(
            msg.sender,
            params,
            keccak256(abi.encodePacked(block.timestamp, block.number, msg.sender))
        );

        pool.flashLoan(
            address(this),
            assets,
            amounts,
            new uint256[](1), // interest rate modes
            0, // on behalf of
            userData,
            0 // referral code
        );
    }

    /**
     * @notice Aave V3 flash loan callback
     * @param assets List of borrowed assets
     * @param amounts List of borrowed amounts
     * @param premiums List of premiums (fees)
     * @param initiator Address that initiated the flash loan
     * @param params User data passed to flash loan
     */
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external onlyAavePool returns (bool) {
        if (initiator != address(this)) {
            revert FlashLoanFailed();
        }

        address asset = assets[0];
        uint256 amount = amounts[0];
        uint256 premium = premiums[0];
        uint256 totalDebt = amount + premium;

        // Decode user data
        (
            address user,
            bytes memory strategyParams,
            bytes32 flashLoanId
        ) = abi.decode(params, (address, bytes, bytes32));

        // Reentrancy protection
        if (lastFlashLoanId == flashLoanId) {
            revert ReentrancyDetected();
        }
        lastFlashLoanId = flashLoanId;

        // Calculate gas cost for profit validation
        uint256 gasUsed = gasleft();
        uint256 gasCost = tx.gasprice * gasUsed;

        // Execute arbitrage strategy
        bool success;
        uint256 profit;

        try this.executeArbitrageStrategy(asset, amount, strategyParams) returns (uint256 _profit) {
            profit = _profit;
            success = true;
        } catch {
            success = false;
        }

        if (success) {
            // Validate profit covers costs
            if (profit < minProfitThreshold + gasCost) {
                revert MinProfitNotReached();
            }

            emit ArbitrageExecuted(asset, asset, amount, amount + profit, profit);
        } else {
            revert FlashLoanFailed();
        }

        // Repay flash loan
        IERC20(asset).safeTransfer(address(pool), totalDebt);

        emit FlashLoanExecuted(asset, amount, premium, gasUsed, success);

        return true;
    }

    /**
     * @notice Execute arbitrage strategy (external for try-catch)
     * @param tokenIn Input token address
     * @param amountIn Input amount
     * @param params Strategy parameters
     */
    function executeArbitrageStrategy(
        address tokenIn,
        uint256 amountIn,
        bytes calldata params
    ) external returns (uint256 profit) {
        // Ensure only contract can call
        if (msg.sender != address(this)) {
            revert FlashLoanFailed();
        }

        // Decode strategy parameters
        (
            address tokenOut,
            address[] memory dexRouters,
            uint256[] memory feeTiers,
            uint256 minAmountOut
        ) = abi.decode(params, (address, address[], uint256[], uint256));

        // Execute multi-DEX arbitrage
        uint256 amountOut = amountIn;

        // First swap
        DEXAdapter dexAdapter = new DEXAdapter();
        amountOut = dexAdapter.swap(
            dexRouters[0],
            tokenIn,
            tokenOut,
            amountIn,
            minAmountOut,
            feeTiers[0],
            0 // DEX type
        );

        // Check profit
        profit = amountOut - amountIn;

        if (profit <= 0) {
            revert MinProfitNotReached();
        }

        return profit;
    }

    /**
     * @notice Calculate profit after fees and gas costs
     * @param amountIn Input amount
     * @param gasCost Estimated gas cost
     * @return Expected profit
     */
    function calculateProfit(uint256 amountIn, uint256 gasCost) public pure returns (uint256) {
        uint256 flashLoanFee = (amountIn * FLASH_LOAN_PREMIUM) / 10000;
        return ProfitCalculator.calculateNetProfit(amountIn, flashLoanFee, gasCost);
    }

    /**
     * @notice Validate if profit is sufficient
     * @param amountIn Input amount
     * @param gasCost Estimated gas cost
     * @return True if profitable
     */
    function validateProfit(uint256 amountIn, uint256 gasCost) public view returns (bool) {
        uint256 expectedProfit = calculateProfit(amountIn, gasCost);
        return expectedProfit >= minProfitThreshold;
    }

    /**
     * @notice Emergency withdraw tokens (only owner)
     * @param token Token address
     * @param amount Amount to withdraw
     */
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        if (!emergencyWithdrawEnabled) {
            revert("Emergency withdraw not enabled");
        }

        if (token == address(0)) {
            payable(owner()).transfer(amount);
        } else {
            IERC20(token).safeTransfer(owner(), amount);
        }

        emit EmergencyWithdrawal(token, amount);
    }

    /**
     * @notice Update maximum flash loan amount
     * @param _maxFlashLoanAmount New maximum amount
     */
    function setMaxFlashLoanAmount(uint256 _maxFlashLoanAmount) external onlyOwner {
        uint256 oldAmount = maxFlashLoanAmount;
        maxFlashLoanAmount = _maxFlashLoanAmount;
        emit MaxFlashLoanAmountUpdated(oldAmount, _maxFlashLoanAmount);
    }

    /**
     * @notice Update minimum profit threshold
     * @param _minProfitThreshold New minimum threshold
     */
    function setMinProfitThreshold(uint256 _minProfitThreshold) external onlyOwner {
        uint256 oldThreshold = minProfitThreshold;
        minProfitThreshold = _minProfitThreshold;
        emit MinProfitThresholdUpdated(oldThreshold, _minProfitThreshold);
    }

    /**
     * @notice Enable emergency withdrawal
     * @param _enabled Enable/disable status
     */
    function setEmergencyWithdrawEnabled(bool _enabled) external onlyOwner {
        emergencyWithdrawEnabled = _enabled;
    }

    /**
     * @notice Authorize upgrade (UUPS pattern)
     * @param newImplementation New implementation address
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    /// @notice Receive ETH
    receive() external payable {}
}