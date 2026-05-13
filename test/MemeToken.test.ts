import { expect } from "chai";
import { ethers } from "hardhat";
import { MemeToken } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("MemeToken", function () {
  let token: MemeToken;
  let owner: SignerWithAddress;
  let marketing: SignerWithAddress;
  let team: SignerWithAddress;
  let buyer: SignerWithAddress;
  let seller: SignerWithAddress;
  let pair: SignerWithAddress;

  const NAME = "Meme Token";
  const SYMBOL = "MEME";
  const TOTAL_SUPPLY = 1_000_000;
  const BUY_TAX = 300;
  const SELL_TAX = 500;

  beforeEach(async function () {
    [owner, marketing, team, buyer, seller, pair] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory("MemeToken");
    token = await Factory.deploy(
      NAME, SYMBOL, TOTAL_SUPPLY, marketing.address, team.address, BUY_TAX, SELL_TAX
    );
    await token.waitForDeployment();
    await token.setUniswapPair(pair.address);
  });

  // ============ 部署测试 ============
  describe("Deployment", function () {
    it("should set correct ownership", async function () {
      expect(await token.owner()).to.equal(owner.address);
    });

    it("should set correct tax rates and shares", async function () {
      expect(await token.buyTax()).to.equal(BUY_TAX);
      expect(await token.sellTax()).to.equal(SELL_TAX);
      expect(await token.burnShare()).to.equal(2000);
    });
  });

  // ============ 所有权管理（Ownable2Step）============
  describe("Ownership (Ownable2Step)", function () {
    it("should start two-step transfer", async function () {
      await token.transferOwnership(buyer.address);
      // pendingOwner 已设置，但 owner 仍为原 owner
      expect(await token.pendingOwner()).to.equal(buyer.address);
      expect(await token.owner()).to.equal(owner.address);
    });

    it("should complete ownership transfer after accept", async function () {
      await token.transferOwnership(buyer.address);

      // 新 owner 接受
      await token.connect(buyer).acceptOwnership();

      expect(await token.owner()).to.equal(buyer.address);
      expect(await token.pendingOwner()).to.equal(ethers.ZeroAddress);
    });

    it("should reject acceptOwnership from non-pending owner", async function () {
      await token.transferOwnership(buyer.address);
      // seller 不是 pendingOwner
      await expect(
        token.connect(seller).acceptOwnership()
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });

    it("should allow renouncing ownership", async function () {
      await token.renounceOwnership();
      expect(await token.owner()).to.equal(ethers.ZeroAddress);
    });

    it("should reject transferOwnership from non-owner", async function () {
      await expect(
        token.connect(buyer).transferOwnership(buyer.address)
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });
  });

  // ============ Pausable 暂停机制 ============
  describe("Pausable", function () {
    beforeEach(async function () {
      await token.enableTrading();
    });

    it("should allow owner to pause and unpause", async function () {
      await token.pause();
      expect(await token.paused()).to.equal(true);

      await token.unpause();
      expect(await token.paused()).to.equal(false);
    });

    it("should reject transfers when paused", async function () {
      await token.transfer(buyer.address, ethers.parseEther("1000"));
      await token.pause();

      await expect(
        token.connect(buyer).transfer(seller.address, ethers.parseEther("100"))
      ).to.be.revertedWith("token transfers paused");
    });

    it("should allow whitelisted transfers when paused", async function () {
      await token.setWhitelist(buyer.address, true);
      await token.transfer(buyer.address, ethers.parseEther("1000"));
      await token.pause();

      // 白名单地址仍可转账
      await token.connect(buyer).transfer(seller.address, ethers.parseEther("100"));
      expect(await token.balanceOf(seller.address)).to.equal(ethers.parseEther("100"));
    });

    it("should reject pause from non-owner", async function () {
      await expect(
        token.connect(buyer).pause()
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });
  });

  // ============ 参数更新频率锁 ============
  describe("Update cooldown", function () {
    it("should allow first tax update", async function () {
      await token.setTax(200, 400);
      expect(await token.buyTax()).to.equal(200);
    });

    it("should reject tax update within cooldown period", async function () {
      await token.setTax(200, 400);
      // 立即再次更新应被拒绝
      await expect(
        token.setTax(100, 200)
      ).to.be.revertedWith("tax cooldown active");
    });

    it("should allow tax update after cooldown expires", async function () {
      await token.setTax(200, 400);

      // 快进 1 天 + 1 秒
      await time.increase(1 * 24 * 60 * 60 + 1);

      await token.setTax(100, 200);
      expect(await token.buyTax()).to.equal(100);
      expect(await token.sellTax()).to.equal(200);
    });

    it("should reject share update within cooldown period", async function () {
      await token.setTaxShares(2500, 2500, 2500, 2500);
      await expect(
        token.setTaxShares(3000, 3000, 2000, 2000)
      ).to.be.revertedWith("share cooldown active");
    });

    it("should allow share update after cooldown expires", async function () {
      await token.setTaxShares(2500, 2500, 2500, 2500);

      await time.increase(1 * 24 * 60 * 60 + 1);

      await token.setTaxShares(3000, 3000, 2000, 2000);
      expect(await token.liquidityShare()).to.equal(3000);
    });

    it("should emit TaxUpdated event with correct timestamps", async function () {
      const tx = await token.setTax(100, 200);
      await expect(tx).to.emit(token, "TaxUpdated").withArgs(BUY_TAX, 100, SELL_TAX, 200);
    });
  });

  // ============ 税费机制 ============
  describe("Tax mechanism", function () {
    beforeEach(async function () {
      await token.enableTrading();
      await token.transfer(seller.address, ethers.parseEther("10000"));
      await token.transfer(pair.address, ethers.parseEther("2000"));
    });

    it("should charge buy tax when buying from pair", async function () {
      const amount = ethers.parseEther("1000");
      const expectedTax = (amount * BigInt(BUY_TAX)) / 10000n;
      const expectedNet = amount - expectedTax;

      await token.connect(pair).transfer(buyer.address, amount);
      expect(await token.balanceOf(buyer.address)).to.equal(expectedNet);
    });

    it("should charge sell tax and burn portion", async function () {
      const supplyBefore = await token.totalSupply();
      const amount = ethers.parseEther("1000");

      await token.connect(seller).transfer(pair.address, amount);

      // totalSupply 减少 = burn 部分
      expect(await token.totalSupply()).to.be.lt(supplyBefore);
    });
  });

  // ============ 交易限制 ============
  describe("Transaction limits", function () {
    beforeEach(async function () {
      await token.enableTrading();
      await token.transfer(buyer.address, ethers.parseEther("50000"));
    });

    it("should reject when exceeding maxTransactionAmount", async function () {
      const maxTx = await token.maxTransactionAmount();
      await expect(
        token.connect(buyer).transfer(seller.address, maxTx + 1n)
      ).to.be.revertedWith("exceeds max transaction");
    });

    it("should reject when exceeding maxWalletAmount", async function () {
      const maxWallet = await token.maxWalletAmount();
      await token.connect(buyer).transfer(seller.address, maxWallet);
      await expect(
        token.connect(buyer).transfer(seller.address, 1n)
      ).to.be.revertedWith("exceeds max wallet");
    });
  });

  // ============ 紧急资产回收 ============
  describe("Rescue functions", function () {
    it("should allow owner to rescue ETH", async function () {
      // 先向合约发送 ETH
      await owner.sendTransaction({
        to: await token.getAddress(),
        value: ethers.parseEther("1"),
      });

      const ownerBalanceBefore = await ethers.provider.getBalance(owner.address);

      const tx = await token.rescueETH();
      const receipt = await tx.wait();
      const gasCost = receipt!.fee;

      const ownerBalanceAfter = await ethers.provider.getBalance(owner.address);
      const ethRescued = ownerBalanceAfter - ownerBalanceBefore + gasCost;

      expect(ethRescued).to.equal(ethers.parseEther("1"));
    });

    it("should emit RescueETH event", async function () {
      await owner.sendTransaction({
        to: await token.getAddress(),
        value: ethers.parseEther("1"),
      });

      await expect(token.rescueETH())
        .to.emit(token, "RescueETH")
        .withArgs(owner.address, ethers.parseEther("1"));
    });

    it("should reject rescueETH from non-owner", async function () {
      await expect(
        token.connect(buyer).rescueETH()
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });

    it("should reject rescuing own token", async function () {
      await token.enableTrading();
      // 给合约转一些自己的代币
      await token.transfer(await token.getAddress(), ethers.parseEther("100"));

      await expect(
        token.rescueToken(await token.getAddress())
      ).to.be.revertedWith("cannot rescue self");
    });
  });

  // ============ SwapAndLiquify 控制 ============
  describe("SwapAndLiquify control", function () {
    beforeEach(async function () {
      await token.enableTrading();
      await token.transfer(seller.address, ethers.parseEther("50000"));
    });

    it("should accumulate liquidity on each sell", async function () {
      const before = await token.accumulatedForLiquidity();
      await token.connect(seller).transfer(pair.address, ethers.parseEther("1000"));
      expect(await token.accumulatedForLiquidity()).to.be.gt(before);
    });

    it("should allow owner to toggle swapAndLiquify", async function () {
      await token.setSwapAndLiquifyEnabled(false);
      expect(await token.swapAndLiquifyEnabled()).to.equal(false);
    });
  });

  // ============ 集成测试：完整安全流程 ============
  describe("Full security lifecycle", function () {
    it("pause → whitelist transfer → unpause → trade", async function () {
      await token.enableTrading();
      await token.transfer(buyer.address, ethers.parseEther("1000"));
      await token.transfer(pair.address, ethers.parseEther("5000"));

      // 1. 暂停
      await token.pause();
      expect(await token.paused()).to.equal(true);

      // 2. 普通用户无法转账
      await expect(
        token.connect(buyer).transfer(seller.address, ethers.parseEther("100"))
      ).to.be.revertedWith("token transfers paused");

      // 3. 白名单仍可操作
      await token.setWhitelist(buyer.address, true);
      await token.connect(buyer).transfer(seller.address, ethers.parseEther("100"));

      // 4. 取消暂停
      await token.unpause();

      // 5. 正常交易恢复
      await token.connect(seller).transfer(pair.address, ethers.parseEther("50"));
    });

    it("two-step ownership → revoke → secure", async function () {
      // 转移所有权
      await token.transferOwnership(buyer.address);
      await token.connect(buyer).acceptOwnership();

      // 旧 owner 不能再操作
      await expect(
        token.pause()
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");

      // 新 owner 可以
      await token.connect(buyer).pause();
      expect(await token.paused()).to.equal(true);
    });
  });
});
