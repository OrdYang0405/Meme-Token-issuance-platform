import { expect } from "chai";
import { ethers } from "hardhat";
import { MemeFairLaunch, MemeToken } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { MerkleTree } from "merkletreejs";
import keccak256 from "keccak256";

describe("MemeFairLaunch", function () {
  let launch: MemeFairLaunch;
  let token: MemeToken;
  let owner: SignerWithAddress;
  let marketing: SignerWithAddress;
  let team: SignerWithAddress;
  let lpReceiver: SignerWithAddress;
  let buyer1: SignerWithAddress;
  let buyer2: SignerWithAddress;
  let buyer3: SignerWithAddress;
  let nonWhitelisted: SignerWithAddress;
  let buyer4: SignerWithAddress;
  let buyer5: SignerWithAddress;

  const TOTAL_SUPPLY = 1_000_000;
  const TOKENS_FOR_SALE = ethers.parseEther("400000");
  const TOKENS_PER_ETH = 10000n;
  const SOFT_CAP = ethers.parseEther("10");
  const HARD_CAP = ethers.parseEther("40");
  const MAX_PER_WALLET = ethers.parseEther("15");
  const WHITELIST_DURATION = 3600;
  const PUBLIC_DURATION = 7200;
  const LIQUIDITY_ETH = ethers.parseEther("10");

  let merkleTree: MerkleTree;
  let merkleRoot: string;

  async function getMerkleProof(addr: string): Promise<string[]> {
    const leaf = keccak256(Buffer.from(addr.slice(2), "hex"));
    return merkleTree.getHexProof(leaf);
  }

  beforeEach(async function () {
    [owner, marketing, team, lpReceiver, buyer1, buyer2, buyer3, nonWhitelisted, buyer4, buyer5] =
      await ethers.getSigners();

    // 1. 部署 MemeToken
    const TokenFactory = await ethers.getContractFactory("MemeToken");
    token = await TokenFactory.deploy(
      "FairLaunch Meme", "FLM", TOTAL_SUPPLY,
      marketing.address, team.address, 300, 500
    );
    await token.waitForDeployment();

    // 2. 构建 Merkle Tree（白名单：buyer1-5）
    const whitelist = [buyer1.address, buyer2.address, buyer3.address, buyer4.address, buyer5.address];
    const leaves = whitelist.map(addr =>
      keccak256(Buffer.from(addr.slice(2), "hex"))
    );
    merkleTree = new MerkleTree(leaves, keccak256, { sortPairs: true });
    merkleRoot = "0x" + merkleTree.getRoot().toString("hex");

    // 3. 部署 FairLaunch
    const LaunchFactory = await ethers.getContractFactory("MemeFairLaunch");
    launch = await LaunchFactory.deploy(
      await token.getAddress(),
      TOKENS_PER_ETH,
      TOKENS_FOR_SALE,
      SOFT_CAP,
      HARD_CAP,
      MAX_PER_WALLET,
      WHITELIST_DURATION,
      PUBLIC_DURATION,
      merkleRoot,
      ethers.ZeroAddress,
      LIQUIDITY_ETH,
      lpReceiver.address
    );
    await launch.waitForDeployment();

    // 4. 启用交易并转移代币到 FairLaunch
    await token.enableTrading();
    await token.setExcludedFromLimits(await launch.getAddress(), true);
    await token.transfer(await launch.getAddress(), TOKENS_FOR_SALE);
  });

  // ============ 部署测试 ============
  describe("Deployment", function () {
    it("should set correct parameters", async function () {
      expect(await launch.memeToken()).to.equal(await token.getAddress());
      expect(await launch.tokensPerETH()).to.equal(TOKENS_PER_ETH);
      expect(await launch.tokensForSale()).to.equal(TOKENS_FOR_SALE);
      expect(await launch.softCap()).to.equal(SOFT_CAP);
      expect(await launch.hardCap()).to.equal(HARD_CAP);
      expect(await launch.maxPerWallet()).to.equal(MAX_PER_WALLET);
      expect(await launch.merkleRoot()).to.equal(merkleRoot);
    });

    it("should start in Whitelist phase", async function () {
      expect(await launch.currentPhase()).to.equal(1); // Phase.Whitelist
    });

    it("should hold tokens for sale", async function () {
      const balance = await token.balanceOf(await launch.getAddress());
      expect(balance).to.equal(TOKENS_FOR_SALE);
    });

    it("should reject invalid constructor params", async function () {
      const Factory = await ethers.getContractFactory("MemeFairLaunch");
      await expect(
        Factory.deploy(
          await token.getAddress(), TOKENS_PER_ETH, TOKENS_FOR_SALE,
          HARD_CAP, SOFT_CAP, // soft > hard
          MAX_PER_WALLET, WHITELIST_DURATION, PUBLIC_DURATION,
          merkleRoot, ethers.ZeroAddress, LIQUIDITY_ETH, lpReceiver.address
        )
      ).to.be.revertedWith("soft > hard");
    });
  });

  // ============ 白名单阶段 ============
  describe("Whitelist phase", function () {
    it("should record purchase and track tokens owed", async function () {
      const proof = await getMerkleProof(buyer1.address);
      const ethAmount = ethers.parseEther("1");

      const tx = await launch.connect(buyer1).buyWhitelist(ethAmount, proof, {
        value: ethAmount,
      });

      await expect(tx)
        .to.emit(launch, "WhitelistPurchased")
        .withArgs(buyer1.address, ethAmount, ethAmount * TOKENS_PER_ETH);

      // 代币未发放，记录在 tokensOwed 中
      expect(await launch.tokensOwed(buyer1.address)).to.equal(ethAmount * TOKENS_PER_ETH);
      expect(await token.balanceOf(buyer1.address)).to.equal(0);
    });

    it("should reject non-whitelisted address", async function () {
      const proof = await getMerkleProof(buyer1.address);
      await expect(
        launch.connect(nonWhitelisted).buyWhitelist(ethers.parseEther("1"), proof, {
          value: ethers.parseEther("1"),
        })
      ).to.be.revertedWith("invalid proof");
    });

    it("should reject double claim", async function () {
      const proof = await getMerkleProof(buyer1.address);
      await launch.connect(buyer1).buyWhitelist(ethers.parseEther("1"), proof, {
        value: ethers.parseEther("1"),
      });

      await expect(
        launch.connect(buyer1).buyWhitelist(ethers.parseEther("1"), proof, {
          value: ethers.parseEther("1"),
        })
      ).to.be.revertedWith("already claimed");
    });

    it("should reject value mismatch", async function () {
      const proof = await getMerkleProof(buyer1.address);
      await expect(
        launch.connect(buyer1).buyWhitelist(ethers.parseEther("1"), proof, {
          value: ethers.parseEther("2"),
        })
      ).to.be.revertedWith("value mismatch");
    });
  });

  // ============ 公开发售阶段 ============
  describe("Public phase", function () {
    beforeEach(async function () {
      await time.increase(WHITELIST_DURATION + 1);
    });

    it("should allow anyone to buy in public phase", async function () {
      const ethAmount = ethers.parseEther("1");
      await launch.connect(nonWhitelisted).buyPublic({ value: ethAmount });

      expect(await launch.tokensOwed(nonWhitelisted.address)).to.equal(ethAmount * TOKENS_PER_ETH);
    });

    it("should emit PublicPurchased event", async function () {
      const ethAmount = ethers.parseEther("2");
      await expect(
        launch.connect(buyer1).buyPublic({ value: ethAmount })
      ).to.emit(launch, "PublicPurchased");
    });

    it("should reject zero amount", async function () {
      await expect(
        launch.connect(buyer1).buyPublic({ value: 0 })
      ).to.be.revertedWith("zero amount");
    });
  });

  // ============ 申购限制 ============
  describe("Purchase limits", function () {
    it("should reject when exceeding wallet cap", async function () {
      const proof = await getMerkleProof(buyer1.address);
      await launch.connect(buyer1).buyWhitelist(MAX_PER_WALLET, proof, {
        value: MAX_PER_WALLET,
      });

      await time.increase(WHITELIST_DURATION + 1);
      await expect(
        launch.connect(buyer1).buyPublic({ value: 1n })
      ).to.be.revertedWith("exceeds wallet cap");
    });

    it("should reject when exceeding hard cap", async function () {
      const proof1 = await getMerkleProof(buyer1.address);
      await launch.connect(buyer1).buyWhitelist(MAX_PER_WALLET, proof1, {
        value: MAX_PER_WALLET,
      });

      const proof2 = await getMerkleProof(buyer2.address);
      await launch.connect(buyer2).buyWhitelist(MAX_PER_WALLET, proof2, {
        value: MAX_PER_WALLET,
      });

      // remaining = 40 - 15 - 15 = 10 ETH, 达到硬顶后自动结束
      const proof3 = await getMerkleProof(buyer3.address);
      const remaining = HARD_CAP - MAX_PER_WALLET * 2n;
      await launch.connect(buyer3).buyWhitelist(remaining, proof3, {
        value: remaining,
      });

      // 硬顶已到，阶段结束，无法再购买
      await time.increase(WHITELIST_DURATION + 1);
      await expect(
        launch.connect(nonWhitelisted).buyPublic({ value: 1n })
      ).to.be.revertedWith("not open");
    });
  });

  // ============ 代币领取（成功后）============
  describe("Claim tokens", function () {
    it("should allow claiming tokens after successful launch", async function () {
      const proof = await getMerkleProof(buyer1.address);
      // 买够软顶（需要 >= 10 ETH）
      const ethAmount = SOFT_CAP;
      await launch.connect(buyer1).buyWhitelist(ethAmount, proof, {
        value: ethAmount,
      });

      // 时间到期后 finalize 成功
      await time.increase(WHITELIST_DURATION + PUBLIC_DURATION + 1);
      await launch.finalize();

      // 领取代币
      await launch.connect(buyer1).claimTokens();
      const expected = ethAmount * TOKENS_PER_ETH;
      expect(await token.balanceOf(buyer1.address)).to.equal(expected);
    });

    it("should reject claim before launch succeeds", async function () {
      const proof = await getMerkleProof(buyer1.address);
      await launch.connect(buyer1).buyWhitelist(ethers.parseEther("1"), proof, {
        value: ethers.parseEther("1"),
      });

      await expect(
        launch.connect(buyer1).claimTokens()
      ).to.be.revertedWith("launch not successful");
    });

    it("should reject double claim", async function () {
      const proof = await getMerkleProof(buyer1.address);
      await launch.connect(buyer1).buyWhitelist(SOFT_CAP, proof, {
        value: SOFT_CAP,
      });

      await time.increase(WHITELIST_DURATION + PUBLIC_DURATION + 1);
      await launch.finalize();
      await launch.connect(buyer1).claimTokens();

      await expect(
        launch.connect(buyer1).claimTokens()
      ).to.be.revertedWith("already claimed");
    });

    it("should emit TokensClaimed event", async function () {
      const proof = await getMerkleProof(buyer1.address);
      const ethAmount = SOFT_CAP;
      await launch.connect(buyer1).buyWhitelist(ethAmount, proof, {
        value: ethAmount,
      });

      await time.increase(WHITELIST_DURATION + PUBLIC_DURATION + 1);
      await launch.finalize();

      await expect(launch.connect(buyer1).claimTokens())
        .to.emit(launch, "TokensClaimed")
        .withArgs(buyer1.address, ethAmount * TOKENS_PER_ETH);
    });
  });

  // ============ 发射失败与退款 ============
  describe("Failed launch and refund", function () {
    it("should enable refund when soft cap not met", async function () {
      const proof = await getMerkleProof(buyer1.address);
      const smallAmount = ethers.parseEther("1");
      await launch.connect(buyer1).buyWhitelist(smallAmount, proof, {
        value: smallAmount,
      });

      await time.increase(WHITELIST_DURATION + PUBLIC_DURATION + 1);
      await launch.finalize();

      expect(await launch.refundEnabled()).to.equal(true);
      expect(await launch.launchSucceeded()).to.equal(false);
    });

    it("should allow users to claim refund", async function () {
      const proof = await getMerkleProof(buyer1.address);
      const ethAmount = ethers.parseEther("2");
      await launch.connect(buyer1).buyWhitelist(ethAmount, proof, {
        value: ethAmount,
      });

      await time.increase(WHITELIST_DURATION + PUBLIC_DURATION + 1);
      await launch.finalize();

      const balanceBefore = await ethers.provider.getBalance(buyer1.address);
      const tx = await launch.connect(buyer1).claimRefund();
      const receipt = await tx.wait();
      const gasCost = receipt!.fee;

      const balanceAfter = await ethers.provider.getBalance(buyer1.address);
      expect(balanceAfter - balanceBefore + gasCost).to.equal(ethAmount);
    });

    it("should clear tokensOwed on refund", async function () {
      const proof = await getMerkleProof(buyer1.address);
      const ethAmount = ethers.parseEther("1");
      await launch.connect(buyer1).buyWhitelist(ethAmount, proof, {
        value: ethAmount,
      });

      expect(await launch.tokensOwed(buyer1.address)).to.be.gt(0);

      await time.increase(WHITELIST_DURATION + PUBLIC_DURATION + 1);
      await launch.finalize();
      await launch.connect(buyer1).claimRefund();

      expect(await launch.tokensOwed(buyer1.address)).to.equal(0);
    });

    it("should reject double refund", async function () {
      const proof = await getMerkleProof(buyer1.address);
      await launch.connect(buyer1).buyWhitelist(ethers.parseEther("1"), proof, {
        value: ethers.parseEther("1"),
      });

      await time.increase(WHITELIST_DURATION + PUBLIC_DURATION + 1);
      await launch.finalize();
      await launch.connect(buyer1).claimRefund();

      await expect(
        launch.connect(buyer1).claimRefund()
      ).to.be.revertedWith("nothing to refund");
    });

    it("should emit RefundClaimed event", async function () {
      const proof = await getMerkleProof(buyer1.address);
      const ethAmount = ethers.parseEther("1");
      await launch.connect(buyer1).buyWhitelist(ethAmount, proof, {
        value: ethAmount,
      });

      await time.increase(WHITELIST_DURATION + PUBLIC_DURATION + 1);
      await launch.finalize();

      await expect(launch.connect(buyer1).claimRefund())
        .to.emit(launch, "RefundClaimed")
        .withArgs(buyer1.address, ethAmount);
    });
  });

  // ============ 进度查询 ============
  describe("Progress query", function () {
    it("should return correct progress", async function () {
      const proof = await getMerkleProof(buyer1.address);
      const ethAmount = ethers.parseEther("3");
      await launch.connect(buyer1).buyWhitelist(ethAmount, proof, {
        value: ethAmount,
      });

      const [raised, hard, soft] = await launch.getProgress();
      expect(raised).to.equal(ethAmount);
      expect(hard).to.equal(HARD_CAP);
      expect(soft).to.equal(SOFT_CAP);
    });
  });

  // ============ 集成测试：完整流程 ============
  describe("Full fair launch flow", function () {
    it("whitelist → public → hard cap → claim tokens", async function () {
      // 白名单阶段：buyer1 买 15 ETH
      const proof = await getMerkleProof(buyer1.address);
      await launch.connect(buyer1).buyWhitelist(MAX_PER_WALLET, proof, {
        value: MAX_PER_WALLET,
      });

      // 进入公开阶段
      await time.increase(WHITELIST_DURATION + 1);

      // 公开购买：多用户买直到硬顶
      const amount1 = ethers.parseEther("15");
      const amount2 = HARD_CAP - MAX_PER_WALLET - amount1; // 40 - 15 - 15 = 10
      await launch.connect(nonWhitelisted).buyPublic({ value: amount1 });
      await launch.connect(buyer2).buyPublic({ value: amount2 });

      // 自动 finalize 成功
      expect(await launch.launchSucceeded()).to.equal(true);

      // 参与者领取代币
      await launch.connect(buyer1).claimTokens();
      expect(await token.balanceOf(buyer1.address)).to.equal(MAX_PER_WALLET * TOKENS_PER_ETH);

      await launch.connect(nonWhitelisted).claimTokens();
      expect(await token.balanceOf(nonWhitelisted.address)).to.equal(amount1 * TOKENS_PER_ETH);

      await launch.connect(buyer2).claimTokens();
      expect(await token.balanceOf(buyer2.address)).to.equal(amount2 * TOKENS_PER_ETH);
    });

    it("whitelist → time expires → below soft cap → refund", async function () {
      const proof = await getMerkleProof(buyer1.address);
      const ethAmount = ethers.parseEther("3");
      await launch.connect(buyer1).buyWhitelist(ethAmount, proof, {
        value: ethAmount,
      });

      // 时间到期，未达软顶
      await time.increase(WHITELIST_DURATION + PUBLIC_DURATION + 1);
      await launch.finalize();

      expect(await launch.refundEnabled()).to.equal(true);

      // 退款
      const before = await ethers.provider.getBalance(buyer1.address);
      const tx = await launch.connect(buyer1).claimRefund();
      const receipt = await tx.wait();
      const after = await ethers.provider.getBalance(buyer1.address);
      expect(after - before + receipt!.fee).to.equal(ethAmount);
    });
  });

  // ============ Owner 提取 ============
  describe("Owner withdrawals", function () {
    it("should allow owner to withdraw unsold tokens after success", async function () {
      const proof = await getMerkleProof(buyer1.address);
      await launch.connect(buyer1).buyWhitelist(SOFT_CAP, proof, {
        value: SOFT_CAP,
      });

      await time.increase(WHITELIST_DURATION + PUBLIC_DURATION + 1);
      await launch.finalize();

      const contractBalance = await token.balanceOf(await launch.getAddress());
      expect(contractBalance).to.be.gt(0);

      await launch.connect(owner).withdrawUnsoldTokens();
      expect(await token.balanceOf(await launch.getAddress())).to.equal(0);
    });

    it("should allow owner to withdraw raised ETH after success", async function () {
      const proof = await getMerkleProof(buyer1.address);
      await launch.connect(buyer1).buyWhitelist(SOFT_CAP, proof, {
        value: SOFT_CAP,
      });

      await time.increase(WHITELIST_DURATION + PUBLIC_DURATION + 1);
      await launch.finalize();

      const contractETH = await ethers.provider.getBalance(await launch.getAddress());
      expect(contractETH).to.equal(SOFT_CAP);

      await launch.connect(owner).withdrawRaisedETH();
      expect(await ethers.provider.getBalance(await launch.getAddress())).to.equal(0);
    });
  });
});
