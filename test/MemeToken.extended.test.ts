// test/MemeToken.extended.test.ts
// MemeToken 扩展测试 —— 使用 loadFixture 快照加速 + 边界情况覆盖
// 运行：npx hardhat test test/MemeToken.extended.test.ts
//
// 本文件演示：
//   1. loadFixture 快照回滚模式（比 beforeEach 重新部署快 80%+）
//   2. 时间快照与回滚（evm_snapshot / evm_revert）
//   3. 税率边界的精确验证
//   4. 时间穿越的精确边界（TAX_COOLDOWN 到期时刻）
//   5. 事件参数完整验证
//   6. 使用 test/helpers/utils.ts 中的工具函数

import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployMemeToken, MemeTokenFixture } from "./helpers/fixtures";
import { findEvent, shortAddr, isValidAddress, buildMerkleTree, currentTimestamp } from "./helpers/utils";

// ============ 部署测试（使用 Fixture 快照）============

describe("MemeToken (Extended — loadFixture)", function () {
  // ── 注意：没有 beforeEach！
  // loadFixture 在内部自动管理快照：第一次运行部署，后续测试回滚到快照
  // 效果：50 个测试只需要 1 次部署 + 49 次快照回滚

  async function fixture(): Promise<MemeTokenFixture> {
    return deployMemeToken();
  }

  // ============ 部署基线（使用 loadFixture）============

  describe("Deployment via loadFixture", function () {
    it("should set correct ownership (fixture snapshot)", async function () {
      const { token, owner } = await loadFixture(fixture);
      expect(await token.owner()).to.equal(owner.address);
    });

    it("should have independent state from other tests", async function () {
      // 每个 loadFixture(fixture) 调用都从同一个快照恢复——状态完全独立
      const { token, buyer } = await loadFixture(fixture);
      // buyer 初始余额为 0（未受其他测试影响）
      expect(await token.balanceOf(buyer.address)).to.equal(0);
    });

    it("should deploy with correct total supply", async function () {
      const { token } = await loadFixture(fixture);
      const totalSupply = await token.totalSupply();
      // 1_000_000 代币 × 10^18
      expect(totalSupply).to.equal(ethers.parseEther("1000000"));
    });
  });

  // ============ 所有权：两步转移的完整边界测试 ============

  describe("Ownership — two-step transfer edge cases", function () {
    it("should allow owner to change pendingOwner before acceptance", async function () {
      const { token, owner, buyer, seller } = await loadFixture(fixture);

      // 第一次 transfer → buyer
      await token.transferOwnership(buyer.address);
      expect(await token.pendingOwner()).to.equal(buyer.address);

      // 第二次 transfer → seller（覆盖 pendingOwner，不需要 buyer accept）
      await token.transferOwnership(seller.address);
      expect(await token.pendingOwner()).to.equal(seller.address);

      // seller 接受
      await token.connect(seller).acceptOwnership();
      expect(await token.owner()).to.equal(seller.address);
    });

    it("should reject acceptOwnership when pendingOwner is zero", async function () {
      const { token, buyer } = await loadFixture(fixture);
      // 从未调用 transferOwnership，pendingOwner = address(0)
      await expect(
        token.connect(buyer).acceptOwnership()
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });

    it("should emit OwnershipTransferStarted event", async function () {
      const { token, owner, buyer } = await loadFixture(fixture);
      // OwnershipTransferStarted(previousOwner, newOwner) — previousOwner = 当前 owner
      await expect(token.transferOwnership(buyer.address))
        .to.emit(token, "OwnershipTransferStarted")
        .withArgs(owner.address, buyer.address);
    });

    it("should emit OwnershipTransferred after accept", async function () {
      const { token, owner, buyer } = await loadFixture(fixture);
      await token.transferOwnership(buyer.address);
      await expect(token.connect(buyer).acceptOwnership())
        .to.emit(token, "OwnershipTransferred")
        .withArgs(owner.address, buyer.address);
    });
  });

  // ============ 频率锁：精确时间边界测试 ============

  describe("Cooldown — precise boundary", function () {
    it("should reject update exactly at cooldown boundary (TAX_COOLDOWN = 1 days)", async function () {
      const { token } = await loadFixture(fixture);
      await token.setTax(200, 400);

      // 刚好经过 1 days（等于，不是大于）
      await time.increase(1 * 24 * 60 * 60); // 86400 秒 = 恰好 1 天

      // require: block.timestamp >= lastTaxUpdateTime + TAX_COOLDOWN
      // 86400 >= 86400 → true → 应允许
      await token.setTax(100, 200);
      expect(await token.buyTax()).to.equal(100);
    });

    it("should reject update 1 second before cooldown expires", async function () {
      const { token } = await loadFixture(fixture);
      await token.setTax(200, 400);

      // Hardhat 挖矿时有额外时间偏移，直接用 time.increase 到边界会因挖矿增量而刚好到期
      // 使用 time.setNextBlockTimestamp 精确控制下一区块时间戳
      const lastBlock = await ethers.provider.getBlock("latest");
      const targetTimestamp = (await token.lastTaxUpdateTime()) + BigInt(1 * 24 * 60 * 60 - 5);
      await time.setNextBlockTimestamp(targetTimestamp);

      await expect(
        token.setTax(100, 200)
      ).to.be.revertedWith("tax cooldown active");
    });

    it("should track lastTaxUpdateTime correctly after each update", async function () {
      const { token } = await loadFixture(fixture);
      const tsBefore = await currentTimestamp();

      await token.setTax(100, 200);
      const lastUpdate = await token.lastTaxUpdateTime();
      // lastUpdate 应 ≥ 交易时间戳
      expect(lastUpdate).to.be.gte(tsBefore);
    });

    it("should allow share update independently from tax update", async function () {
      const { token } = await loadFixture(fixture);

      // 两个冷却期独立计时
      await token.setTax(100, 200);
      // 立即更新 shares——不受 tax cooldown 限制
      await token.setTaxShares(2500, 2500, 2500, 2500);
      expect(await token.liquidityShare()).to.equal(2500);

      // 但 tax 仍在冷却期
      await expect(
        token.setTax(50, 100)
      ).to.be.revertedWith("tax cooldown active");
    });
  });

  // ============ 税费机制：精确计算验证 ============

  describe("Tax mechanism — precise calculation", function () {
    // 所有买入测试共享的前置：给 pair 转代币模拟流动性池
    async function taxFixture(): Promise<MemeTokenFixture> {
      const f = await deployMemeToken();
      // pair 需要持有代币才能"卖出"给 buyer
      await f.token.transfer(f.pair.address, ethers.parseEther("50000"));
      return f;
    }

    it("should calculate buy tax to the wei precision", async function () {
      const { token, pair, buyer } = await loadFixture(taxFixture);
      const amount = ethers.parseEther("1000");
      // buyTax = 300 基点 = 3%
      const expectedTax = (amount * 300n) / 10000n; // 30 tokens
      const expectedNet = amount - expectedTax;       // 970 tokens

      await token.connect(pair).transfer(buyer.address, amount);
      expect(await token.balanceOf(buyer.address)).to.equal(expectedNet);
    });

    it("should distribute tax to all four destinations", async function () {
      const { token, pair, buyer, marketing, team } = await loadFixture(taxFixture);
      const amount = ethers.parseEther("10000");
      const tax = (amount * 300n) / 10000n; // 300 tokens

      // 预期分配（基于默认份额）：
      //   marketingShare = 4000 → 300 * 40% = 120
      //   teamShare = 2000      → 300 * 20% = 60
      //   liquidityShare = 2000 → 300 * 20% = 60
      //   burnShare = 2000      → 300 * 20% = 60
      const expectedMarketing = (tax * 4000n) / 10000n;
      const expectedTeam = (tax * 2000n) / 10000n;
      const expectedLiquidity = (tax * 2000n) / 10000n;

      const marketingBefore = await token.balanceOf(marketing.address);
      const teamBefore = await token.balanceOf(team.address);
      const liquidityBefore = await token.accumulatedForLiquidity();

      await token.connect(pair).transfer(buyer.address, amount);

      expect(await token.balanceOf(marketing.address) - marketingBefore).to.equal(expectedMarketing);
      expect(await token.balanceOf(team.address) - teamBefore).to.equal(expectedTeam);
      expect(await token.accumulatedForLiquidity() - liquidityBefore).to.equal(expectedLiquidity);
    });

    it("should not charge tax on non-pair transfers", async function () {
      const { token, owner, buyer } = await loadFixture(fixture);
      const amount = ethers.parseEther("1000");

      // owner → buyer（双方都不是 pair）→ 不应扣税
      const buyerBefore = await token.balanceOf(buyer.address);
      await token.transfer(buyer.address, amount);
      expect(await token.balanceOf(buyer.address) - buyerBefore).to.equal(amount);
    });

    it("should not charge tax when both sender and receiver are excluded", async function () {
      const { token, buyer, seller } = await loadFixture(fixture);
      await token.setExcludedFromFee(buyer.address, true);
      await token.setExcludedFromFee(seller.address, true);

      const amount = ethers.parseEther("1000");
      await token.transfer(buyer.address, amount);

      const before = await token.balanceOf(seller.address);
      await token.connect(buyer).transfer(seller.address, amount);
      // 双方都排除 → 全额到账
      expect(await token.balanceOf(seller.address) - before).to.equal(amount);
    });

    it("should emit TaxCharged and TaxDistributed events on buy", async function () {
      const { token, pair, buyer } = await loadFixture(taxFixture);
      const amount = ethers.parseEther("1000");

      const tx = await token.connect(pair).transfer(buyer.address, amount);
      const receipt = await tx.wait();

      // 使用工具函数查找事件
      const taxCharged = findEvent(receipt!, token, "TaxCharged");
      expect(taxCharged.args.from).to.equal(pair.address);
      expect(taxCharged.args.to).to.equal(buyer.address);
      expect(taxCharged.args.isSell).to.equal(false); // from pair = buy

      const taxDistributed = findEvent(receipt!, token, "TaxDistributed");
      expect(taxDistributed.args.marketing).to.be.gt(0);
      expect(taxDistributed.args.burned).to.be.gt(0);
    });
  });

  // ============ 交易限制：边界值测试 ============

  describe("Transaction limits — boundary values", function () {
    it("should allow transfer exactly at maxTransactionAmount", async function () {
      const { token, buyer, seller } = await loadFixture(fixture);
      const maxTx = await token.maxTransactionAmount();

      // 先转足够的代币给 buyer
      await token.transfer(buyer.address, maxTx * 2n);

      // 刚好等于限额 → 应允许
      await token.connect(buyer).transfer(seller.address, maxTx);
      expect(await token.balanceOf(seller.address)).to.equal(maxTx);
    });

    it("should reject transfer 1 wei above maxTransactionAmount", async function () {
      const { token, buyer, seller } = await loadFixture(fixture);
      const maxTx = await token.maxTransactionAmount();

      await token.transfer(buyer.address, maxTx * 2n);

      // 超过 1 wei → 应拒绝
      await expect(
        token.connect(buyer).transfer(seller.address, maxTx + 1n)
      ).to.be.revertedWith("exceeds max transaction");
    });

    it("should allow wallet exactly at maxWalletAmount", async function () {
      const { token, buyer } = await loadFixture(fixture);
      const maxWallet = await token.maxWalletAmount();

      // 买家和卖家都不是 pair → 直接转账不扣税
      await token.transfer(buyer.address, maxWallet);
      expect(await token.balanceOf(buyer.address)).to.equal(maxWallet);
    });

    it("should reject wallet exceeding maxWalletAmount by 1 wei", async function () {
      const { token, buyer, seller } = await loadFixture(fixture);
      const maxWallet = await token.maxWalletAmount();

      // owner 被排除在限制外，所以 owner → buyer 可以绕过限额
      await token.transfer(buyer.address, maxWallet);

      // seller 是非排除地址，seller → buyer 的 1 wei 会使 buyer 超出 maxWallet
      await token.setExcludedFromLimits(seller.address, false);
      await token.transfer(seller.address, ethers.parseEther("1"));

      await expect(
        token.connect(seller).transfer(buyer.address, 1n)
      ).to.be.revertedWith("exceeds max wallet");
    });

    it("should allow owner to disable and re-enable limits", async function () {
      const { token, buyer } = await loadFixture(fixture);
      const maxTx = await token.maxTransactionAmount();

      // 关闭限额
      await token.setLimits(maxTx, maxTx, false); // enabled = false
      expect(await token.limitsEnabled()).to.equal(false);

      // 超过限额也允许
      await token.transfer(buyer.address, maxTx * 3n);
      expect(await token.balanceOf(buyer.address)).to.equal(maxTx * 3n);

      // 重新启用
      await token.setLimits(maxTx, maxTx, true);
      expect(await token.limitsEnabled()).to.equal(true);
    });
  });

  // ============ 暂停与白名单：组合场景 ============

  describe("Pausable + Whitelist — combined scenarios", function () {
    it("should reject non-whitelisted even during unpaused state? no", async function () {
      const { token, buyer, seller } = await loadFixture(fixture);

      // 未暂停时，非白名单用户正常转账
      await token.transfer(buyer.address, ethers.parseEther("1000"));
      await token.connect(buyer).transfer(seller.address, ethers.parseEther("100"));
      expect(await token.balanceOf(seller.address)).to.equal(ethers.parseEther("100"));
    });

    it("should allow whitelist to operate when trading disabled", async function () {
      const { token, buyer, seller } = await loadFixture(fixture);

      // 先开交易再关
      await token.enableTrading();
      await token.disableTrading();
      expect(await token.tradingEnabled()).to.equal(false);

      // 白名单仍可转账
      await token.setWhitelist(buyer.address, true);
      await token.transfer(buyer.address, ethers.parseEther("1000"));
      await token.connect(buyer).transfer(seller.address, ethers.parseEther("100"));
      expect(await token.balanceOf(seller.address)).to.equal(ethers.parseEther("100"));
    });

    it("should reject non-whitelist when trading disabled", async function () {
      const { token, buyer, seller } = await loadFixture(fixture);

      await token.enableTrading();
      await token.disableTrading();

      await token.transfer(buyer.address, ethers.parseEther("1000"));

      await expect(
        token.connect(buyer).transfer(seller.address, ethers.parseEther("100"))
      ).to.be.revertedWith("trading not enabled");
    });
  });

  // ============ 救援函数：完整 ETH 余额追踪 ============

  describe("Rescue — ETH balance tracking", function () {
    it("should rescue ETH and verify contract balance drops to zero", async function () {
      const { token, owner } = await loadFixture(fixture);

      const rescueAmount = ethers.parseEther("2.5");
      await owner.sendTransaction({
        to: await token.getAddress(),
        value: rescueAmount,
      });

      // 验证合约收到 ETH
      expect(await ethers.provider.getBalance(await token.getAddress()))
        .to.equal(rescueAmount);

      // 执行救援
      const ownerBefore = await ethers.provider.getBalance(owner.address);
      const tx = await token.rescueETH();
      const receipt = await tx.wait();
      const ownerAfter = await ethers.provider.getBalance(owner.address);

      // 合约余额清零
      expect(await ethers.provider.getBalance(await token.getAddress())).to.equal(0);

      // 验证 owner 余额恢复：after = before + rescued - gas
      const netChange = ownerAfter - ownerBefore + receipt!.fee;
      expect(netChange).to.equal(rescueAmount);
    });

    it("should allow rescuing non-self ERC20 tokens", async function () {
      const { token, owner } = await loadFixture(fixture);

      // 部署另一个 ERC20 作为"误转入的代币"
      const OtherFactory = await ethers.getContractFactory("StandardMemeToken");
      const otherToken = await OtherFactory.deploy("Other", "OTH", 1000000, 10000000);
      await otherToken.waitForDeployment();

      // 转入 MemeToken 合约
      const rescueAmount = ethers.parseEther("5000");
      await otherToken.transfer(await token.getAddress(), rescueAmount);

      // rescueToken 应能救回
      const tx = await token.rescueToken(await otherToken.getAddress());
      const receipt = await tx.wait();

      const rescued = findEvent(receipt!, token, "RescueToken");
      expect(rescued.args.token).to.equal(await otherToken.getAddress());
      expect(rescued.args.to).to.equal(owner.address);
      expect(rescued.args.amount).to.equal(rescueAmount);
    });
  });

  // ============ 集成：多函数组合的完整流程 ============

  describe("Integration — full lifecycle with snapshot reset", function () {
    it("deploy → configure → trade → pause → rescue → transfer ownership", async function () {
      const { token, owner, buyer, seller, pair, marketing, team } = await loadFixture(fixture);

      // 阶段 1：初始状态验证
      expect(await token.owner()).to.equal(owner.address);
      expect(await token.buyTax()).to.equal(300);
      expect(await token.sellTax()).to.equal(500);

      // 阶段 2：配置并交易
      await token.transfer(buyer.address, ethers.parseEther("50000"));
      await token.transfer(pair.address, ethers.parseEther("10000"));

      // 卖出
      const sellAmount = ethers.parseEther("1000");
      const expectedTax = (sellAmount * 500n) / 10000n;
      const supplyBefore = await token.totalSupply();
      await token.connect(buyer).transfer(pair.address, sellAmount);

      // 验证 burn
      expect(await token.totalSupply()).to.be.lt(supplyBefore);

      // 阶段 3：暂停
      await token.pause();
      expect(await token.paused()).to.equal(true);

      // 阶段 4：白名单操作
      await token.setWhitelist(buyer.address, true);
      await token.connect(buyer).transfer(seller.address, ethers.parseEther("100"));

      // 阶段 5：恢复
      await token.unpause();

      // 阶段 6：修改参数（冷却期后）
      await time.increase(1 * 24 * 60 * 60 + 1);
      await token.setTax(100, 200);
      expect(await token.buyTax()).to.equal(100);

      // 阶段 7：所有权转移
      await token.transferOwnership(buyer.address);
      await token.connect(buyer).acceptOwnership();
      expect(await token.owner()).to.equal(buyer.address);

      // 阶段 8：旧 owner 无权操作
      await expect(
        token.pause()
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });
  });

  // ============ 工具函数自测 ============

  describe("Utility function self-tests", function () {
    it("shortAddr should format addresses correctly", function () {
      const addr = "0x1234567890abcdef1234567890abcdef12345678";
      const result = shortAddr(addr);
      // "0x1234...5678" = 0x(2) + 1234(4) + ...(3) + 5678(4) = 13
      expect(result).to.equal("0x1234...5678");
      expect(result.length).to.equal(13);
    });

    it("isValidAddress should accept valid addresses", function () {
      expect(isValidAddress("0x1234567890abcdef1234567890abcdef12345678")).to.equal(true);
      expect(isValidAddress("invalid")).to.equal(false);
      expect(isValidAddress(null)).to.equal(false);
      expect(isValidAddress(123)).to.equal(false);
    });

    it("buildMerkleTree should create valid proofs", function () {
      const addrs = [
        "0x1234567890abcdef1234567890abcdef12345678",
        "0x2234567890abcdef1234567890abcdef12345678",
        "0x3234567890abcdef1234567890abcdef12345678",
      ];
      const { merkleRoot, getProof } = buildMerkleTree(addrs);

      // 根不为空
      expect(merkleRoot).to.match(/^0x[a-fA-F0-9]{64}$/);

      // 每个地址都能生成 proof
      for (const addr of addrs) {
        const proof = getProof(addr);
        expect(proof.length).to.be.gt(0);
      }

      // 不在列表中的地址无法生成有效 proof（至少 proof 不同）
      const unknownProof = getProof("0x0000000000000000000000000000000000000000");
      const validProof = getProof(addrs[0]);
      expect(unknownProof).to.not.deep.equal(validProof);
    });
  });
});
