import { ethers, upgrades } from "hardhat";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  console.log("Deploying FlashLoanArbitrage to Base...");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log("Account balance:", (await deployer.provider.getBalance(deployer.address)).toString());

  // Deploy FlashLoanArbitrage with UUPS upgradeable pattern
  const FlashLoanArbitrage = await ethers.getContractFactory("FlashLoanArbitrage");
  
  const arbitrage = await upgrades.deployProxy(
    FlashLoanArbitrage,
    [
      process.env.AAVE_POOL_ADDRESS || "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5", // Aave V3 Pool
      deployer.address, // Owner
      process.env.MAX_FLASH_LOAN_AMOUNT || ethers.parseEther("1000"), // Max flash loan amount
    ],
    {
      initializer: "initialize",
      kind: "uups",
    }
  );

  await arbitrage.waitForDeployment();
  const address = await arbitrage.getAddress();
  console.log("FlashLoanArbitrage deployed to:", address);

  // Wait for a few block confirmations
  console.log("Waiting for block confirmations...");
  await arbitrage.deploymentTransaction()?.wait(5);

  // Verify contract (uncomment if you have API key)
  // try {
  //   await hre.run("verify:verify", {
  //     address: address,
  //     constructorArguments: [],
  //   });
  //   console.log("Contract verified on BaseScan");
  // } catch (error) {
  //   console.log("Verification failed:", error);
  // }

  // Save deployment info
  const deploymentInfo = {
    network: (await ethers.provider.getNetwork()).name,
    chainId: (await ethers.provider.getNetwork()).chainId,
    deployer: deployer.address,
    contractAddress: address,
    deploymentTxHash: arbitrage.deploymentTransaction()?.hash,
    timestamp: new Date().toISOString(),
  };

  const fs = require("fs");
  fs.writeFileSync(
    `deployments/base-${new Date().getTime()}.json`,
    JSON.stringify(deploymentInfo, null, 2)
  );
  console.log("Deployment info saved to deployments/");

  console.log("\n=== Deployment Summary ===");
  console.log(`Contract: ${address}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Network: Base Mainnet (Chain ID: 8453)`);
  console.log("\nNext steps:");
  console.log("1. Add contract address to your .env file");
  console.log("2. Fund contract with ETH for gas");
  console.log("3. Start the arbitrage engine: npm run dev");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });