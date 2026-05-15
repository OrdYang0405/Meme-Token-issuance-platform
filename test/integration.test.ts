// test/integration.test.ts
// 第16课：完整流程端到端集成测试
// 覆盖 4 大场景：代币创建全流程、FairLaunch 完整生命周期、税费+S&L 集成、紧急操作
//
// 运行: npx hardhat test test/integration.test.ts

import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { MerkleTree } from "merkletreejs";
import keccak256 from "keccak256";
import {
  deployMemeToken,
  deployMemeFactory,
  deployMemeFairLaunch,
  MemeTokenFixture,
  MemeFactoryFixture,
  MemeFairLaunchFixture,
  FACTORY_DEFAULTS,
} from "./helpers/fixtures";
import { buildMerkleTree } from "./helpers/utils";

describe("Integration — 端到端集成测试", function () {

  // ════════════════════════════════════════════════════════════════
  // 场景 1：代币创建 → Uniswap 初始化 → 安全锁定
  // ════════════════════════════════════════════════════════════════

  describe("场景 1：代币创建全流程", function () {
    it("Factory 创建 Token → 接受所有权 → 设置 Router → 创建 Pair → 启用交易 → 锁定 Router", async function () {
      const [owner, creator, marketing, team, pair] = await ethers.getSigners();

      // 1. 部署 Factory
      const Factory = await ethers.getContractFactory("MemeFactory");
      const factory = await Factory.deploy(FACTORY_DEFAULTS.creationFee);
      await factory.waitForDeployment();

      // 2. 通过 Factory 创建 MemeToken
      const tx = await factory.connect(creator).createToken(
        { name: "Integration Meme", symbol: "IMEME", totalSupply: 2_000_000,
          marketingWallet: marketing.address, teamWallet: team.address,
          buyTax: 400, sellTax: 600 },
        { value: FACTORY_DEFAULTS.creationFee }
      );
      const receipt = await tx.wait();
      const event = receipt!.logs.find(
        (log: any) => (log as any).fragment?.name === "TokenCreated"
      );
      const tokenAddr = (event as any)?.args?.[0];
      expect(ethers.isAddress(tokenAddr)).to.be.true;

      const token = await ethers.getContractAt("MemeToken", tokenAddr);

      // 3. 验证初始状态：owner = Factory
      expect(await token.owner()).to.equal(await factory.getAddress());
      expect(await token.pendingOwner()).to.equal(creator.address);

      // 4. 创建者接受所有权
      await token.connect(creator).acceptOwnership();
      expect(await token.owner()).to.equal(creator.address);
      expect(await token.pendingOwner()).to.equal(ethers.ZeroAddress);

      // 5. Factory 追踪正确
      expect(await factory.totalTokens()).to.equal(1);
      expect(await factory.getTokenCountByCreator(creator.address)).to.equal(1);

      // 6. 设置 Uniswap Router（模拟地址）
      const mockRouter = owner.address;
      await token.connect(creator).setUniswapRouter(mockRouter);
      expect(await token.uniswapV2Router()).to.equal(mockRouter);

      // 7. 设置 Pair
      await token.connect(creator).setUniswapPair(pair.address);
      expect(await token.uniswapV2Pair()).to.equal(pair.address);
      expect(await token.isExcludedFromLimits(pair.address)).to.equal(true);

      // 8. 启用交易
      await token.connect(creator).enableTrading();
      expect(await token.tradingEnabled()).to.equal(true);

      // 9. 锁定 Router（安全修复 P0-1）
      await token.connect(creator).lockRouter();
      expect(await token.routerLocked()).to.equal(true);

      // 10. 锁定后无法修改 Router
      await expect(
        token.connect(creator).setUniswapRouter(team.address)
      ).to.be.revertedWith("router locked");

      // 11. 验证代币元数据
      expect(await token.name()).to.equal("Integration Meme");
      expect(await token.symbol()).to.equal("IMEME");
      expect(await token.buyTax()).to.equal(400);
      expect(await token.sellTax()).to.equal(600);
      expect(await token.marketingWallet()).to.equal(marketing.address);
      expect(await token.teamWallet()).to.equal(team.address);

      // 12. 总供应量已 mint（mint 给 Factory，因 Factory 是 deployer）
      const expectedSupply = BigInt(2_000_000) * 10n ** 18n;
      expect(await token.totalSupply()).to.equal(expectedSupply);
      expect(await token.balanceOf(await factory.getAddress())).to.equal(expectedSupply);
    });

    it("创建多个代币并验证各自独立", async function () {
      const [owner, creator1, creator2, marketing, team] = await ethers.getSigners();

      const Factory = await ethers.getContractFactory("MemeFactory");
      const factory = await Factory.deploy(FACTORY_DEFAULTS.creationFee);
      await factory.waitForDeployment();

      // creator1 创建代币 A
      await factory.connect(creator1).createToken(
        { name: "Token A", symbol: "TKNA", totalSupply: 500_000,
          marketingWallet: marketing.address, teamWallet: team.address,
          buyTax: 200, sellTax: 300 },
        { value: FACTORY_DEFAULTS.creationFee }
      );
      // creator2 创建代币 B
      await factory.connect(creator2).createToken(
        { name: "Token B", symbol: "TKNB", totalSupply: 1_000_000,
          marketingWallet: marketing.address, teamWallet: team.address,
          buyTax: 500, sellTax: 800 },
        { value: FACTORY_DEFAULTS.creationFee }
      );

      expect(await factory.totalTokens()).to.equal(2);
      expect(await factory.getTokenCountByCreator(creator1.address)).to.equal(1);
      expect(await factory.getTokenCountByCreator(creator2.address)).to.equal(1);

      // 验证各自名称独立
      const addrA = await factory.creatorTokens(creator1.address, 0);
      const addrB = await factory.creatorTokens(creator2.address, 0);
      const tokenA = await ethers.getContractAt("MemeToken", addrA);
      const tokenB = await ethers.getContractAt("MemeToken", addrB);
      expect(await tokenA.name()).to.equal("Token A");
      expect(await tokenB.name()).to.equal("Token B");
      expect(await tokenA.symbol()).to.equal("TKNA");
      expect(await tokenB.symbol()).to.equal("TKNB");
      // 各自独立，地址不同
      expect(addrA).to.not.equal(addrB);
    });
  });

  // ════════════════════════════════════════════════════════════════
  // 场景 2：FairLaunch 公平发射完整生命周期
  // ════════════════════════════════════════════════════════════════

  describe("场景 2：FairLaunch 完整生命周期", function () {
    const TOKENS_PER_ETH = 10000n;
    const TOKENS_FOR_SALE = ethers.parseEther("400000");
    const SOFT_CAP = ethers.parseEther("10");
    const HARD_CAP = ethers.parseEther("40");
    const MAX_PER_WALLET = ethers.parseEther("15");
    const WHITELIST_DURATION = 3600;
    const PUBLIC_DURATION = 7200;

    let launch: any;
    let token: any;
    let owner: SignerWithAddress;
    let marketing: SignerWithAddress;
    let team: SignerWithAddress;
    let lpReceiver: SignerWithAddress;
    let buyer1: SignerWithAddress;
    let buyer2: SignerWithAddress;
    let buyer3: SignerWithAddress;
    let buyer4: SignerWithAddress;
    let buyer5: SignerWithAddress;
    let nonWhitelisted: SignerWithAddress;
    let merkleTree: MerkleTree;
    let merkleRoot: string;

    beforeEach(async function () {
      [owner, marketing, team, lpReceiver,
        buyer1, buyer2, buyer3, buyer4, buyer5, nonWhitelisted
      ] = await ethers.getSigners();

      // 1. 部署 MemeToken
      const TokenFactory = await ethers.getContractFactory("MemeToken");
      token = await TokenFactory.deploy(
        "FairLaunch Integrated", "FLI", 1_000_000,
        marketing.address, team.address, 300, 500
      );
      await token.waitForDeployment();

      // 2. 构建 MerkleTree（白名单：buyer1-5）
      const whitelist = [
        buyer1.address, buyer2.address, buyer3.address,
        buyer4.address, buyer5.address
      ];
      const { merkleTree: mt, merkleRoot: root, getProof } = buildMerkleTree(whitelist);
      merkleTree = mt;
      merkleRoot = root;

      // 3. 部署 FairLaunch
      const LaunchFactory = await ethers.getContractFactory("MemeFairLaunch");
      launch = await LaunchFactory.deploy(
        await token.getAddress(),
        TOKENS_PER_ETH, TOKENS_FOR_SALE, SOFT_CAP, HARD_CAP,
        MAX_PER_WALLET, WHITELIST_DURATION, PUBLIC_DURATION,
        merkleRoot, ethers.ZeroAddress,
        ethers.parseEther("15"), lpReceiver.address
      );
      await launch.waitForDeployment();

      // 4. 转移代币到 FairLaunch
      await token.enableTrading();
      await token.setExcludedFromLimits(await launch.getAddress(), true);
      await token.transfer(await launch.getAddress(), TOKENS_FOR_SALE);
    });

    it("白名单购买 → 公开购买至硬顶 → 领取代币 → Owner 提取", async function () {
      // ── 白名单阶段 ──
      const proof1 = merkleTree.getHexProof(
        keccak256(Buffer.from(buyer1.address.slice(2), "hex"))
      );
      const proof2 = merkleTree.getHexProof(
        keccak256(Buffer.from(buyer2.address.slice(2), "hex"))
      );

      const wlAmount = ethers.parseEther("10");
      await launch.connect(buyer1).buyWhitelist(wlAmount, proof1, { value: wlAmount });
      await launch.connect(buyer2).buyWhitelist(MAX_PER_WALLET, proof2, { value: MAX_PER_WALLET });

      // 验证白名单已使用标记
      expect(await launch.whitelistClaimed(buyer1.address)).to.equal(true);
      expect(await launch.whitelistClaimed(buyer2.address)).to.equal(true);
      // 代币尚未发放
      expect(await token.balanceOf(buyer1.address)).to.equal(0);
      expect(await launch.tokensOwed(buyer1.address)).to.equal(wlAmount * TOKENS_PER_ETH);

      // 已筹集 25 ETH
      expect(await launch.totalRaised()).to.equal(wlAmount + MAX_PER_WALLET);

      // ── 进入公开阶段 ──
      await time.increase(WHITELIST_DURATION + 1);
      // 首次 buyPublic 自动将 phase 从 Whitelist 切到 Public
      const remaining = HARD_CAP - wlAmount - MAX_PER_WALLET; // 40 - 10 - 15 = 15
      await launch.connect(nonWhitelisted).buyPublic({ value: remaining });

      // 验证硬顶达成 → 自动结束
      expect(await launch.totalRaised()).to.equal(HARD_CAP);
      expect(await launch.launchSucceeded()).to.equal(true);

      // ── 所有参与者领取代币 ──
      await launch.connect(buyer1).claimTokens();
      await launch.connect(buyer2).claimTokens();
      await launch.connect(nonWhitelisted).claimTokens();

      expect(await token.balanceOf(buyer1.address)).to.equal(wlAmount * TOKENS_PER_ETH);
      expect(await token.balanceOf(buyer2.address)).to.equal(MAX_PER_WALLET * TOKENS_PER_ETH);
      expect(await token.balanceOf(nonWhitelisted.address)).to.equal(remaining * TOKENS_PER_ETH);

      // ── Owner 提取未售出代币 ──
      const launchTokenBalance = await token.balanceOf(await launch.getAddress());
      if (launchTokenBalance > 0) {
        await launch.connect(owner).withdrawUnsoldTokens();
        expect(await token.balanceOf(await launch.getAddress())).to.equal(0);
      }

      // ── Owner 提取募集 ETH ──
      const ethBefore = await ethers.provider.getBalance(owner.address);
      const tx = await launch.connect(owner).withdrawRaisedETH();
      const receipt = await tx.wait();
      const ethAfter = await ethers.provider.getBalance(owner.address);
      const netGain = ethAfter - ethBefore + receipt!.fee;
      expect(netGain).to.equal(HARD_CAP);
    });

    it("未达软顶 → 退款 → 验证 ETH 退回", async function () {
      const proof1 = merkleTree.getHexProof(
        keccak256(Buffer.from(buyer1.address.slice(2), "hex"))
      );
      const ethAmount = ethers.parseEther("3");
      await launch.connect(buyer1).buyWhitelist(ethAmount, proof1, { value: ethAmount });

      // 时间到期，未达软顶（10 ETH）
      await time.increase(WHITELIST_DURATION + PUBLIC_DURATION + 1);
      await launch.finalize();

      expect(await launch.launchSucceeded()).to.equal(false);
      expect(await launch.refundEnabled()).to.equal(true);

      // 退款
      const before = await ethers.provider.getBalance(buyer1.address);
      const tx = await launch.connect(buyer1).claimRefund();
      const receipt = await tx.wait();
      const after = await ethers.provider.getBalance(buyer1.address);
      expect(after - before + receipt!.fee).to.equal(ethAmount);
      expect(await launch.tokensOwed(buyer1.address)).to.equal(0);
    });

    it("超过单钱包上限被拒绝", async function () {
      const proof = merkleTree.getHexProof(
        keccak256(Buffer.from(buyer1.address.slice(2), "hex"))
      );
      await launch.connect(buyer1).buyWhitelist(MAX_PER_WALLET, proof, { value: MAX_PER_WALLET });

      await time.increase(WHITELIST_DURATION + 1);
      await expect(
        launch.connect(buyer1).buyPublic({ value: 1n })
      ).to.be.revertedWith("exceeds wallet cap");
    });

    it("白名单用户无法重复购买", async function () {
      const proof = merkleTree.getHexProof(
        keccak256(Buffer.from(buyer1.address.slice(2), "hex"))
      );
      await launch.connect(buyer1).buyWhitelist(ethers.parseEther("1"), proof, {
        value: ethers.parseEther("1"),
      });
      await expect(
        launch.connect(buyer1).buyWhitelist(ethers.parseEther("1"), proof, {
          value: ethers.parseEther("1"),
        })
      ).to.be.revertedWith("already claimed");
    });
  });

  // ════════════════════════════════════════════════════════════════
  // 场景 3：交易税费 + SwapAndLiquify 集成
  // ════════════════════════════════════════════════════════════════

  describe("场景 3：税费 + SwapAndLiquify 集成", function () {
    let token: any;
    let owner: SignerWithAddress;
    let marketing: SignerWithAddress;
    let team: SignerWithAddress;
    let buyer: SignerWithAddress;
    let seller: SignerWithAddress;
    let pair: SignerWithAddress;

    const BUY_TAX = 300;  // 3%
    const SELL_TAX = 500; // 5%

    beforeEach(async function () {
      [owner, marketing, team, buyer, seller, pair] = await ethers.getSigners();

      const Factory = await ethers.getContractFactory("MemeToken");
      token = await Factory.deploy(
        "Tax Integration", "TAXI", 1_000_000,
        marketing.address, team.address,
        BUY_TAX, SELL_TAX
      );
      await token.waitForDeployment();

      // 初始化交易环境
      await token.setUniswapRouter(owner.address);
      await token.setUniswapPair(pair.address);
      await token.enableTrading();

      // 分配代币给 seller 和 pair（模拟流动性）
      await token.transfer(seller.address, ethers.parseEther("50000"));
      await token.transfer(pair.address, ethers.parseEther("20000"));
    });

    it("买入扣税 → 卖出扣税 + 累积流动性 → 税费分配正确", async function () {
      // ── 买入：从 pair 购买代币 ──
      const buyAmount = ethers.parseEther("1000");
      const buyTaxAmount = (buyAmount * BigInt(BUY_TAX)) / 10000n;
      const buyNet = buyAmount - buyTaxAmount;

      await token.connect(pair).transfer(buyer.address, buyAmount);
      expect(await token.balanceOf(buyer.address)).to.equal(buyNet);

      // 验证买入税的分配：
      // liquidityShare=2000 → 20% 给流动性
      const accAfterBuy = await token.accumulatedForLiquidity();
      expect(accAfterBuy).to.be.gt(0);

      // ── 卖出：seller 向 pair 卖代币 ──
      const sellAmount = ethers.parseEther("500");
      const beforeSellAccumulated = await token.accumulatedForLiquidity();
      const supplyBefore = await token.totalSupply();

      await token.connect(seller).transfer(pair.address, sellAmount);

      // totalSupply 减少 = burn 部分（burnShare=2000 → 20%）
      const supplyAfter = await token.totalSupply();
      expect(supplyAfter).to.be.lt(supplyBefore);

      // accumulatedForLiquidity 增加（liquidityShare 部分）
      const afterSellAccumulated = await token.accumulatedForLiquidity();
      expect(afterSellAccumulated).to.be.gt(beforeSellAccumulated);

      // 验证营销钱包收到买入税中的 marketingShare 部分
      const mktBalance = await token.balanceOf(marketing.address);
      expect(mktBalance).to.be.gt(0);

      // 验证团队钱包收到部分
      const teamBalance = await token.balanceOf(team.address);
      expect(teamBalance).to.be.gt(0);
    });

    it("关闭 S&L 后累积仍增长但不自动 swap", async function () {
      // S&L 开关只控制是否触发自动 swap，不影响税费累积
      await token.setSwapAndLiquifyEnabled(false);
      expect(await token.swapAndLiquifyEnabled()).to.equal(false);

      const before = await token.accumulatedForLiquidity();
      await token.connect(seller).transfer(pair.address, ethers.parseEther("1000"));
      const after = await token.accumulatedForLiquidity();
      // 累积量仍增长（税费照常收取，只是不自动 swap）
      expect(after).to.be.gt(before);
    });

    it("excludedFromFee 地址不收税费", async function () {
      // 将 seller 排除税费
      await token.setExcludedFromFee(seller.address, true);
      expect(await token.isExcludedFromFee(seller.address)).to.equal(true);

      const supplyBefore = await token.totalSupply();
      const sellAmount = ethers.parseEther("1000");
      const balanceBefore = await token.balanceOf(pair.address);

      await token.connect(seller).transfer(pair.address, sellAmount);

      // 无销毁 → totalSupply 不变
      expect(await token.totalSupply()).to.equal(supplyBefore);
      // pair 收到全额
      expect(await token.balanceOf(pair.address)).to.equal(balanceBefore + sellAmount);
    });

    it("税费分配总计为 100%（含销毁）", async function () {
      // 验证 shares 总计 = 10000 bps
      const liq = await token.liquidityShare();   // 2000
      const mkt = await token.marketingShare();    // 4000
      const tm = await token.teamShare();           // 2000
      const burn = await token.burnShare();         // 2000
      expect(liq + mkt + tm + burn).to.equal(10000n);
    });

    it("多次卖出累积流动性持续增长", async function () {
      // 关闭 S&L 防止自动触发 swap（因为 router 是 mock 地址会 revert）
      await token.setSwapAndLiquifyEnabled(false);

      let lastAccumulated = await token.accumulatedForLiquidity();
      for (let i = 0; i < 5; i++) {
        await token.connect(seller).transfer(pair.address, ethers.parseEther("1000"));
        const current = await token.accumulatedForLiquidity();
        // 每次卖出累积量都增长（S&L 关闭只影响自动 swap，不影响税费累积）
        expect(current).to.be.gt(lastAccumulated);
        lastAccumulated = current;
      }
    });
  });

  // ════════════════════════════════════════════════════════════════
  // 场景 4：暂停 + 救援 + 所有权转移
  // ════════════════════════════════════════════════════════════════

  describe("场景 4：紧急操作与所有权管理", function () {
    let token: any;
    let owner: SignerWithAddress;
    let marketing: SignerWithAddress;
    let team: SignerWithAddress;
    let buyer: SignerWithAddress;
    let seller: SignerWithAddress;
    let pair: SignerWithAddress;

    beforeEach(async function () {
      [owner, marketing, team, buyer, seller, pair] = await ethers.getSigners();

      const Factory = await ethers.getContractFactory("MemeToken");
      token = await Factory.deploy(
        "Emergency Token", "EMERG", 1_000_000,
        marketing.address, team.address, 300, 500
      );
      await token.waitForDeployment();

      await token.setUniswapPair(pair.address);
      await token.enableTrading();
      await token.transfer(buyer.address, ethers.parseEther("10000"));
    });

    it("暂停 → 白名单豁免 → 救援 ETH → 转移所有权 → 恢复交易", async function () {
      // 1. 暂停交易
      await token.pause();
      expect(await token.paused()).to.equal(true);

      // 2. 普通用户无法转账
      await expect(
        token.connect(buyer).transfer(seller.address, ethers.parseEther("100"))
      ).to.be.revertedWith("token transfers paused");

      // 3. 设置白名单 → 白名单用户可转账
      await token.setWhitelist(buyer.address, true);
      await token.connect(buyer).transfer(seller.address, ethers.parseEther("100"));
      expect(await token.balanceOf(seller.address)).to.equal(ethers.parseEther("100"));

      // 4. 向合约发送 ETH（模拟意外转入）
      await owner.sendTransaction({
        to: await token.getAddress(),
        value: ethers.parseEther("5"),
      });
      expect(await ethers.provider.getBalance(await token.getAddress())).to.equal(
        ethers.parseEther("5")
      );

      // 5. rescueETH 提取
      const ethBefore = await ethers.provider.getBalance(owner.address);
      const rescueTx = await token.rescueETH();
      const rescueReceipt = await rescueTx.wait();
      const ethAfter = await ethers.provider.getBalance(owner.address);
      const rescued = ethAfter - ethBefore + rescueReceipt!.fee;
      expect(rescued).to.equal(ethers.parseEther("5"));
      expect(await ethers.provider.getBalance(await token.getAddress())).to.equal(0);

      // 6. 两步转移所有权
      await token.transferOwnership(buyer.address);
      expect(await token.pendingOwner()).to.equal(buyer.address);
      expect(await token.owner()).to.equal(owner.address); // 所有权尚未转移

      await token.connect(buyer).acceptOwnership();
      expect(await token.owner()).to.equal(buyer.address);
      expect(await token.pendingOwner()).to.equal(ethers.ZeroAddress);

      // 7. 旧 owner 无法操作
      await expect(
        token.connect(owner).unpause()
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");

      // 8. 新 owner 恢复交易
      await token.connect(buyer).unpause();
      expect(await token.paused()).to.equal(false);

      // 9. 恢复正常交易
      await token.connect(buyer).transfer(seller.address, ethers.parseEther("50"));
      expect(await token.balanceOf(seller.address)).to.equal(ethers.parseEther("150"));
    });

    it("接受所有权前可以取消转移", async function () {
      await token.transferOwnership(buyer.address);
      expect(await token.pendingOwner()).to.equal(buyer.address);

      // owner 取消转移
      await token.transferOwnership(ethers.ZeroAddress);
      expect(await token.pendingOwner()).to.equal(ethers.ZeroAddress);

      // buyer 无法接受
      await expect(
        token.connect(buyer).acceptOwnership()
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });

    it("非 owner 无法执行紧急操作", async function () {
      await expect(
        token.connect(buyer).pause()
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");

      await expect(
        token.connect(buyer).rescueETH()
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });

    it("无 ETH 时 rescueETH 也正常完成", async function () {
      // 合约余额为 0
      await expect(token.rescueETH())
        .to.emit(token, "RescueETH")
        .withArgs(owner.address, 0);
    });
  });

  // ════════════════════════════════════════════════════════════════
  // 全场景串联：从零到完整交付
  // ════════════════════════════════════════════════════════════════

  describe("全场景串联：Factory → Token → FairLaunch → 税费 → 安全", function () {
    it("完整生命周期：创建 → 公平发射 → 交易 → 锁定 → 紧急操作", async function () {
      const [owner, creator, marketing, team, lpReceiver,
        buyer1, buyer2, buyer3] = await ethers.getSigners();

      // ═══ 第 1 步：部署 Factory ═══
      const Factory = await ethers.getContractFactory("MemeFactory");
      const factory = await Factory.deploy(ethers.parseEther("0.01"));
      await factory.waitForDeployment();

      // ═══ 第 2 步：通过 Factory 创建代币 ═══
      const createTx = await factory.connect(creator).createToken(
        { name: "Full Lifecycle", symbol: "FULL", totalSupply: 2_000_000,
          marketingWallet: marketing.address, teamWallet: team.address,
          buyTax: 300, sellTax: 500 },
        { value: ethers.parseEther("0.01") }
      );
      const createReceipt = await createTx.wait();
      const tokenAddr = (createReceipt!.logs.find(
        (log: any) => (log as any).fragment?.name === "TokenCreated"
      ) as any)?.args?.[0];

      const token = await ethers.getContractAt("MemeToken", tokenAddr);

      // ═══ 第 3 步：创建者接受所有权 ═══
      await token.connect(creator).acceptOwnership();
      expect(await token.owner()).to.equal(creator.address);

      // 验证：代币 mint 到 Factory，创建者拥有合约所有权
      const expectedSupply = BigInt(2_000_000) * 10n ** 18n;
      expect(await token.totalSupply()).to.equal(expectedSupply);
      expect(await token.balanceOf(await factory.getAddress())).to.equal(expectedSupply);

      // ═══ 第 4 步：部署独立代币用于 FairLaunch ═══
      const TokenFactory = await ethers.getContractFactory("MemeToken");
      const launchToken = await TokenFactory.deploy(
        "Launch Lifecycle", "LLC", 2_000_000,
        marketing.address, team.address, 300, 500
      );
      await launchToken.waitForDeployment();
      await launchToken.enableTrading();

      // ═══ 第 5 步：部署 FairLaunch ═══
      const whitelist = [buyer1.address, buyer2.address, buyer3.address];
      const { merkleRoot, getProof } = buildMerkleTree(whitelist);

      const LaunchFactory = await ethers.getContractFactory("MemeFairLaunch");
      const launch = await LaunchFactory.deploy(
        await launchToken.getAddress(),
        10000n,
        ethers.parseEther("500000"),
        ethers.parseEther("5"),
        ethers.parseEther("20"),
        ethers.parseEther("10"),
        1800, 3600,
        merkleRoot,
        ethers.ZeroAddress,
        ethers.parseEther("5"),
        lpReceiver.address
      );
      await launch.waitForDeployment();

      // 转移代币到 FairLaunch（launchToken deployer 直接是 test signer，有余额）
      await launchToken.setExcludedFromLimits(await launch.getAddress(), true);
      await launchToken.transfer(
        await launch.getAddress(), ethers.parseEther("500000")
      );

      // ═══ 第 6 步：白名单购买（达硬顶）═══
      const proof1 = getProof(buyer1.address);
      const proof2 = getProof(buyer2.address);
      const proof3 = getProof(buyer3.address);

      await launch.connect(buyer1).buyWhitelist(
        ethers.parseEther("8"), proof1, { value: ethers.parseEther("8") }
      );
      await launch.connect(buyer2).buyWhitelist(
        ethers.parseEther("7"), proof2, { value: ethers.parseEther("7") }
      );
      await launch.connect(buyer3).buyWhitelist(
        ethers.parseEther("5"), proof3, { value: ethers.parseEther("5") }
      );

      // 达硬顶 20 ETH，自动成功
      expect(await launch.launchSucceeded()).to.equal(true);

      // ═══ 第 7 步：领取代币 ═══
      await launch.connect(buyer1).claimTokens();
      await launch.connect(buyer2).claimTokens();
      await launch.connect(buyer3).claimTokens();

      expect(await launchToken.balanceOf(buyer1.address)).to.equal(
        ethers.parseEther("8") * 10000n
      );
      expect(await launchToken.balanceOf(buyer2.address)).to.equal(
        ethers.parseEther("7") * 10000n
      );
      expect(await launchToken.balanceOf(buyer3.address)).to.equal(
        ethers.parseEther("5") * 10000n
      );

      // ═══ 第 8 步：配置第一个代币的 Uniswap 并锁定 ═══
      await token.connect(creator).setUniswapRouter(owner.address);
      await token.connect(creator).setUniswapPair(owner.address);
      await token.connect(creator).enableTrading();
      await token.connect(creator).lockRouter();
      expect(await token.routerLocked()).to.equal(true);

      // ═══ 第 9 步：暂停 + 白名单豁免 ═══
      await token.connect(creator).pause();
      expect(await token.paused()).to.equal(true);

      // 从 Factory 转一些代币给 buyer1（需 creator 先转移）
      // 注意：代币在 Factory，无法直接转。这里测试暂停机制本身。
      await token.connect(creator).setWhitelist(buyer1.address, true);

      // ═══ 第 10 步：恢复 + 验证 ═══
      await token.connect(creator).unpause();
      expect(await token.paused()).to.equal(false);

      // 完整状态验证
      expect(await token.tradingEnabled()).to.equal(true);
      expect(await token.routerLocked()).to.equal(true);
      expect(await factory.totalTokens()).to.equal(1);
    });
  });
});
