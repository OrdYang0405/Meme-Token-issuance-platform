import { expect } from "chai";
import { ethers } from "hardhat";
import { MemeFactory, MemeToken } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("MemeFactory", function () {
  let factory: MemeFactory;
  let owner: SignerWithAddress;
  let creator: SignerWithAddress;
  let marketing: SignerWithAddress;
  let team: SignerWithAddress;

  const CREATION_FEE = ethers.parseEther("0.01");

  const TOKEN_PARAMS = {
    name: "Test Meme",
    symbol: "TEST",
    totalSupply: 1_000_000,
    marketingWallet: "", // set in beforeEach
    teamWallet: "",      // set in beforeEach
    buyTax: 300,
    sellTax: 500,
  };

  beforeEach(async function () {
    [owner, creator, marketing, team] = await ethers.getSigners();
    TOKEN_PARAMS.marketingWallet = marketing.address;
    TOKEN_PARAMS.teamWallet = team.address;

    const Factory = await ethers.getContractFactory("MemeFactory");
    factory = await Factory.deploy(CREATION_FEE);
    await factory.waitForDeployment();
  });

  // ============ 部署测试 ============
  describe("Deployment", function () {
    it("should set correct creation fee", async function () {
      expect(await factory.creationFee()).to.equal(CREATION_FEE);
    });

    it("should set correct owner", async function () {
      expect(await factory.owner()).to.equal(owner.address);
    });

    it("should start with zero tokens", async function () {
      expect(await factory.totalTokens()).to.equal(0);
    });

    it("should reject fee exceeding max", async function () {
      const Factory = await ethers.getContractFactory("MemeFactory");
      const maxFee = ethers.parseEther("10");
      await expect(
        Factory.deploy(maxFee + 1n)
      ).to.be.revertedWith("fee too high");
    });
  });

  // ============ 创建代币 ============
  describe("createToken", function () {
    it("should create a new token and return its address", async function () {
      const tx = await factory.connect(creator).createToken(TOKEN_PARAMS, {
        value: CREATION_FEE,
      });

      await expect(tx)
        .to.emit(factory, "TokenCreated")
        .withArgs(
          (addr: string) => ethers.isAddress(addr),
          creator.address,
          TOKEN_PARAMS.name,
          TOKEN_PARAMS.symbol,
          TOKEN_PARAMS.totalSupply,
          TOKEN_PARAMS.buyTax,
          TOKEN_PARAMS.sellTax,
          0
        );
    });

    it("should transfer token ownership to creator", async function () {
      const tx = await factory.connect(creator).createToken(TOKEN_PARAMS, {
        value: CREATION_FEE,
      });
      const receipt = await tx.wait();

      // 从事件中获取代币地址
      const event = receipt!.logs.find(
        (log) => (log as any).fragment?.name === "TokenCreated"
      );
      const tokenAddr = (event as any)?.args?.[0];

      const token = await ethers.getContractAt("MemeToken", tokenAddr);
      expect(await token.pendingOwner()).to.equal(creator.address);
    });

    it("should reject without sufficient fee", async function () {
      await expect(
        factory.connect(creator).createToken(TOKEN_PARAMS, {
          value: CREATION_FEE - 1n,
        })
      ).to.be.revertedWith("insufficient creation fee");
    });

    it("should reject empty name", async function () {
      const params = { ...TOKEN_PARAMS, name: "" };
      await expect(
        factory.connect(creator).createToken(params, { value: CREATION_FEE })
      ).to.be.revertedWith("invalid name length");
    });

    it("should reject overly long name", async function () {
      const params = { ...TOKEN_PARAMS, name: "A".repeat(33) };
      await expect(
        factory.connect(creator).createToken(params, { value: CREATION_FEE })
      ).to.be.revertedWith("invalid name length");
    });

    it("should reject overly long symbol", async function () {
      const params = { ...TOKEN_PARAMS, symbol: "TOOLONGSYM" };
      await expect(
        factory.connect(creator).createToken(params, { value: CREATION_FEE })
      ).to.be.revertedWith("invalid symbol length");
    });

    it("should reject supply out of range", async function () {
      const params = { ...TOKEN_PARAMS, totalSupply: 100 };
      await expect(
        factory.connect(creator).createToken(params, { value: CREATION_FEE })
      ).to.be.revertedWith("supply out of range");
    });

    it("should reject zero marketing wallet", async function () {
      const params = {
        ...TOKEN_PARAMS,
        marketingWallet: ethers.ZeroAddress,
      };
      await expect(
        factory.connect(creator).createToken(params, { value: CREATION_FEE })
      ).to.be.revertedWith("zero marketing wallet");
    });

    it("should reject tax exceeding max", async function () {
      const params = { ...TOKEN_PARAMS, buyTax: 3000 };
      await expect(
        factory.connect(creator).createToken(params, { value: CREATION_FEE })
      ).to.be.revertedWith("tax too high");
    });
  });

  // ============ 代币追踪 ============
  describe("Token tracking", function () {
    beforeEach(async function () {
      // 创建 3 个代币
      for (let i = 0; i < 3; i++) {
        await factory.connect(creator).createToken(
          {
            ...TOKEN_PARAMS,
            name: `Token ${i}`,
            symbol: `TK${i}`,
          },
          { value: CREATION_FEE }
        );
      }
    });

    it("should track all created tokens", async function () {
      expect(await factory.totalTokens()).to.equal(3);
      const all = await factory.allTokens(0);
      expect(ethers.isAddress(all)).to.be.true;
    });

    it("should track tokens by creator", async function () {
      const tokens = await factory.getTokensByCreator(creator.address);
      expect(tokens.length).to.equal(3);
    });

    it("should return correct token count by creator", async function () {
      expect(await factory.getTokenCountByCreator(creator.address)).to.equal(3);
    });

    it("should support paginated query", async function () {
      const [tokens, total] = await factory.getTokensPaginated(0, 2);
      expect(tokens.length).to.equal(2);
      expect(total).to.equal(3);
    });

    it("should handle paginated query beyond range", async function () {
      const [tokens, total] = await factory.getTokensPaginated(5, 2);
      expect(tokens.length).to.equal(0);
      expect(total).to.equal(3);
    });

    it("should store token params on chain", async function () {
      const all = await factory.allTokens(0);
      const params = await factory.tokenParams(all);
      expect(params.name).to.equal("Token 0");
      expect(params.symbol).to.equal("TK0");
    });
  });

  // ============ 费用管理 ============
  describe("Fee management", function () {
    it("should allow owner to update creation fee", async function () {
      const newFee = ethers.parseEther("0.05");
      await factory.setCreationFee(newFee);
      expect(await factory.creationFee()).to.equal(newFee);
    });

    it("should emit CreationFeeUpdated event", async function () {
      const newFee = ethers.parseEther("0.05");
      await expect(factory.setCreationFee(newFee))
        .to.emit(factory, "CreationFeeUpdated")
        .withArgs(CREATION_FEE, newFee);
    });

    it("should reject fee update from non-owner", async function () {
      await expect(
        factory.connect(creator).setCreationFee(0)
      ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
    });

    it("should allow owner to withdraw accumulated fees", async function () {
      await factory.connect(creator).createToken(TOKEN_PARAMS, {
        value: CREATION_FEE,
      });

      const before = await ethers.provider.getBalance(owner.address);
      const tx = await factory.withdrawFees();
      const receipt = await tx.wait();
      const gasCost = receipt!.fee;

      const after = await ethers.provider.getBalance(owner.address);
      expect(after - before + gasCost).to.equal(CREATION_FEE);
    });

    it("should reject fee withdrawal from non-owner", async function () {
      await expect(
        factory.connect(creator).withdrawFees()
      ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
    });
  });

  // ============ 创建的代币功能验证 ============
  describe("Created token functionality", function () {
    let tokenAddr: string;
    let token: MemeToken;

    beforeEach(async function () {
      const tx = await factory.connect(creator).createToken(TOKEN_PARAMS, {
        value: CREATION_FEE,
      });
      const receipt = await tx.wait();
      const event = receipt!.logs.find(
        (log) => (log as any).fragment?.name === "TokenCreated"
      );
      tokenAddr = (event as any)?.args?.[0];
      token = await ethers.getContractAt("MemeToken", tokenAddr);
    });

    it("should set correct token metadata", async function () {
      expect(await token.name()).to.equal(TOKEN_PARAMS.name);
      expect(await token.symbol()).to.equal(TOKEN_PARAMS.symbol);
    });

    it("should mint total supply to factory (pending creator accept)", async function () {
      const balance = await token.balanceOf(await factory.getAddress());
      const supply = BigInt(TOKEN_PARAMS.totalSupply) * 10n ** 18n;
      expect(balance).to.equal(supply);
    });

    it("should set pending owner to creator", async function () {
      expect(await token.pendingOwner()).to.equal(creator.address);
    });

    it("should allow creator to accept ownership and control token", async function () {
      await token.connect(creator).acceptOwnership();
      expect(await token.owner()).to.equal(creator.address);

      // 创建者可以管理代币
      await token.connect(creator).enableTrading();
      expect(await token.tradingEnabled()).to.equal(true);
    });

    it("should set correct tax configuration", async function () {
      expect(await token.buyTax()).to.equal(TOKEN_PARAMS.buyTax);
      expect(await token.sellTax()).to.equal(TOKEN_PARAMS.sellTax);
    });
  });

  // ============ 集成测试：多用户创建 ============
  describe("Multi-creator scenario", function () {
    it("should correctly track tokens from different creators", async function () {
      const [, , , , creator2] = await ethers.getSigners();

      await factory.connect(creator).createToken(TOKEN_PARAMS, {
        value: CREATION_FEE,
      });

      await factory.connect(creator2).createToken(
        { ...TOKEN_PARAMS, name: "Creator2 Token", symbol: "C2T" },
        { value: CREATION_FEE }
      );

      expect(await factory.totalTokens()).to.equal(2);
      expect(await factory.getTokenCountByCreator(creator.address)).to.equal(1);
      expect(await factory.getTokenCountByCreator(creator2.address)).to.equal(1);
    });
  });
});
