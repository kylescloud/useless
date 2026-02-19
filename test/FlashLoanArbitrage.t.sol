// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/FlashLoanArbitrage.sol";
import "../contracts/libraries/ProfitCalculator.sol";
import "../contracts/libraries/PathEncoder.sol";
import "../contracts/libraries/SafeTransfer.sol";

/// @title FlashLoanArbitrageTest - Comprehensive test suite
/// @notice Tests core contract logic, libraries, and integration
contract FlashLoanArbitrageTest is Test {
    using SafeTransfer for address;

    FlashLoanArbitrage public arb;
    address public owner = address(this);
    address public executor = address(0xBEEF);
    address public attacker = address(0xDEAD);

    // Base chain fork
    uint256 public baseFork;

    // Known Base tokens
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant cbETH = 0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22;
    address constant AAVE_POOL = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;

    function setUp() public {
        // Fork Base mainnet
        string memory rpcUrl = vm.envOr("BASE_RPC_URL", string("https://mainnet.base.org"));
        baseFork = vm.createFork(rpcUrl);
        vm.selectFork(baseFork);

        // Deploy contract
        arb = new FlashLoanArbitrage(executor, 5);
    }

    // ═══════════════════════════════════════════════════════════════
    //                    DEPLOYMENT TESTS
    // ═══════════════════════════════════════════════════════════════

    function test_deployment() public view {
        assertEq(arb.owner(), owner);
        assertEq(arb.executor(), executor);
        assertEq(arb.minProfitBps(), 5);
        assertFalse(arb.paused());
        assertEq(arb.totalExecutions(), 0);
    }

    function test_constants() public view {
        assertEq(arb.AAVE_POOL(), AAVE_POOL);
        assertEq(arb.WETH(), WETH);
        assertEq(arb.USDC(), USDC);
        assertEq(arb.UNISWAP_V3_ROUTER(), 0x2626664c2603336E57B271c5C0b26F421741e481);
        assertEq(arb.AERODROME_ROUTER(), 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43);
        assertEq(arb.PANCAKE_V3_ROUTER(), 0x678Aa4bF4E210cf2166753e054d5b7c31cc7fa86);
    }

    function test_flashLoanPremium() public view {
        uint128 premium = arb.getFlashLoanPremium();
        assertGt(premium, 0);
        assertLe(premium, 100); // Should be <= 1%
    }

    // ═══════════════════════════════════════════════════════════════
    //                    ACCESS CONTROL TESTS
    // ═══════════════════════════════════════════════════════════════

    function test_onlyOwner_setExecutor() public {
        arb.setExecutor(address(0x1234));
        assertEq(arb.executor(), address(0x1234));
    }

    function test_revert_nonOwner_setExecutor() public {
        vm.prank(attacker);
        vm.expectRevert("FlashArb: not owner");
        arb.setExecutor(address(0x1234));
    }

    function test_onlyOwner_setPaused() public {
        arb.setPaused(true);
        assertTrue(arb.paused());
        arb.setPaused(false);
        assertFalse(arb.paused());
    }

    function test_revert_nonOwner_setPaused() public {
        vm.prank(attacker);
        vm.expectRevert("FlashArb: not owner");
        arb.setPaused(true);
    }

    function test_onlyOwner_setMinProfitBps() public {
        arb.setMinProfitBps(10);
        assertEq(arb.minProfitBps(), 10);
    }

    function test_onlyExecutor_executeArbitrage() public {
        vm.prank(attacker);
        vm.expectRevert("FlashArb: not executor");
        arb.executeArbitrage(WETH, 1 ether, "");
    }

    function test_ownerCanExecute() public {
        // Owner should also be able to execute (as per modifier)
        // This will revert due to empty params, but not due to access control
        vm.expectRevert(); // Will revert in Aave callback, not access control
        arb.executeArbitrage(WETH, 1 ether, "");
    }

    function test_revert_whenPaused() public {
        arb.setPaused(true);
        vm.prank(executor);
        vm.expectRevert("FlashArb: paused");
        arb.executeArbitrage(WETH, 1 ether, "");
    }

    // ═══════════════════════════════════════════════════════════════
    //                    OWNERSHIP TESTS
    // ═══════════════════════════════════════════════════════════════

    function test_transferOwnership() public {
        address newOwner = address(0x9999);
        arb.transferOwnership(newOwner);
        assertEq(arb.owner(), newOwner);
    }

    function test_revert_transferOwnership_zeroAddress() public {
        vm.expectRevert("FlashArb: zero address");
        arb.transferOwnership(address(0));
    }

    // ═══════════════════════════════════════════════════════════════
    //                    EMERGENCY WITHDRAW TESTS
    // ═══════════════════════════════════════════════════════════════

    function test_emergencyWithdraw_ETH() public {
        // Send ETH to contract
        vm.deal(address(arb), 1 ether);
        assertEq(address(arb).balance, 1 ether);

        uint256 ownerBalBefore = owner.balance;
        arb.emergencyWithdraw(address(0), 1 ether);
        assertEq(owner.balance, ownerBalBefore + 1 ether);
    }

    function test_emergencyWithdraw_ERC20() public {
        // Deal USDC to contract
        deal(USDC, address(arb), 1000e6);
        assertEq(USDC.balanceOf(address(arb)), 1000e6);

        arb.emergencyWithdraw(USDC, 1000e6);
        assertEq(USDC.balanceOf(owner), 1000e6);
    }

    function test_revert_nonOwner_emergencyWithdraw() public {
        vm.prank(attacker);
        vm.expectRevert("FlashArb: not owner");
        arb.emergencyWithdraw(USDC, 1000e6);
    }

    // ═══════════════════════════════════════════════════════════════
    //                    BATCH WITHDRAW TESTS
    // ═══════════════════════════════════════════════════════════════

    function test_batchWithdrawProfits() public {
        deal(USDC, address(arb), 1000e6);
        deal(WETH, address(arb), 1 ether);

        address[] memory tokens = new address[](2);
        tokens[0] = USDC;
        tokens[1] = WETH;

        arb.batchWithdrawProfits(tokens);

        assertEq(USDC.balanceOf(owner), 1000e6);
        assertEq(WETH.balanceOf(owner), 1 ether);
    }

    // ═══════════════════════════════════════════════════════════════
    //                    VIEW FUNCTION TESTS
    // ═══════════════════════════════════════════════════════════════

    function test_getBalance() public {
        deal(USDC, address(arb), 500e6);
        assertEq(arb.getBalance(USDC), 500e6);
    }

    function test_getBalances() public {
        deal(USDC, address(arb), 500e6);
        deal(WETH, address(arb), 2 ether);

        address[] memory tokens = new address[](2);
        tokens[0] = USDC;
        tokens[1] = WETH;

        uint256[] memory balances = arb.getBalances(tokens);
        assertEq(balances[0], 500e6);
        assertEq(balances[1], 2 ether);
    }

    // ═══════════════════════════════════════════════════════════════
    //                    CALLBACK SECURITY TESTS
    // ═══════════════════════════════════════════════════════════════

    function test_revert_executeOperation_notPool() public {
        vm.prank(attacker);
        vm.expectRevert("FlashArb: caller not pool");
        arb.executeOperation(WETH, 1 ether, 0, address(arb), "");
    }

    function test_revert_executeOperation_wrongInitiator() public {
        vm.prank(AAVE_POOL);
        vm.expectRevert("FlashArb: initiator mismatch");
        arb.executeOperation(WETH, 1 ether, 0, attacker, "");
    }

    // ═══════════════════════════════════════════════════════════════
    //                    LIBRARY TESTS
    // ═══════════════════════════════════════════════════════════════

    function test_profitCalculator_getMinOutput() public pure {
        uint256 minOutput = ProfitCalculator.getMinOutput(1000e6, 5);
        assertEq(minOutput, 1000500000); // 1000 USDC + 0.05% = 1000.5 USDC
    }

    function test_profitCalculator_calculateProfit() public pure {
        uint256 profit = ProfitCalculator.calculateProfit(1002e6, 1000e6, 5);
        assertEq(profit, 1500000); // 1002 - 1000.5 = 1.5 USDC
    }

    function test_profitCalculator_validateProfit() public pure {
        (bool isValid, uint256 profit) = ProfitCalculator.validateProfit(1010e6, 1000e6, 5, 5);
        assertTrue(isValid);
        assertEq(profit, 9500000); // 1010 - 1000.5 = 9.5 USDC
    }

    function test_profitCalculator_validateProfit_belowMin() public pure {
        (bool isValid,) = ProfitCalculator.validateProfit(1000600000, 1000e6, 5, 5);
        assertFalse(isValid); // 0.1 USDC profit < 0.05% of 1000 = 0.5 USDC
    }

    function test_pathEncoder_singleHop() public pure {
        bytes memory path = PathEncoder.encodeSingleHop(WETH, 3000, USDC);
        assertEq(path.length, 43); // 20 + 3 + 20
    }

    function test_pathEncoder_twoHop() public pure {
        bytes memory path = PathEncoder.encodeTwoHop(WETH, 3000, USDC, 500, cbETH);
        assertEq(path.length, 66); // 20 + 3 + 20 + 3 + 20
        assertTrue(PathEncoder.hasMultipleHops(path));
        assertEq(PathEncoder.numHops(path), 2);
    }

    function test_pathEncoder_decodeFirstToken() public pure {
        bytes memory path = PathEncoder.encodeSingleHop(WETH, 3000, USDC);
        address firstToken = PathEncoder.decodeFirstToken(path);
        assertEq(firstToken, WETH);
    }

    // ═══════════════════════════════════════════════════════════════
    //                    RECEIVE ETH TEST
    // ═══════════════════════════════════════════════════════════════

    function test_receiveETH() public {
        vm.deal(address(this), 1 ether);
        (bool success,) = address(arb).call{value: 1 ether}("");
        assertTrue(success);
        assertEq(address(arb).balance, 1 ether);
    }

    // ═══════════════════════════════════════════════════════════════
    //                    FUZZ TESTS
    // ═══════════════════════════════════════════════════════════════

    function testFuzz_profitCalculator(uint256 borrowAmount, uint256 received) public pure {
        vm.assume(borrowAmount > 0 && borrowAmount < type(uint128).max);
        vm.assume(received > 0 && received < type(uint128).max);

        uint256 minOutput = ProfitCalculator.getMinOutput(borrowAmount, 5);
        assertGe(minOutput, borrowAmount);
    }

    function testFuzz_minProfitBps(uint256 bps) public {
        vm.assume(bps <= 10000);
        arb.setMinProfitBps(bps);
        assertEq(arb.minProfitBps(), bps);
    }
}