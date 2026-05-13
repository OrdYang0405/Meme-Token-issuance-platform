// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IMemeTokenFairLaunch {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function enableTrading() external;
    function setUniswapRouter(address router) external;
    function setUniswapPair(address pair) external;
    function owner() external view returns (address);
    function transferOwnership(address newOwner) external;
    function acceptOwnership() external;
}

contract MemeFairLaunch is Ownable2Step, ReentrancyGuard {
    using MerkleProof for bytes32[];

    // ============ 发射阶段 ============
    enum Phase {
        NotStarted,  // 未开始
        Whitelist,   // 白名单阶段
        Public,      // 公开发售
        Ended        // 已结束
    }

    Phase public currentPhase = Phase.NotStarted;

    // ============ 代币配置 ============
    IMemeTokenFairLaunch public memeToken;
    uint256 public tokensPerETH;       // 1 ETH 可购买的代币数量
    uint256 public tokensForSale;      // 用于发售的代币总量

    // ============ 资金目标 ============
    uint256 public softCap;            // 软顶（ETH，wei）
    uint256 public hardCap;            // 硬顶（ETH，wei）
    uint256 public totalRaised;        // 已筹集 ETH

    // ============ 时间线 ============
    uint256 public whitelistStart;
    uint256 public whitelistEnd;
    uint256 public publicStart;
    uint256 public publicEnd;

    // ============ 白名单 ============
    bytes32 public merkleRoot;
    mapping(address => bool) public whitelistClaimed;

    // ============ 申购限制 ============
    uint256 public maxPerWallet;
    mapping(address => uint256) public contributions;
    mapping(address => uint256) public tokensOwed;   // 待领取的代币数量

    // ============ 流动性配置 ============
    address public uniswapRouter;
    uint256 public liquidityETH;
    address public lpReceiver;

    // ============ 状态标记 ============
    bool public launchSucceeded;
    bool public refundEnabled;
    mapping(address => bool) public tokensClaimed;

    // ============ 事件 ============
    event WhitelistPurchased(address indexed buyer, uint256 ethAmount, uint256 tokenAmount);
    event PublicPurchased(address indexed buyer, uint256 ethAmount, uint256 tokenAmount);
    event PhaseChanged(Phase newPhase);
    event TokensClaimed(address indexed buyer, uint256 amount);
    event RefundClaimed(address indexed buyer, uint256 ethAmount);
    event LaunchSuccessful(address indexed token, uint256 totalRaised);
    event LaunchFailed(address indexed token, uint256 totalRaised);

    // ============ 构造函数 ============
    constructor(
        address _token,
        uint256 _tokensPerETH,
        uint256 _tokensForSale,
        uint256 _softCap,
        uint256 _hardCap,
        uint256 _maxPerWallet,
        uint256 _whitelistDuration,
        uint256 _publicDuration,
        bytes32 _merkleRoot,
        address _uniswapRouter,
        uint256 _liquidityETH,
        address _lpReceiver
    ) Ownable(msg.sender) {
        require(_token != address(0), "zero token");
        require(_tokensPerETH > 0, "zero rate");
        require(_softCap <= _hardCap, "soft > hard");
        require(_hardCap > 0, "zero hard cap");
        require(_maxPerWallet > 0, "zero max per wallet");
        require(_whitelistDuration > 0, "zero whitelist duration");
        require(_publicDuration > 0, "zero public duration");
        require(_lpReceiver != address(0), "zero lp receiver");
        require(_liquidityETH <= _hardCap, "liquidity > hard cap");

        memeToken = IMemeTokenFairLaunch(_token);
        tokensPerETH = _tokensPerETH;
        tokensForSale = _tokensForSale;
        softCap = _softCap;
        hardCap = _hardCap;
        maxPerWallet = _maxPerWallet;
        merkleRoot = _merkleRoot;
        uniswapRouter = _uniswapRouter;
        liquidityETH = _liquidityETH;
        lpReceiver = _lpReceiver;

        whitelistStart = block.timestamp;
        whitelistEnd = block.timestamp + _whitelistDuration;
        publicStart = whitelistEnd;
        publicEnd = publicStart + _publicDuration;

        currentPhase = Phase.Whitelist;
        emit PhaseChanged(Phase.Whitelist);
    }

    // ============ 核心购买逻辑 ============

    function buyWhitelist(uint256 _ethAmount, bytes32[] calldata _merkleProof)
        external
        payable
        nonReentrant
    {
        require(currentPhase == Phase.Whitelist, "not whitelist phase");
        require(block.timestamp < whitelistEnd, "whitelist ended");
        require(msg.value == _ethAmount, "value mismatch");
        require(_ethAmount > 0, "zero amount");

        require(!whitelistClaimed[msg.sender], "already claimed");
        bytes32 leaf = keccak256(abi.encodePacked(msg.sender));
        require(_merkleProof.verify(merkleRoot, leaf), "invalid proof");

        whitelistClaimed[msg.sender] = true;
        _processPurchase(msg.sender, _ethAmount);

        emit WhitelistPurchased(msg.sender, _ethAmount, _ethAmount * tokensPerETH);
    }

    function buyPublic() external payable nonReentrant {
        require(currentPhase == Phase.Whitelist || currentPhase == Phase.Public, "not open");
        require(block.timestamp >= publicStart, "public not started");
        require(block.timestamp < publicEnd, "public ended");
        require(msg.value > 0, "zero amount");

        if (currentPhase == Phase.Whitelist) {
            currentPhase = Phase.Public;
            emit PhaseChanged(Phase.Public);
        }

        _processPurchase(msg.sender, msg.value);

        emit PublicPurchased(msg.sender, msg.value, msg.value * tokensPerETH);
    }

    function _processPurchase(address _buyer, uint256 _ethAmount) private {
        require(totalRaised + _ethAmount <= hardCap, "exceeds hard cap");
        require(contributions[_buyer] + _ethAmount <= maxPerWallet, "exceeds wallet cap");

        contributions[_buyer] += _ethAmount;
        totalRaised += _ethAmount;

        uint256 tokenAmount = _ethAmount * tokensPerETH;
        tokensOwed[_buyer] += tokenAmount;
        require(tokensOwed[_buyer] <= tokensForSale, "exceeds sale supply");

        if (totalRaised >= hardCap) {
            _finalize(true);
        }
    }

    // ============ 发射结束处理 ============

    function finalize() external {
        require(currentPhase != Phase.Ended, "already ended");
        require(
            block.timestamp >= publicEnd || totalRaised >= hardCap,
            "not ended yet"
        );

        bool success = totalRaised >= softCap;
        _finalize(success);
    }

    function _finalize(bool _success) private {
        currentPhase = Phase.Ended;
        emit PhaseChanged(Phase.Ended);

        if (_success) {
            launchSucceeded = true;
            emit LaunchSuccessful(address(memeToken), totalRaised);
        } else {
            refundEnabled = true;
            emit LaunchFailed(address(memeToken), totalRaised);
        }
    }

    // ============ 代币领取（发射成功后）============

    function claimTokens() external nonReentrant {
        require(launchSucceeded, "launch not successful");
        require(!tokensClaimed[msg.sender], "already claimed");

        uint256 amount = tokensOwed[msg.sender];
        require(amount > 0, "nothing to claim");

        tokensClaimed[msg.sender] = true;
        require(memeToken.transfer(msg.sender, amount), "transfer failed");

        emit TokensClaimed(msg.sender, amount);
    }

    // ============ 退款（发射失败后）============

    function claimRefund() external nonReentrant {
        require(refundEnabled, "refund not enabled");
        uint256 amount = contributions[msg.sender];
        require(amount > 0, "nothing to refund");

        contributions[msg.sender] = 0;
        tokensOwed[msg.sender] = 0;

        payable(msg.sender).transfer(amount);
        emit RefundClaimed(msg.sender, amount);
    }

    // ============ 查询函数 ============

    function getCurrentPhase() external view returns (Phase) {
        if (currentPhase == Phase.Ended) return Phase.Ended;
        if (block.timestamp < whitelistStart) return Phase.NotStarted;
        if (block.timestamp < whitelistEnd) return Phase.Whitelist;
        if (block.timestamp < publicEnd) return Phase.Public;
        return Phase.Ended;
    }

    function getProgress() external view returns (uint256 raised, uint256 hard, uint256 soft) {
        return (totalRaised, hardCap, softCap);
    }

    // ============ Owner 功能 ============

    function withdrawUnsoldTokens() external onlyOwner {
        require(currentPhase == Phase.Ended, "not ended");
        require(launchSucceeded, "launch not successful");
        uint256 balance = memeToken.balanceOf(address(this));
        require(memeToken.transfer(owner(), balance), "transfer failed");
    }

    function withdrawRaisedETH() external onlyOwner {
        require(launchSucceeded, "launch not successful");
        uint256 amount = address(this).balance;
        payable(owner()).transfer(amount);
    }

    receive() external payable {}
}
