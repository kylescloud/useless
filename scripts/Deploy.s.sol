// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../contracts/FlashLoanArbitrage.sol";

contract DeployFlashLoanArbitrage is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address executor = vm.envAddress("EXECUTOR_ADDRESS");
        uint256 minProfitBps = vm.envOr("MIN_PROFIT_BPS", uint256(5)); // 0.05% default

        vm.startBroadcast(deployerPrivateKey);

        FlashLoanArbitrage arb = new FlashLoanArbitrage(executor, minProfitBps);

        console.log("FlashLoanArbitrage deployed at:", address(arb));
        console.log("Owner:", arb.owner());
        console.log("Executor:", arb.executor());
        console.log("Min Profit BPS:", arb.minProfitBps());

        vm.stopBroadcast();
    }
}

contract VerifyDeployment is Script {
    function run() external view {
        address arbAddress = vm.envAddress("ARB_CONTRACT_ADDRESS");
        FlashLoanArbitrage arb = FlashLoanArbitrage(payable(arbAddress));

        console.log("=== Deployment Verification ===");
        console.log("Contract:", arbAddress);
        console.log("Owner:", arb.owner());
        console.log("Executor:", arb.executor());
        console.log("Paused:", arb.paused());
        console.log("Min Profit BPS:", arb.minProfitBps());
        console.log("Total Executions:", arb.totalExecutions());
        console.log("Flash Loan Premium:", arb.getFlashLoanPremium());
        console.log("=== Aave V3 Addresses ===");
        console.log("Pool:", arb.AAVE_POOL());
        console.log("Pool Addresses Provider:", arb.AAVE_POOL_ADDRESSES_PROVIDER());
        console.log("=== DEX Routers ===");
        console.log("Uniswap V3:", arb.UNISWAP_V3_ROUTER());
        console.log("Uniswap V2:", arb.UNISWAP_V2_ROUTER());
        console.log("Aerodrome:", arb.AERODROME_ROUTER());
        console.log("PancakeSwap V3:", arb.PANCAKE_V3_ROUTER());
        console.log("SushiSwap V3:", arb.SUSHI_V3_ROUTER());
        console.log("Balancer V2:", arb.BALANCER_VAULT());
    }
}