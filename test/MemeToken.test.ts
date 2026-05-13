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

    // 设置 Uniswap Pair 地址（模拟）
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

    it("should set correct wallets", async function () {
      expect(await token.marketingWallet()).to.equal(marketing.address);
      expect(await token.teamWallet()).to.equal(team.address);
    });

    it("should set default limits (~2% of supply)", async function () {
      const supply = ethers.parseEther(String(TOTAL_SUPPLY));
      const twoPercent = supply / 50n;
      expect(await token.maxTransactionAmount()).to.equal(twoPercent);
      expect(await token.maxWalletAmount()).to.equal(twoPercent);
    });

    it("should start with trading disabled", async function () {
      expect(await token.tradingEnabled()).to.equal(false);
    });

    it("should exclude owner and contract from fees", async function () {
      expect(await token.isExcludedFromFee(owner.address)).to.equal(true);
      expect(await token.isExcludedFromFee(await token.getAddress())).to.equal(true);
    });

    it("should whitelist owner", async function () {
      expect(await token.isWhitelisted(owner.address)).to.equal(true);
    });
  });

  // ============ 交易开关 ============
  describe("Trading control", function () {
    it("should reject transfers when trading is disabled (non-whitelisted)", async function () {
      // owner 是白名单，先转给 buyer（非白名单地址）
      await token.transfer(buyer.address, ethers.parseEther("100"));
      // buyer（非白名单）尝试转给 seller，交易未开启应回滚
      await expect(
        token.connect(buyer).transfer(seller.address, ethers.parseEther("10"))
      ).to.be.revertedWith("trading not enabled");
    });

    it("should allow whitelisted transfers when trading is disabled", async function () {
      // owner is whitelisted
      await token.transfer(marketing.address, ethers.parseEther("100"));
      expect(await token.balanceOf(marketing.address)).to.equal(ethers.parseEther("100"));
    });

    it("should allow everyone to trade after enabling", async function () {
      await token.enableTrading();
      await token.transfer(buyer.address, ethers.parseEther("100"));
      expect(await token.balanceOf(buyer.address)).to.equal(ethers.parseEther("100"));
    });

    it("should emit TradingToggled event", async function () {
      await expect(token.enableTrading()).to.emit(token, "TradingToggled").withArgs(true);
    });

    it("should allow owner to disable trading", async function () {
      await token.enableTrading();
      await token.disableTrading();
      expect(await token.tradingEnabled()).to.equal(false);
    });
  });

  // ============ 税费机制 ============
  describe("Tax mechanism", function () {
    beforeEach(async function () {
      await token.enableTrading();
      // 给非豁免地址转代币，用于卖测试
      await token.transfer(seller.address, ethers.parseEther("10000"));
      // 给 pair 转代币，用于买测试（owner 免税费 → 全量到 pair）
      await token.transfer(pair.address, ethers.parseEther("2000"));
    });

    it("should charge no tax on non-pair transfers", async function () {
      // seller→buyer 不涉及 pair，不收税
      const sellerBefore = await token.balanceOf(seller.address);
      await token.connect(seller).transfer(buyer.address, ethers.parseEther("500"));
      const buyerAfter = await token.balanceOf(buyer.address);
      expect(buyerAfter).to.equal(ethers.parseEther("500"));
    });

    it("should charge buy tax when buying from pair", async function () {
      const amount = ethers.parseEther("1000");
      const expectedTax = (amount * BigInt(BUY_TAX)) / 10000n;
      const expectedNet = amount - expectedTax;

      // pair→buyer = 买入
      await token.connect(pair).transfer(buyer.address, amount);

      expect(await token.balanceOf(buyer.address)).to.equal(expectedNet);
    });

    it("should charge sell tax when selling to pair", async function () {
      const amount = ethers.parseEther("1000");
      const expectedTax = (amount * BigInt(SELL_TAX)) / 10000n;
      const expectedNet = amount - expectedTax;

      await token.connect(seller).transfer(pair.address, amount);

      // pair 收到净额（税后）
      expect(await token.balanceOf(pair.address)).to.equal(
        ethers.parseEther("2000") + expectedNet
      );
    });

    it("should distribute tax to marketing and team wallets", async function () {
      const amount = ethers.parseEther("1000");
      const taxAmount = (amount * BigInt(SELL_TAX)) / 10000n;
      const marketingAmount = (taxAmount * 5000n) / 10000n; // 50%
      const teamAmount = (taxAmount * 2000n) / 10000n; // 20%

      const beforeMarketing = await token.balanceOf(marketing.address);
      const beforeTeam = await token.balanceOf(team.address);

      await token.connect(seller).transfer(pair.address, amount);

      expect(await token.balanceOf(marketing.address) - beforeMarketing).to.equal(
        marketingAmount
      );
      expect(await token.balanceOf(team.address) - beforeTeam).to.equal(teamAmount);
    });

    it("should accumulate liquidity share in contract", async function () {
      const amount = ethers.parseEther("1000");
      const taxAmount = (amount * BigInt(SELL_TAX)) / 10000n;
      const liquidityAmount = (taxAmount * 3000n) / 10000n; // 30%

      await token.connect(seller).transfer(pair.address, amount);

      expect(await token.accumulatedForLiquidity()).to.equal(liquidityAmount);
    });

    it("should not charge tax from excluded addresses", async function () {
      await token.setExcludedFromFee(seller.address, true);
      const amount = ethers.parseEther("500");

      const pairBefore = await token.balanceOf(pair.address);
      await token.connect(seller).transfer(pair.address, amount);

      // pair 收到全量（无税）
      expect(await token.balanceOf(pair.address) - pairBefore).to.equal(amount);
    });

    it("should emit TaxCharged event on sell", async function () {
      const amount = ethers.parseEther("1000");
      const expectedTax = (amount * BigInt(SELL_TAX)) / 10000n;

      await expect(token.connect(seller).transfer(pair.address, amount))
        .to.emit(token, "TaxCharged")
        .withArgs(seller.address, pair.address, expectedTax, true);
    });
  });

  // ============ 交易限制 ============
  describe("Transaction limits", function () {
    beforeEach(async function () {
      await token.enableTrading();
      // 给 buyer（非豁免地址）转代币，用于测试限制
      await token.transfer(buyer.address, ethers.parseEther("50000"));
    });

    it("should reject when non-excluded tx exceeds maxTransactionAmount", async function () {
      const maxTx = await token.maxTransactionAmount();
      await expect(
        token.connect(buyer).transfer(seller.address, maxTx + 1n)
      ).to.be.revertedWith("exceeds max transaction");
    });

    it("should allow transfers exactly at maxTransactionAmount", async function () {
      const maxTx = await token.maxTransactionAmount();
      await token.connect(buyer).transfer(seller.address, maxTx);
      expect(await token.balanceOf(seller.address)).to.equal(maxTx);
    });

    it("should reject when receiver exceeds maxWalletAmount", async function () {
      const maxWallet = await token.maxWalletAmount();
      // 先转满
      await token.connect(buyer).transfer(seller.address, maxWallet);
      // 再转 1 应失败
      await expect(
        token.connect(buyer).transfer(seller.address, 1n)
      ).to.be.revertedWith("exceeds max wallet");
    });

    it("should allow excluded addresses to bypass limits", async function () {
      await token.setExcludedFromLimits(buyer.address, true);
      const maxTx = await token.maxTransactionAmount();
      await token.connect(buyer).transfer(seller.address, maxTx + 1n);
      expect(await token.balanceOf(seller.address)).to.equal(maxTx + 1n);
    });

    it("should allow disabling limits entirely", async function () {
      const maxTx = await token.maxTransactionAmount();
      await token.setLimits(maxTx, maxTx, false); // 关闭限制
      await token.connect(buyer).transfer(seller.address, maxTx + 1n);
      expect(await token.balanceOf(seller.address)).to.equal(maxTx + 1n);
    });
  });

  // ============ 管理员功能 ============
  describe("Admin functions", function () {
    it("should allow owner to update tax rates", async function () {
      await token.setTax(200, 400);
      expect(await token.buyTax()).to.equal(200);
      expect(await token.sellTax()).to.equal(400);
      await expect(token.setTax(200, 400))
        .to.emit(token, "TaxUpdated")
        .withArgs(200, 200, 400, 400);
    });

    it("should reject tax exceeding MAX_TAX", async function () {
      await expect(token.setTax(2600, 100)).to.be.revertedWith("tax too high");
      await expect(token.setTax(100, 2600)).to.be.revertedWith("tax too high");
    });

    it("should reject tax update from non-owner", async function () {
      await expect(
        token.connect(buyer).setTax(100, 100)
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });

    it("should allow owner to update wallets", async function () {
      await token.setWallets(buyer.address, seller.address);
      expect(await token.marketingWallet()).to.equal(buyer.address);
      expect(await token.teamWallet()).to.equal(seller.address);
    });

    it("should allow owner to update tax shares", async function () {
      // 40% LP, 40% marketing, 20% team
      await token.setTaxShares(4000, 4000, 2000);
      expect(await token.liquidityShare()).to.equal(4000);
      expect(await token.marketingShare()).to.equal(4000);
      expect(await token.teamShare()).to.equal(2000);
    });

    it("should reject invalid tax shares", async function () {
      await expect(token.setTaxShares(5000, 5000, 5000)).to.be.revertedWith("shares != 100%");
    });
  });

  // ============ 白名单 ============
  describe("Whitelist", function () {
    it("should allow adding and removing addresses", async function () {
      await token.setWhitelist(buyer.address, true);
      expect(await token.isWhitelisted(buyer.address)).to.equal(true);

      await token.setWhitelist(buyer.address, false);
      expect(await token.isWhitelisted(buyer.address)).to.equal(false);
    });

    it("should allow whitelisted address to trade before trading enabled", async function () {
      await token.setWhitelist(buyer.address, true);
      // 先用 owner 转给 buyer（owner 也是白名单）
      await token.transfer(buyer.address, ethers.parseEther("100"));
      // buyer（白名单）再转给其他人
      await token.connect(buyer).transfer(seller.address, ethers.parseEther("50"));
      expect(await token.balanceOf(seller.address)).to.equal(ethers.parseEther("50"));
    });
  });

  // ============ 集成测试：完整买卖流程 ============
  describe("Full buy-sell flow", function () {
    beforeEach(async function () {
      await token.enableTrading();
      await token.transfer(seller.address, ethers.parseEther("10000"));
    });

    it("should handle complete sell→buy cycle with correct tax", async function () {
      // ------ 第1步：卖方卖出 ------
      const sellAmount = ethers.parseEther("1000");
      const sellTax = (sellAmount * BigInt(SELL_TAX)) / 10000n;
      const netToPair = sellAmount - sellTax;

      const pairBefore = await token.balanceOf(pair.address);
      await token.connect(seller).transfer(pair.address, sellAmount);
      expect(await token.balanceOf(pair.address) - pairBefore).to.equal(netToPair);

      // ------ 第2步：买方买入 ------
      const buyTax = (netToPair * BigInt(BUY_TAX)) / 10000n;
      const netToBuyer = netToPair - buyTax;

      await token.connect(pair).transfer(buyer.address, netToPair);
      expect(await token.balanceOf(buyer.address)).to.equal(netToBuyer);

      // ------ 验证税费已正确分配 ------
      // 两笔交易都产生税费（卖 + 买）
      // 卖出税分配：50% marketing, 20% team, 30% LP
      const sellMarketing = (sellTax * 5000n) / 10000n;
      const sellTeam = (sellTax * 2000n) / 10000n;
      const sellLiquidity = sellTax - sellMarketing - sellTeam;
      // 买入税分配（同样比例）
      const buyMarketing = (buyTax * 5000n) / 10000n;
      const buyTeam = (buyTax * 2000n) / 10000n;
      const buyLiquidity = buyTax - buyMarketing - buyTeam;

      expect(await token.balanceOf(marketing.address)).to.equal(sellMarketing + buyMarketing);
      expect(await token.balanceOf(team.address)).to.equal(sellTeam + buyTeam);
      expect(await token.accumulatedForLiquidity()).to.equal(sellLiquidity + buyLiquidity);
    });
  });
});
