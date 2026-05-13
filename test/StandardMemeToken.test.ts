import { expect } from "chai";
import { ethers } from "hardhat";
import { StandardMemeToken } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("StandardMemeToken", function () {
  let token: StandardMemeToken;
  let owner: SignerWithAddress;
  let user: SignerWithAddress;

  const TOKEN_NAME = "Standard Meme";
  const TOKEN_SYMBOL = "SMEME";
  const INITIAL_SUPPLY = 1_000_000;
  const MAX_SUPPLY = 10_000_000;

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory("StandardMemeToken");
    token = await Factory.deploy(TOKEN_NAME, TOKEN_SYMBOL, INITIAL_SUPPLY, MAX_SUPPLY);
    await token.waitForDeployment();
  });

  // ============ 部署测试 ============
  describe("Deployment", function () {
    it("should set correct name and symbol", async function () {
      expect(await token.name()).to.equal(TOKEN_NAME);
      expect(await token.symbol()).to.equal(TOKEN_SYMBOL);
    });

    it("should set correct initial supply", async function () {
      const totalSupply = await token.totalSupply();
      expect(ethers.formatEther(totalSupply)).to.equal(INITIAL_SUPPLY.toFixed(1));
    });

    it("should set correct max supply", async function () {
      expect(await token.maxSupply()).to.equal(MAX_SUPPLY);
    });

    it("should assign initial supply to owner", async function () {
      const balance = await token.balanceOf(owner.address);
      expect(ethers.formatEther(balance)).to.equal(INITIAL_SUPPLY.toFixed(1));
    });

    it("should set owner correctly", async function () {
      expect(await token.owner()).to.equal(owner.address);
    });

    it("should have 18 decimals", async function () {
      expect(await token.decimals()).to.equal(18);
    });
  });

  // ============ Mint 测试 ============
  describe("Mint", function () {
    it("should allow owner to mint tokens", async function () {
      const mintAmount = ethers.parseEther("500000");
      await token.mint(user.address, 500_000);

      const userBalance = await token.balanceOf(user.address);
      expect(userBalance).to.equal(mintAmount);
    });

    it("should increase total supply after mint", async function () {
      const before = await token.totalSupply();
      await token.mint(user.address, 100_000);
      const after = await token.totalSupply();
      expect(after - before).to.equal(ethers.parseEther("100000"));
    });

    it("should reject mint exceeding max supply", async function () {
      // maxSupply=10M, initialSupply=1M, minting 10M more exceeds
      await expect(
        token.mint(user.address, 10_000_000)
      ).to.be.revertedWith("exceeds max supply");
    });

    it("should reject mint from non-owner", async function () {
      await expect(
        token.connect(user).mint(user.address, 100_000)
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });

    it("should emit Mint event", async function () {
      await expect(token.mint(user.address, 50_000))
        .to.emit(token, "Mint")
        .withArgs(user.address, ethers.parseEther("50000"));
    });
  });

  // ============ Burn 测试 ============
  describe("Burn", function () {
    it("should allow owner to burn own tokens", async function () {
      const before = await token.balanceOf(owner.address);
      await token.burn(100_000);
      const after = await token.balanceOf(owner.address);
      expect(before - after).to.equal(ethers.parseEther("100000"));
    });

    it("should decrease total supply after burn", async function () {
      const before = await token.totalSupply();
      await token.burn(50_000);
      const after = await token.totalSupply();
      expect(before - after).to.equal(ethers.parseEther("50000"));
    });

    it("should reject burn from non-owner", async function () {
      // First transfer some tokens to user
      await token.transfer(user.address, ethers.parseEther("1000"));
      await expect(
        token.connect(user).burn(500)
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });

    it("should emit Burn event", async function () {
      await expect(token.burn(25_000))
        .to.emit(token, "Burn")
        .withArgs(owner.address, ethers.parseEther("25000"));
    });
  });

  // ============ 集成测试 ============
  describe("Full lifecycle", function () {
    it("mint → transfer → burn should maintain correct state", async function () {
      // 铸造
      await token.mint(user.address, 500_000);
      expect(await token.balanceOf(user.address)).to.equal(ethers.parseEther("500000"));

      // 转移
      await token.transfer(user.address, ethers.parseEther("200000"));

      // 销毁
      await token.burn(100_000);

      // 验证最终状态
      const totalSupply = await token.totalSupply();
      // initial(1M) + mint(500K) - burn(100K) = 1,400,000
      expect(ethers.formatEther(totalSupply)).to.equal("1400000.0");
    });
  });
});
