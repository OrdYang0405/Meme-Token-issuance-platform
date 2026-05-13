import { expect } from "chai";
import { ethers } from "hardhat";
import { MemeToken } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

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
  const BUY_TAX = 300; // 3%
  const SELL_TAX = 500; // 5%

  beforeEach(async function () {
    [owner, marketing, team, buyer, seller, pair] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory("MemeToken");
    token = await Factory.deploy(
      NAME,
      SYMBOL,
      TOTAL_SUPPLY,
      marketing.address,
      team.address,
      BUY_TAX,
      SELL_TAX
    );
    await token.waitForDeployment();
    await token.setUniswapPair(pair.address);
  });

  // ============ 部署测试 ============
  describe("Deployment", function () {
    it("should set correct token metadata", async function () {
      expect(await token.name()).to.equal(NAME);
      expect(await token.symbol()).to.equal(SYMBOL);
      expect(await token.decimals()).to.equal(18);
    });

    it("should mint total supply to owner", async function () {
      const balance = await token.balanceOf(owner.address);
      expect(ethers.formatEther(balance)).to.equal(TOTAL_SUPPLY.toFixed(1));
    });

    it("should set correct tax rates", async function () {
      expect(await token.buyTax()).to.equal(BUY_TAX);
      expect(await token.sellTax()).to.equal(SELL_TAX);
    });

    it("should set correct tax shares (with burn)", async function () {
      expect(await token.liquidityShare()).to.equal(2000);
      expect(await token.marketingShare()).to.equal(4000);
      expect(await token.teamShare()).to.equal(2000);
      expect(await token.burnShare()).to.equal(2000);
    });

    it("should start with swapAndLiquify enabled", async function () {
      expect(await token.swapAndLiquifyEnabled()).to.equal(true);
    });
  });

  // ============ 交易开关 ============
  describe("Trading control", function () {
    it("should reject transfers when trading is disabled (non-whitelisted)", async function () {
      await token.transfer(buyer.address, ethers.parseEther("100"));
      await expect(
        token.connect(buyer).transfer(seller.address, ethers.parseEther("10"))
      ).to.be.revertedWith("trading not enabled");
    });

    it("should allow whitelisted transfers when trading is disabled", async function () {
      await token.transfer(marketing.address, ethers.parseEther("100"));
      expect(await token.balanceOf(marketing.address)).to.equal(ethers.parseEther("100"));
    });

    it("should allow everyone to trade after enabling", async function () {
      await token.enableTrading();
      await token.transfer(buyer.address, ethers.parseEther("100"));
      expect(await token.balanceOf(buyer.address)).to.equal(ethers.parseEther("100"));
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

    it("should charge sell tax when selling to pair", async function () {
      const amount = ethers.parseEther("1000");
      const expectedTax = (amount * BigInt(SELL_TAX)) / 10000n;
      const expectedNet = amount - expectedTax;

      const pairBefore = await token.balanceOf(pair.address);
      await token.connect(seller).transfer(pair.address, amount);
      expect(await token.balanceOf(pair.address) - pairBefore).to.equal(expectedNet);
    });

    it("should emit TaxDistributed with 4 values (incl. burn)", async function () {
      const amount = ethers.parseEther("1000");
      const tax = (amount * BigInt(SELL_TAX)) / 10000n;
      const lp = (tax * 2000n) / 10000n;
      const mkt = (tax * 4000n) / 10000n;
      const tm = (tax * 2000n) / 10000n;
      const burn = tax - lp - mkt - tm;

      await expect(token.connect(seller).transfer(pair.address, amount))
        .to.emit(token, "TaxDistributed")
        .withArgs(mkt, lp, tm, burn);
    });

    it("should burn tax portion → decrease totalSupply", async function () {
      const supplyBefore = await token.totalSupply();
      const amount = ethers.parseEther("1000");
      const tax = (amount * BigInt(SELL_TAX)) / 10000n;
      const burnAmount = (tax * 2000n) / 10000n; // 20% burnShare

      await token.connect(seller).transfer(pair.address, amount);

      const supplyAfter = await token.totalSupply();
      expect(supplyBefore - supplyAfter).to.equal(burnAmount);
    });

    it("should accumulate liquidity share in contract", async function () {
      const amount = ethers.parseEther("1000");
      const tax = (amount * BigInt(SELL_TAX)) / 10000n;
      const liquidityAmount = (tax * 2000n) / 10000n;

      await token.connect(seller).transfer(pair.address, amount);
      expect(await token.accumulatedForLiquidity()).to.equal(liquidityAmount);
    });
  });

  // ============ 燃烧机制 ============
  describe("Burn mechanism", function () {
    beforeEach(async function () {
      await token.enableTrading();
      await token.transfer(seller.address, ethers.parseEther("10000"));
    });

    it("should decrease totalSupply after each taxed transaction", async function () {
      const before = await token.totalSupply();

      const amount = ethers.parseEther("1000");
      await token.connect(seller).transfer(pair.address, amount);

      const after = await token.totalSupply();
      expect(after).to.be.lt(before); // 比原来少 = 有燃烧
    });

    it("should allow adjusting burn share", async function () {
      // 改成 50% 燃烧
      await token.setTaxShares(1000, 3000, 1000, 5000);
      expect(await token.burnShare()).to.equal(5000);

      const supplyBefore = await token.totalSupply();
      const amount = ethers.parseEther("1000");
      const tax = (amount * BigInt(SELL_TAX)) / 10000n;
      const expectedBurn = (tax * 5000n) / 10000n;

      await token.connect(seller).transfer(pair.address, amount);
      expect(supplyBefore - await token.totalSupply()).to.equal(expectedBurn);
    });

    it("should reject invalid share combination", async function () {
      await expect(
        token.setTaxShares(5000, 5000, 5000, 5000)
      ).to.be.revertedWith("shares != 100%");
    });

    it("should allow zero burn", async function () {
      await token.setTaxShares(3000, 5000, 2000, 0);
      const supplyBefore = await token.totalSupply();

      const amount = ethers.parseEther("1000");
      await token.connect(seller).transfer(pair.address, amount);

      // totalSupply 不变（无燃烧）
      expect(await token.totalSupply()).to.equal(supplyBefore);
    });
  });

  // ============ SwapAndLiquify 控制 ============
  describe("SwapAndLiquify control", function () {
    beforeEach(async function () {
      await token.enableTrading();
      await token.transfer(seller.address, ethers.parseEther("50000"));
    });

    it("should accumulate liquidity tokens on each sell", async function () {
      const before = await token.accumulatedForLiquidity();

      const amount = ethers.parseEther("1000");
      await token.connect(seller).transfer(pair.address, amount);

      const after = await token.accumulatedForLiquidity();
      expect(after).to.be.gt(before);
    });

    it("should allow owner to update swap threshold", async function () {
      const newThreshold = ethers.parseEther("500");
      await token.setSwapThreshold(newThreshold);
      expect(await token.swapThreshold()).to.equal(newThreshold);
    });

    it("should allow owner to toggle swapAndLiquify", async function () {
      await token.setSwapAndLiquifyEnabled(false);
      expect(await token.swapAndLiquifyEnabled()).to.equal(false);

      await token.setSwapAndLiquifyEnabled(true);
      expect(await token.swapAndLiquifyEnabled()).to.equal(true);
    });

    it("should reject manual swap when below threshold", async function () {
      // accumulatedForLiquidity = 0 初始状态
      await expect(
        token.triggerManualSwap()
      ).to.be.revertedWith("below threshold");
    });

    it("should allow setting Uniswap router", async function () {
      await token.setUniswapRouter(pair.address); // 用 pair 地址模拟 router
      expect(await token.uniswapV2Router()).to.equal(pair.address);
      await expect(token.setUniswapRouter(pair.address))
        .to.emit(token, "UniswapRouterSet")
        .withArgs(pair.address);
    });
  });

  // ============ 交易限制 ============
  describe("Transaction limits", function () {
    beforeEach(async function () {
      await token.enableTrading();
      await token.transfer(buyer.address, ethers.parseEther("50000"));
    });

    it("should reject when non-excluded tx exceeds maxTransactionAmount", async function () {
      const maxTx = await token.maxTransactionAmount();
      await expect(
        token.connect(buyer).transfer(seller.address, maxTx + 1n)
      ).to.be.revertedWith("exceeds max transaction");
    });

    it("should reject when receiver exceeds maxWalletAmount", async function () {
      const maxWallet = await token.maxWalletAmount();
      await token.connect(buyer).transfer(seller.address, maxWallet);
      await expect(
        token.connect(buyer).transfer(seller.address, 1n)
      ).to.be.revertedWith("exceeds max wallet");
    });

    it("should allow disabling limits entirely", async function () {
      const maxTx = await token.maxTransactionAmount();
      await token.setLimits(maxTx, maxTx, false);
      await token.connect(buyer).transfer(seller.address, maxTx + 1n);
      expect(await token.balanceOf(seller.address)).to.equal(maxTx + 1n);
    });
  });

  // ============ 管理员功能 ============
  describe("Admin functions", function () {
    it("should allow owner to update tax shares with burn", async function () {
      await token.setTaxShares(1000, 5000, 3000, 1000);
      expect(await token.liquidityShare()).to.equal(1000);
      expect(await token.marketingShare()).to.equal(5000);
      expect(await token.teamShare()).to.equal(3000);
      expect(await token.burnShare()).to.equal(1000);
    });

    it("should reject tax exceeding MAX_TAX", async function () {
      await expect(token.setTax(2600, 100)).to.be.revertedWith("tax too high");
    });

    it("should emit TaxSharesUpdated event", async function () {
      await expect(token.setTaxShares(2500, 2500, 2500, 2500))
        .to.emit(token, "TaxSharesUpdated")
        .withArgs(2500, 2500, 2500, 2500);
    });
  });

  // ============ 集成测试：完整流程 ============
  describe("Full buy-sell flow", function () {
    beforeEach(async function () {
      await token.enableTrading();
      await token.transfer(seller.address, ethers.parseEther("10000"));
    });

    it("should handle sell→buy with burn and liquidity accumulation", async function () {
      const initialSupply = await token.totalSupply();

      // Step 1: 卖出
      const sellAmount = ethers.parseEther("1000");
      const sellTax = (sellAmount * BigInt(SELL_TAX)) / 10000n;
      const netToPair = sellAmount - sellTax;

      await token.connect(seller).transfer(pair.address, sellAmount);
      expect(await token.balanceOf(pair.address)).to.equal(netToPair);

      // Step 2: 买入
      const buyTax = (netToPair * BigInt(BUY_TAX)) / 10000n;
      const netToBuyer = netToPair - buyTax;

      await token.connect(pair).transfer(buyer.address, netToPair);
      expect(await token.balanceOf(buyer.address)).to.equal(netToBuyer);

      // Step 3: 验证燃烧
      const expectedBurn =
        (sellTax * 2000n) / 10000n + (buyTax * 2000n) / 10000n;
      expect(initialSupply - await token.totalSupply()).to.equal(expectedBurn);

      // Step 4: 验证 LP 累积
      const expectedLP =
        (sellTax * 2000n) / 10000n + (buyTax * 2000n) / 10000n;
      expect(await token.accumulatedForLiquidity()).to.equal(expectedLP);
    });
  });
});
