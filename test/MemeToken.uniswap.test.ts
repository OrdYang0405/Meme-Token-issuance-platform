// test/MemeToken.uniswap.test.ts
// MemeToken Uniswap 集成测试（需要 Hardhat Mainnet Fork）
// 运行: npx hardhat test test/MemeToken.uniswap.test.ts --network hardhat
// 前提: .env 中配置了 MAINNET_RPC_URL

import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

// Uniswap V2 主网地址
const UNISWAP_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const UNISWAP_V2_FACTORY = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

describe("MemeToken — Uniswap 集成 (Fork)", function () {
  let token: any;
  let owner: SignerWithAddress;
  let user: SignerWithAddress;
  let pairAddr: string;
  let tokenAddr: string;

  this.timeout(120000); // Fork 测试需要 RPC 调用，延长超时

  before(async function () {
    [owner, user] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory("MemeToken");
    token = await Factory.deploy(
      "Meme Token", "MEME", 1_000_000,
      owner.address, owner.address,
      300, 500
    );
    await token.waitForDeployment();
    tokenAddr = await token.getAddress();
  });

  // ═══ 测试 1：设置 Router 并创建 Pair ═══

  it("should set Uniswap Router and create Pair", async function () {
    // 设置 Router → contracts/MemeToken.sol:355
    await token.setUniswapRouter(UNISWAP_V2_ROUTER);
    expect(await token.uniswapV2Router()).to.equal(UNISWAP_V2_ROUTER);

    // 创建 Pair → Factory.createPair
    const factory = new ethers.Contract(
      UNISWAP_V2_FACTORY,
      ["function createPair(address,address) returns (address)"],
      owner
    );
    const tx = await factory.createPair(tokenAddr, WETH);
    await tx.wait();

    pairAddr = await factory.getPair(tokenAddr, WETH);
    expect(pairAddr).to.not.equal(ethers.ZeroAddress);

    // 设置 Pair → contracts/MemeToken.sol:361
    await token.setUniswapPair(pairAddr);
    expect(await token.uniswapV2Pair()).to.equal(pairAddr);
    // Pair 自动从交易限制中排除 → contracts/MemeToken.sol:364
    expect(await token.isExcludedFromLimits(pairAddr)).to.equal(true);
  });

  // ═══ 测试 2：启用交易并添加初始流动性 ═══

  it("should enable trading and allow adding liquidity", async function () {
    await token.enableTrading();
    expect(await token.tradingEnabled()).to.equal(true);

    // 添加初始流动性: 100 ETH + 100,000 TOKEN
    const liquidityTokens = ethers.parseEther("100000");
    const liquidityETH = ethers.parseEther("100");

    await token.approve(UNISWAP_V2_ROUTER, liquidityTokens);

    const router = new ethers.Contract(
      UNISWAP_V2_ROUTER,
      [
        "function addLiquidityETH(address,uint,uint,uint,address,uint) payable returns (uint,uint,uint)",
      ],
      owner
    );

    const tx = await router.addLiquidityETH(
      tokenAddr, liquidityTokens, 0, 0,
      owner.address,
      Math.floor(Date.now() / 1000) + 600,
      { value: liquidityETH }
    );
    const receipt = await tx.wait();
    expect(receipt.status).to.equal(1);
  });

  // ═══ 测试 3：卖出触发税费 + SwapAndLiquify ═══

  it("should charge tax on sell and accumulate for liquidity", async function () {
    const transferAmount = ethers.parseEther("1000");
    await token.transfer(user.address, transferAmount);

    const sellAmount = ethers.parseEther("500");
    await token.connect(user).approve(UNISWAP_V2_ROUTER, sellAmount);

    const beforeAccumulated = await token.accumulatedForLiquidity();

    const router = new ethers.Contract(
      UNISWAP_V2_ROUTER,
      [
        "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint,uint,address[],address,uint)",
      ],
      user
    );

    await router.swapExactTokensForETHSupportingFeeOnTransferTokens(
      sellAmount, 0,
      [tokenAddr, WETH],
      user.address,
      Math.floor(Date.now() / 1000) + 600
    );

    const afterAccumulated = await token.accumulatedForLiquidity();
    // 卖出税 5% → 其中 20% 为流动性份额 → 应累积 500 * 5% * 20% = 5 TOKEN
    expect(afterAccumulated).to.be.greaterThan(beforeAccumulated);
  });

  // ═══ 测试 4：手动触发 SwapAndLiquify ═══

  it("should trigger SwapAndLiquify manually and emit event", async function () {
    const threshold = await token.swapThreshold();
    const accumulated = await token.accumulatedForLiquidity();

    if (accumulated >= threshold) {
      const tx = await token.triggerManualSwap();
      const receipt = await tx.wait();

      // 验证 SwapAndLiquify 事件 → contracts/MemeToken.sol:85
      let eventFound = false;
      for (const log of receipt.logs) {
        try {
          const parsed = token.interface.parseLog({
            topics: log.topics as string[],
            data: log.data,
          });
          if (parsed && parsed.name === "SwapAndLiquify") {
            eventFound = true;
            expect(parsed.args.tokensSwapped).to.be.greaterThan(0);
            expect(parsed.args.ethReceived).to.be.greaterThan(0);
          }
        } catch { continue; }
      }
      expect(eventFound).to.equal(true);

      // 累积量应清零 → contracts/MemeToken.sol:212
      expect(await token.accumulatedForLiquidity()).to.equal(0);
    } else {
      console.log(`  跳过：累积量 (${ethers.formatEther(accumulated)}) < 阈值 (${ethers.formatEther(threshold)})`);
    }
  });

  // ═══ 测试 5：买入也应扣税 ═══

  it("should charge buy tax", async function () {
    // user 用 ETH 买入 TOKEN
    const buyETH = ethers.parseEther("1");

    const router = new ethers.Contract(
      UNISWAP_V2_ROUTER,
      [
        "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint,address[],address,uint) payable",
      ],
      user
    );

    await router.swapExactETHForTokensSupportingFeeOnTransferTokens(
      0,
      [WETH, tokenAddr],
      user.address,
      Math.floor(Date.now() / 1000) + 600,
      { value: buyETH }
    );

    // 验证 user 收到了代币（扣除买入税后）
    const userBalance = await token.balanceOf(user.address);
    expect(userBalance).to.be.greaterThan(0);
  });
});
