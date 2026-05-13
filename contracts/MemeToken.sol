// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MemeToken is ERC20, Ownable {
    // ============ 税费配置 ============
    // 采用基点制（basis points）：100 = 1%，10000 = 100%
    uint256 public buyTax;
    uint256 public sellTax;
    uint256 public constant MAX_TAX = 2500; // 最高 25%

    // 税费分配比例（基点制，三项之和 = 10000）
    uint256 public liquidityShare = 3000; // 30% → 累积在合约中，用于后续自动做市
    uint256 public marketingShare = 5000; // 50% → 转入营销钱包
    uint256 public teamShare = 2000; // 20% → 转入团队钱包

    // 税费接收地址
    address public marketingWallet;
    address public teamWallet;

    // ============ 排除地址 ============
    // 免税费地址（DEX 合约、部署者等）
    mapping(address => bool) public isExcludedFromFee;

    // ============ 交易限制 ============
    uint256 public maxTransactionAmount; // 单笔最大交易量
    uint256 public maxWalletAmount; // 单个钱包最大持仓
    bool public limitsEnabled = true; // 限制开关
    mapping(address => bool) public isExcludedFromLimits; // 不受限制的地址

    // ============ 防机器人 / 交易控制 ============
    bool public tradingEnabled; // 交易开关（初始关闭）
    mapping(address => bool) public isWhitelisted; // 白名单地址（不受交易开关限制）

    // ============ Uniswap 集成 ============
    address public uniswapV2Pair; // 交易对地址（部署后设置）

    // ============ SwapAndLiquify 预留 ============
    uint256 public accumulatedForLiquidity; // 累积的 LP 税费（本课先累计，第4课实现自动做市）
    uint256 public swapThreshold; // 触发自动做市阈值
    bool public swapAndLiquifyEnabled = true;
    bool private _inSwap; // 重入锁
    modifier lockSwap() {
        _inSwap = true;
        _;
        _inSwap = false;
    }

    // ============ 事件 ============
    event TaxCharged(address indexed from, address indexed to, uint256 taxAmount, bool isSell);
    event TaxDistributed(uint256 marketing, uint256 liquidity, uint256 team);
    event ExcludedFromFee(address indexed account, bool excluded);
    event ExcludedFromLimits(address indexed account, bool excluded);
    event LimitsUpdated(uint256 maxTransaction, uint256 maxWallet, bool enabled);
    event TradingToggled(bool enabled);
    event WhitelistUpdated(address indexed account, bool whitelisted);
    event TaxUpdated(uint256 oldBuyTax, uint256 newBuyTax, uint256 oldSellTax, uint256 newSellTax);
    event WalletsUpdated(address marketing, address team);
    event UniswapPairSet(address pair);

    // ============ 构造函数 ============
    constructor(
        string memory _name,
        string memory _symbol,
        uint256 _totalSupply,
        address _marketingWallet,
        address _teamWallet,
        uint256 _buyTax,
        uint256 _sellTax
    ) ERC20(_name, _symbol) Ownable(msg.sender) {
        require(_marketingWallet != address(0), "zero marketing wallet");
        require(_teamWallet != address(0), "zero team wallet");
        require(_buyTax <= MAX_TAX && _sellTax <= MAX_TAX, "tax too high");

        marketingWallet = _marketingWallet;
        teamWallet = _teamWallet;
        buyTax = _buyTax;
        sellTax = _sellTax;

        uint256 supply = _totalSupply * 10 ** decimals();
        // 默认限制：单笔最多 2% 总量，钱包最多 2% 总量
        maxTransactionAmount = supply / 50;
        maxWalletAmount = supply / 50;
        swapThreshold = supply / 1000; // 累积 0.1% 后触发

        // 部署者与合约自身免税费、免限制
        isExcludedFromFee[msg.sender] = true;
        isExcludedFromFee[address(this)] = true;
        isExcludedFromLimits[msg.sender] = true;
        isExcludedFromLimits[address(this)] = true;
        isWhitelisted[msg.sender] = true;

        _mint(msg.sender, supply);
    }

    // ============ 核心：转账钩子 ============

    function _update(address from, address to, uint256 amount) internal override {
        // 铸造 / 销毁 不做任何检查，直接走父合约
        if (from == address(0) || to == address(0)) {
            super._update(from, to, amount);
            return;
        }

        // ── 1. 交易开关检查 ──
        if (!tradingEnabled) {
            require(isWhitelisted[from] || isWhitelisted[to], "trading not enabled");
        }

        // ── 2. 交易限制检查 ──
        if (limitsEnabled && !isExcludedFromLimits[from] && !isExcludedFromLimits[to]) {
            require(amount <= maxTransactionAmount, "exceeds max transaction");
            if (to != uniswapV2Pair) {
                require(
                    balanceOf(to) + amount <= maxWalletAmount,
                    "exceeds max wallet"
                );
            }
        }

        // ── 3. 税费计算与扣取 ──
        bool shouldTakeFee = !_inSwap && // 自动做市本身不收税
            !isExcludedFromFee[from] &&
            !isExcludedFromFee[to] &&
            (from == uniswapV2Pair || to == uniswapV2Pair); // 只有买卖才收税

        if (shouldTakeFee) {
            bool isSell = (to == uniswapV2Pair);
            uint256 taxRate = isSell ? sellTax : buyTax;
            uint256 taxAmount;

            if (taxRate > 0) {
                taxAmount = (amount * taxRate) / 10000;
                uint256 netAmount = amount - taxAmount;

                // 税费先转入合约
                super._update(from, address(this), taxAmount);

                // 分配税费
                uint256 marketingAmount = (taxAmount * marketingShare) / 10000;
                uint256 teamAmount = (taxAmount * teamShare) / 10000;
                uint256 liquidityAmount = taxAmount - marketingAmount - teamAmount;

                if (marketingAmount > 0) {
                    super._update(address(this), marketingWallet, marketingAmount);
                }
                if (teamAmount > 0) {
                    super._update(address(this), teamWallet, teamAmount);
                }

                accumulatedForLiquidity += liquidityAmount;
                emit TaxCharged(from, to, taxAmount, isSell);
                emit TaxDistributed(marketingAmount, liquidityAmount, teamAmount);

                // 净额转给目标
                super._update(from, to, netAmount);
                return;
            }
        }

        super._update(from, to, amount);
    }

    // ── 自动做市触发（本课预留接口，第4课完善） ──

    function _trySwapAndLiquify() private {
        // 第4课将实现完整逻辑：
        // 当 accumulatedForLiquidity >= swapThreshold 时
        // 自动卖出 50% → 添加流动性
    }

    // ============ Owner 管理函数 ============

    function enableTrading() external onlyOwner {
        tradingEnabled = true;
        emit TradingToggled(true);
    }

    function disableTrading() external onlyOwner {
        tradingEnabled = false;
        emit TradingToggled(false);
    }

    function setTax(uint256 _buyTax, uint256 _sellTax) external onlyOwner {
        require(_buyTax <= MAX_TAX && _sellTax <= MAX_TAX, "tax too high");
        uint256 oldBuy = buyTax;
        uint256 oldSell = sellTax;
        buyTax = _buyTax;
        sellTax = _sellTax;
        emit TaxUpdated(oldBuy, _buyTax, oldSell, _sellTax);
    }

    function setTaxShares(
        uint256 _liquidityShare,
        uint256 _marketingShare,
        uint256 _teamShare
    ) external onlyOwner {
        require(_liquidityShare + _marketingShare + _teamShare == 10000, "shares != 100%");
        liquidityShare = _liquidityShare;
        marketingShare = _marketingShare;
        teamShare = _teamShare;
    }

    function setWallets(address _marketing, address _team) external onlyOwner {
        require(_marketing != address(0) && _team != address(0), "zero address");
        marketingWallet = _marketing;
        teamWallet = _team;
        emit WalletsUpdated(_marketing, _team);
    }

    function setExcludedFromFee(address _account, bool _excluded) external onlyOwner {
        isExcludedFromFee[_account] = _excluded;
        emit ExcludedFromFee(_account, _excluded);
    }

    function setExcludedFromLimits(address _account, bool _excluded) external onlyOwner {
        isExcludedFromLimits[_account] = _excluded;
        emit ExcludedFromLimits(_account, _excluded);
    }

    function setLimits(uint256 _maxTx, uint256 _maxWallet, bool _enabled) external onlyOwner {
        maxTransactionAmount = _maxTx;
        maxWalletAmount = _maxWallet;
        limitsEnabled = _enabled;
        emit LimitsUpdated(_maxTx, _maxWallet, _enabled);
    }

    function setWhitelist(address _account, bool _whitelisted) external onlyOwner {
        isWhitelisted[_account] = _whitelisted;
        emit WhitelistUpdated(_account, _whitelisted);
    }

    function setUniswapPair(address _pair) external onlyOwner {
        require(_pair != address(0), "zero pair");
        uniswapV2Pair = _pair;
        isExcludedFromLimits[_pair] = true;
        emit UniswapPairSet(_pair);
    }

    function setSwapThreshold(uint256 _threshold) external onlyOwner {
        swapThreshold = _threshold;
    }

    function setSwapAndLiquifyEnabled(bool _enabled) external onlyOwner {
        swapAndLiquifyEnabled = _enabled;
    }

    // ============ 紧急资产提取 ============

    function rescueETH() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }

    function rescueToken(address _token) external onlyOwner {
        require(_token != address(this), "cannot rescue self");
        IERC20(_token).transfer(owner(), IERC20(_token).balanceOf(address(this)));
    }
}

