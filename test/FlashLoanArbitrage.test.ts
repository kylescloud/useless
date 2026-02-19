import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { FlashLoanArbitrage } from "../typechain-types";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("FlashLoanArbitrage", function () {
  let arbitrage: FlashLoanArbitrage;
  let owner: SignerWithAddress;
  let user: SignerWithAddress;
  let weth: any;
  let usdc: any;

  const AAVE_POOL = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
  const WETH = "0x4200000000000000000000000000000000000006";
  const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bDA02913";

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();

    // Deploy FlashLoanArbitrage
    const FlashLoanArbitrage = await ethers.getContractFactory("FlashLoanArbitrage");
    arbitrage = await upgrades.deployProxy(
      FlashLoanArbitrage,
      [AAVE_POOL, owner.address, ethers.parseEther("1000")],
      { initializer: "initialize", kind: "uups" }
    );
    await arbitrage.waitForDeployment();

    // Get token contracts
    weth = await ethers.getContractAt("IERC20", WETH);
    usdc = await ethers.getContractAt("IERC20", USDC);
  });

  describe("Deployment", function () {
    it("Should set the correct owner", async function () {
      expect(await arbitrage.owner()).to.equal(owner.address);
    });

    it("Should set the correct Aave pool", async function () {
      expect(await arbitrage.aavePool()).to.equal(AAVE_POOL);
    });

    it("Should set the correct max flash loan amount", async function () {
      expect(await arbitrage.maxFlashLoanAmount()).to.equal(ethers.parseEther("1000"));
    });
  });

  describe("Access Control", function () {
    it("Should allow owner to update parameters", async function () {
      await expect(arbitrage.connect(owner).setMaxFlashLoanAmount(ethers.parseEther("2000")))
        .to.not.be.reverted;
      expect(await arbitrage.maxFlashLoanAmount()).to.equal(ethers.parseEther("2000"));
    });

    it("Should prevent non-owner from updating parameters", async function () {
      await expect(arbitrage.connect(user).setMaxFlashLoanAmount(ethers.parseEther("2000")))
        .to.be.revertedWithCustomError(arbitrage, "OwnableUnauthorizedAccount");
    });
  });

  describe("Emergency Functions", function () {
    it("Should allow owner to emergency withdraw tokens", async function () {
      // Mint some tokens to the contract (for testing)
      const amount = ethers.parseEther("1");
      
      // Fund the contract with ETH
      await owner.sendTransaction({
        to: await arbitrage.getAddress(),
        value: amount,
      });

      const contractBalanceBefore = await ethers.provider.getBalance(await arbitrage.getAddress());
      expect(contractBalanceBefore).to.equal(amount);

      await expect(arbitrage.connect(owner).emergencyWithdraw(WETH, amount))
        .to.not.be.reverted;
    });

    it("Should allow owner to pause the contract", async function () {
      await expect(arbitrage.connect(owner).pause()).to.not.be.reverted;
      expect(await arbitrage.paused()).to.be.true;
    });

    it("Should prevent operations when paused", async function () {
      await arbitrage.connect(owner).pause();
      
      await expect(
        arbitrage.connect(owner).executeArbitrage(
          WETH,
          0,
          "0x",
          0
        )
      ).to.be.revertedWithCustomError(arbitrage, "EnforcedPause");
    });
  });

  describe("Arbitrage Execution", function () {
    it("Should calculate profit correctly", async function () {
      const amount = ethers.parseEther("1");
      const gasCost = ethers.parseEther("0.01");
      const flashLoanFee = amount * 5n / 10000n; // 5 bps

      const profit = await arbitrage.calculateProfit.staticCall(amount, gasCost);
      expect(profit).to.be.gt(0);
    });

    it("Should validate profit before execution", async function () {
      const amount = ethers.parseEther("1");
      const gasCost = ethers.parseEther("0.01");

      const isValid = await arbitrage.validateProfit.staticCall(amount, gasCost);
      expect(isValid).to.equal(false); // Should be false without actual arbitrage
    });
  });

  describe("Upgradeability", function () {
    it("Should allow owner to upgrade the contract", async function () {
      const FlashLoanArbitrageV2 = await ethers.getContractFactory("FlashLoanArbitrage");
      
      await expect(
        upgrades.upgradeProxy(await arbitrage.getAddress(), FlashLoanArbitrageV2)
      ).to.not.be.reverted;
    });

    it("Should prevent non-owner from upgrading", async function () {
      const FlashLoanArbitrageV2 = await ethers.getContractFactory("FlashLoanArbitrage");
      
      await expect(
        upgrades.upgradeProxy(await arbitrage.getAddress(), FlashLoanArbitrageV2, {
          call: { fn: "initialize", args: [AAVE_POOL, user.address, ethers.parseEther("1000")] }
        })
      ).to.be.reverted;
    });
  });

  describe("Gas Optimization", function () {
    it("Should use optimal gas for flash loan callback", async function () {
      const tx = await arbitrage.connect(owner).executeArbitrage(
        WETH,
        0,
        "0x",
        0
      );
      
      const receipt = await tx.wait();
      console.log("Gas used for executeArbitrage:", receipt?.gasUsed.toString());
      
      expect(receipt?.gasUsed).to.be.lt(500000); // Should be under 500k gas
    });
  });

  describe("Fuzz Testing", function () {
    it("Should handle various flash loan amounts", async function () {
      const amounts = [
        ethers.parseEther("0.1"),
        ethers.parseEther("1"),
        ethers.parseEther("10"),
        ethers.parseEther("100"),
      ];

      for (const amount of amounts) {
        const gasCost = ethers.parseEther("0.01");
        const profit = await arbitrage.calculateProfit.staticCall(amount, gasCost);
        expect(profit).to.be.gte(0);
      }
    });

    it("Should handle invalid addresses safely", async function () {
      await expect(
        arbitrage.connect(owner).emergencyWithdraw(ethers.ZeroAddress, ethers.parseEther("1"))
      ).to.be.reverted;
    });
  });
});