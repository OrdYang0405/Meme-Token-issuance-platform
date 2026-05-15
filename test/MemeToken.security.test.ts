// test/MemeToken.security.test.ts
// 第13课：合约安全审计实践 —— 安全修复验证测试
// 验证 P0/P1 安全修复：Router 锁定、滑点保护、swapThreshold 上限、rescueETH 互斥

import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { MemeToken } from "../typechain-types";
import { deployMemeToken, MemeTokenFixture } from "./helpers/fixtures";

describe("MemeToken — 安全审计与修复", function () {
  let token: MemeToken;
  let owner: SignerWithAddress;
  let marketing: SignerWithAddress;
  let team: SignerWithAddress;
  let buyer: SignerWithAddress;
  let seller: SignerWithAddress;
  let pair: SignerWithAddress;

  async function fixture(): Promise<MemeTokenFixture> {
    const f = await deployMemeToken();
    // 设置 Router（模拟 Uniswap Router 地址）
    await f.token.setUniswapRouter(f.owner.address);
    return f;
  }

  // ════════════════════════════════════════════════════════════════
  // 一、Router 锁定机制（P0-1）
  // ════════════════════════════════════════════════════════════════

  describe("Router 锁定（P0-1）", function () {
    beforeEach(async function () {
      const f = await loadFixture(fixture);
      token = f.token;
      owner = f.owner;
      buyer = f.buyer;
    });

    it("锁定后无法修改 Router 地址", async function () {
      await token.lockRouter();

      await expect(
        token.setUniswapRouter(buyer.address)
      ).to.be.revertedWith("router locked");
    });

    it("Router 未设置时无法锁定", async function () {
      // 部署新代币，不设置 Router
      const Factory = await ethers.getContractFactory("MemeToken");
      const freshToken = await Factory.deploy(
        "Test", "TST", 1000000,
        owner.address, owner.address, 300, 500
      );
      await freshToken.waitForDeployment();

      await expect(
        freshToken.lockRouter()
      ).to.be.revertedWith("router not set");
    });

    it("重复锁定被拒绝", async function () {
      await token.lockRouter();
      await expect(token.lockRouter()).to.be.revertedWith("already locked");
    });

    it("锁定后 routerLocked 状态为 true", async function () {
      expect(await token.routerLocked()).to.equal(false);
      await token.lockRouter();
      expect(await token.routerLocked()).to.equal(true);
    });

    it("锁定后 emit RouterLocked 事件", async function () {
      await expect(token.lockRouter())
        .to.emit(token, "RouterLocked");
    });

    it("锁定前可以正常修改 Router", async function () {
      // 锁定前修改 Router
      await token.setUniswapRouter(buyer.address);
      expect(await token.uniswapV2Router()).to.equal(buyer.address);

      // 改回来再锁定
      await token.setUniswapRouter(owner.address);
      await token.lockRouter();
      expect(await token.routerLocked()).to.equal(true);
    });

    it("非 owner 无法锁定 Router", async function () {
      await expect(
        token.connect(buyer).lockRouter()
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });
  });

  // ════════════════════════════════════════════════════════════════
  // 二、滑点保护（P0-2）
  // ════════════════════════════════════════════════════════════════

  describe("滑点保护（P0-2）", function () {
    beforeEach(async function () {
      const f = await loadFixture(fixture);
      token = f.token;
      owner = f.owner;
      buyer = f.buyer;
    });

    it("默认 slippageBPS 为 100（1%）", async function () {
      expect(await token.slippageBPS()).to.equal(100);
    });

    it("owner 可设置合法滑点值", async function () {
      await token.setSlippageBPS(200);
      expect(await token.slippageBPS()).to.equal(200);
    });

    it("设置滑点 emit SlippageUpdated 事件", async function () {
      await expect(token.setSlippageBPS(300))
        .to.emit(token, "SlippageUpdated")
        .withArgs(100, 300);
    });

    it("低于 MIN_SLIPPAGE_BPS（50）被拒绝", async function () {
      await expect(
        token.setSlippageBPS(49)
      ).to.be.revertedWith("invalid slippage");
    });

    it("高于 MAX_SLIPPAGE_BPS（500）被拒绝", async function () {
      await expect(
        token.setSlippageBPS(501)
      ).to.be.revertedWith("invalid slippage");
    });

    it("边界值：MIN_SLIPPAGE_BPS=50 合法", async function () {
      await token.setSlippageBPS(50);
      expect(await token.slippageBPS()).to.equal(50);
    });

    it("边界值：MAX_SLIPPAGE_BPS=500 合法", async function () {
      await token.setSlippageBPS(500);
      expect(await token.slippageBPS()).to.equal(500);
    });

    it("非 owner 无法设置滑点", async function () {
      await expect(
        token.connect(buyer).setSlippageBPS(200)
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });
  });

  // ════════════════════════════════════════════════════════════════
  // 三、rescueETH 与 _inSwap 互斥（P0-3）
  // ════════════════════════════════════════════════════════════════

  describe("rescueETH 互斥锁（P0-3）", function () {
    beforeEach(async function () {
      const f = await loadFixture(fixture);
      token = f.token;
      owner = f.owner;
      buyer = f.buyer;
    });

    it("正常情况可 rescue ETH", async function () {
      await owner.sendTransaction({
        to: await token.getAddress(),
        value: ethers.parseEther("1"),
      });

      await expect(token.rescueETH())
        .to.emit(token, "RescueETH")
        .withArgs(owner.address, ethers.parseEther("1"));
    });

    it("合约无 ETH 时 rescue 成功（amount=0）", async function () {
      // 没有发送 ETH 到合约，余额为 0
      await expect(token.rescueETH())
        .to.emit(token, "RescueETH")
        .withArgs(owner.address, 0);
    });

    it("非 owner 无法 rescue", async function () {
      await expect(
        token.connect(buyer).rescueETH()
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });
  });

  // ════════════════════════════════════════════════════════════════
  // 四、swapThreshold 上限（P1-4）
  // ════════════════════════════════════════════════════════════════

  describe("swapThreshold 上限（P1-4）", function () {
    beforeEach(async function () {
      const f = await loadFixture(fixture);
      token = f.token;
      owner = f.owner;
      buyer = f.buyer;
    });

    it("合法值可正常设置", async function () {
      const maxThreshold = await token.maxSwapThreshold();
      // 总供应量 1_000_000 → maxSwapThreshold = 10_000 tokens
      await token.setSwapThreshold(maxThreshold);
      expect(await token.swapThreshold()).to.equal(maxThreshold);
    });

    it("超过 maxSwapThreshold 被拒绝", async function () {
      const maxThreshold = await token.maxSwapThreshold();
      await expect(
        token.setSwapThreshold(maxThreshold + 1n)
      ).to.be.revertedWith("threshold too high");
    });

    it("设置为 0 被拒绝", async function () {
      await expect(
        token.setSwapThreshold(0)
      ).to.be.revertedWith("zero threshold");
    });

    it("maxSwapThreshold = totalSupply / 100", async function () {
      const totalSupply = await token.totalSupply();
      const expectedMax = totalSupply / 100n;
      expect(await token.maxSwapThreshold()).to.equal(expectedMax);
    });
  });

  // ════════════════════════════════════════════════════════════════
  // 五、完整部署 + 安全配置流程
  // ════════════════════════════════════════════════════════════════

  describe("安全部署流程（完整）", function () {
    it("deploy → setRouter → setPair → enableTrading → lockRouter", async function () {
      const f = await loadFixture(fixture);
      const t = f.token;

      // 1. 初始状态：Router 未锁定
      expect(await t.routerLocked()).to.equal(false);

      // 2. 设置 Pair（安全：Pair 必须在锁定前设置）
      // Pair 已在 fixture 中设置

      // 3. 启用交易
      // Trading 已在 fixture 中启用

      // 4. 锁定 Router
      await t.lockRouter();
      expect(await t.routerLocked()).to.equal(true);

      // 5. 锁定后无法修改 Router
      await expect(
        t.setUniswapRouter(f.owner.address)
      ).to.be.revertedWith("router locked");

      // 6. 锁定后 Router 地址不变
      expect(await t.uniswapV2Router()).to.equal(f.owner.address);
    });
  });
});
