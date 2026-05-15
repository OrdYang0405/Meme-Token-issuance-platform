// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

interface IUniswapV2Router02 {
    function factory() external pure returns (address);
    function WETH() external pure returns (address);

    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external;

    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity);

    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external
        view
        returns (uint256[] memory amounts);
}

contract MemeToken is ERC20, Ownable2Step, Pausable {
    // ============ 税费配置 ============
    uint256 public buyTax;
    uint256 public sellTax;
    uint256 public constant MAX_TAX = 2500; // 最高 25%

    uint256 public liquidityShare = 2000;
    uint256 public marketingShare = 4000;
    uint256 public teamShare = 2000;
    uint256 public burnShare = 2000;

    address public marketingWallet;
    address public teamWallet;

    // ── 参数更新频率锁 ──
    uint256 public constant TAX_COOLDOWN = 1 days;
    uint256 public lastTaxUpdateTime;
    uint256 public lastShareUpdateTime;
    uint256 public constant SHARE_COOLDOWN = 1 days;

    // ============ 排除地址 ============
    mapping(address => bool) public isExcludedFromFee;

    // ============ 交易限制 ============
    uint256 public maxTransactionAmount;
    uint256 public maxWalletAmount;
    bool public limitsEnabled = true;
    mapping(address => bool) public isExcludedFromLimits;

    // ============ 防机器人 / 交易控制 ============
    bool public tradingEnabled;
    mapping(address => bool) public isWhitelisted;

    // ============ Uniswap 集成 ============
    IUniswapV2Router02 public uniswapV2Router;
    address public uniswapV2Pair;

    // ============ SwapAndLiquify ============
    uint256 public accumulatedForLiquidity;
    uint256 public swapThreshold;
    bool public swapAndLiquifyEnabled = true;
    bool private _inSwap;

    // ── 安全：Router 锁定（一次写入，永久生效）──
    bool public routerLocked;

    // ── 安全：滑点保护 ──
    uint256 public slippageBPS = 100; // 默认 1%
    uint256 public constant MIN_SLIPPAGE_BPS = 50;  // 最低 0.5%
    uint256 public constant MAX_SLIPPAGE_BPS = 500;  // 最高 5%

    // ── 安全：swapThreshold 上限 ──
    uint256 public maxSwapThreshold;

    // ============ 事件 ============
    event TaxCharged(address indexed from, address indexed to, uint256 taxAmount, bool isSell);
    event TaxDistributed(uint256 marketing, uint256 liquidity, uint256 team, uint256 burned);
    event ExcludedFromFee(address indexed account, bool excluded);
    event ExcludedFromLimits(address indexed account, bool excluded);
    event LimitsUpdated(uint256 maxTransaction, uint256 maxWallet, bool enabled);
    event TradingToggled(bool enabled);
    event WhitelistUpdated(address indexed account, bool whitelisted);
    event TaxUpdated(uint256 oldBuyTax, uint256 newBuyTax, uint256 oldSellTax, uint256 newSellTax);
    event TaxSharesUpdated(uint256 liquidity, uint256 marketing, uint256 team, uint256 burn);
    event WalletsUpdated(address marketing, address team);
    event SwapAndLiquify(uint256 tokensSwapped, uint256 ethReceived, uint256 tokensIntoLiquidity);
    event ManualSwapTriggered(address indexed caller);
    event UniswapRouterSet(address router);
    event RescueETH(address indexed to, uint256 amount);
    event RescueToken(address indexed token, address indexed to, uint256 amount);
    event RouterLocked();
    event SlippageUpdated(uint256 oldBPS, uint256 newBPS);

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
        maxTransactionAmount = supply / 50;
        maxWalletAmount = supply / 50;
        swapThreshold = supply / 1000;
        maxSwapThreshold = supply / 100; // 不超过总供应量的 1%

        isExcludedFromFee[msg.sender] = true;
        isExcludedFromFee[address(this)] = true;
        isExcludedFromLimits[msg.sender] = true;
        isExcludedFromLimits[address(this)] = true;
        isWhitelisted[msg.sender] = true;

        _mint(msg.sender, supply);
    }

    // ============ 核心：转账钩子 ============

    function _update(address from, address to, uint256 amount) internal override {
        if (from == address(0) || to == address(0)) {
            super._update(from, to, amount);
            return;
        }

        // ── 暂停检查（白名单地址不受暂停影响）──
        if (paused() && !isWhitelisted[from] && !isWhitelisted[to]) {
            revert("token transfers paused");
        }

        // ── 交易开关检查 ──
        if (!tradingEnabled) {
            require(isWhitelisted[from] || isWhitelisted[to], "trading not enabled");
        }

        // ── 交易限制检查 ──
        if (limitsEnabled && !isExcludedFromLimits[from] && !isExcludedFromLimits[to]) {
            require(amount <= maxTransactionAmount, "exceeds max transaction");
            if (to != uniswapV2Pair) {
                require(balanceOf(to) + amount <= maxWalletAmount, "exceeds max wallet");
            }
        }

        // ── 税费计算与扣取 ──
        bool shouldTakeFee = !_inSwap &&
            !isExcludedFromFee[from] &&
            !isExcludedFromFee[to] &&
            (from == uniswapV2Pair || to == uniswapV2Pair);

        if (shouldTakeFee) {
            bool isSell = (to == uniswapV2Pair);
            uint256 taxRate = isSell ? sellTax : buyTax;

            if (taxRate > 0) {
                uint256 taxAmount = (amount * taxRate) / 10000;
                uint256 netAmount = amount - taxAmount;

                super._update(from, address(this), taxAmount);

                uint256 marketingAmount = (taxAmount * marketingShare) / 10000;
                uint256 teamAmount = (taxAmount * teamShare) / 10000;
                uint256 liquidityAmount = (taxAmount * liquidityShare) / 10000;
                uint256 burnAmount = taxAmount - marketingAmount - teamAmount - liquidityAmount;

                if (marketingAmount > 0) {
                    super._update(address(this), marketingWallet, marketingAmount);
                }
                if (teamAmount > 0) {
                    super._update(address(this), teamWallet, teamAmount);
                }
                if (burnAmount > 0) {
                    super._update(address(this), address(0), burnAmount);
                }

                accumulatedForLiquidity += liquidityAmount;
                emit TaxCharged(from, to, taxAmount, isSell);
                emit TaxDistributed(marketingAmount, liquidityAmount, teamAmount, burnAmount);

                super._update(from, to, netAmount);

                if (isSell) {
                    _trySwapAndLiquify();
                }
                return;
            }
        }

        super._update(from, to, amount);

        if (!_inSwap && to == uniswapV2Pair && !isExcludedFromFee[from]) {
            _trySwapAndLiquify();
        }
    }

    // ============ SwapAndLiquify ============

    function _trySwapAndLiquify() private {
        if (
            accumulatedForLiquidity >= swapThreshold &&
            swapAndLiquifyEnabled &&
            !_inSwap &&
            address(uniswapV2Router) != address(0)
        ) {
            uint256 half = accumulatedForLiquidity / 2;
            uint256 otherHalf = accumulatedForLiquidity - half;
            accumulatedForLiquidity = 0;

            _inSwap = true;

            uint256 ethBefore = address(this).balance;
            _swapTokensForEth(half);
            uint256 ethReceived = address(this).balance - ethBefore;

            if (ethReceived > 0 && otherHalf > 0) {
                _addLiquidity(otherHalf, ethReceived);
            }

            _inSwap = false;

            emit SwapAndLiquify(half, ethReceived, otherHalf);
        }
    }

    function _swapTokensForEth(uint256 tokenAmount) private {
        address[] memory path = new address[](2);
        path[0] = address(this);
        path[1] = uniswapV2Router.WETH();

        _approve(address(this), address(uniswapV2Router), tokenAmount);

        // 滑点保护：基于 Pair 当前储备计算最小输出量
        uint256 minOut = 0;
        try uniswapV2Router.getAmountsOut(tokenAmount, path) returns (uint256[] memory amounts) {
            minOut = (amounts[1] * (10000 - slippageBPS)) / 10000;
        } catch {
            // 当 Pair 未创建或流动性不足时，回退到 slippageBPS=0
            // 此情况仅发生在首次添加流动性之前
        }

        uniswapV2Router.swapExactTokensForETHSupportingFeeOnTransferTokens(
            tokenAmount,
            minOut,
            path,
            address(this),
            block.timestamp
        );
    }

    function _addLiquidity(uint256 tokenAmount, uint256 ethAmount) private {
        _approve(address(this), address(uniswapV2Router), tokenAmount);

        uint256 tokenMin = (tokenAmount * (10000 - slippageBPS)) / 10000;
        uint256 ethMin = (ethAmount * (10000 - slippageBPS)) / 10000;

        uniswapV2Router.addLiquidityETH{value: ethAmount}(
            address(this),
            tokenAmount,
            tokenMin,
            ethMin,
            address(this),
            block.timestamp
        );
    }

    function triggerManualSwap() external onlyOwner {
        require(accumulatedForLiquidity >= swapThreshold, "below threshold");
        emit ManualSwapTriggered(msg.sender);
        _trySwapAndLiquify();
    }

    receive() external payable {}

    // ============ Pausable 管理 ============

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ Owner 管理函数（含频率锁）============

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
        require(block.timestamp >= lastTaxUpdateTime + TAX_COOLDOWN, "tax cooldown active");

        uint256 oldBuy = buyTax;
        uint256 oldSell = sellTax;
        buyTax = _buyTax;
        sellTax = _sellTax;
        lastTaxUpdateTime = block.timestamp;

        emit TaxUpdated(oldBuy, _buyTax, oldSell, _sellTax);
    }

    function setTaxShares(
        uint256 _liquidityShare,
        uint256 _marketingShare,
        uint256 _teamShare,
        uint256 _burnShare
    ) external onlyOwner {
        require(
            _liquidityShare + _marketingShare + _teamShare + _burnShare == 10000,
            "shares != 100%"
        );
        require(
            block.timestamp >= lastShareUpdateTime + SHARE_COOLDOWN,
            "share cooldown active"
        );

        liquidityShare = _liquidityShare;
        marketingShare = _marketingShare;
        teamShare = _teamShare;
        burnShare = _burnShare;
        lastShareUpdateTime = block.timestamp;

        emit TaxSharesUpdated(_liquidityShare, _marketingShare, _teamShare, _burnShare);
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

    function setUniswapRouter(address _router) external onlyOwner {
        require(!routerLocked, "router locked");
        require(_router != address(0), "zero router");
        uniswapV2Router = IUniswapV2Router02(_router);
        emit UniswapRouterSet(_router);
    }

    function lockRouter() external onlyOwner {
        require(!routerLocked, "already locked");
        require(address(uniswapV2Router) != address(0), "router not set");
        routerLocked = true;
        emit RouterLocked();
    }

    function setUniswapPair(address _pair) external onlyOwner {
        require(_pair != address(0), "zero pair");
        uniswapV2Pair = _pair;
        isExcludedFromLimits[_pair] = true;
    }

    function setSwapThreshold(uint256 _threshold) external onlyOwner {
        require(_threshold > 0, "zero threshold");
        require(_threshold <= maxSwapThreshold, "threshold too high");
        swapThreshold = _threshold;
    }

    function setSwapAndLiquifyEnabled(bool _enabled) external onlyOwner {
        swapAndLiquifyEnabled = _enabled;
    }

    function setSlippageBPS(uint256 _bps) external onlyOwner {
        require(_bps >= MIN_SLIPPAGE_BPS && _bps <= MAX_SLIPPAGE_BPS, "invalid slippage");
        uint256 old = slippageBPS;
        slippageBPS = _bps;
        emit SlippageUpdated(old, _bps);
    }

    // ============ 紧急资产回收 ============

    function rescueETH() external onlyOwner {
        require(!_inSwap, "swap in progress");
        uint256 amount = address(this).balance;
        payable(owner()).transfer(amount);
        emit RescueETH(owner(), amount);
    }

    function rescueToken(address _token) external onlyOwner {
        require(_token != address(this), "cannot rescue self");
        uint256 amount = IERC20(_token).balanceOf(address(this));
        IERC20(_token).transfer(owner(), amount);
        emit RescueToken(_token, owner(), amount);
    }
}
