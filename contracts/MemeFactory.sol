// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "./MemeToken.sol";

contract MemeFactory is Ownable2Step {
    // ============ 代币创建参数结构 ============
    struct TokenParams {
        string name;
        string symbol;
        uint256 totalSupply;
        address marketingWallet;
        address teamWallet;
        uint256 buyTax;
        uint256 sellTax;
    }

    // ============ 创建费用 ============
    uint256 public creationFee;
    uint256 public constant MAX_CREATION_FEE = 10 ether;

    // ============ 代币追踪 ============
    address[] public allTokens;
    mapping(address => address[]) public creatorTokens;
    mapping(address => TokenParams) public tokenParams;

    // ============ 参数限制 ============
    uint256 public constant MAX_NAME_LENGTH = 32;
    uint256 public constant MAX_SYMBOL_LENGTH = 8;
    uint256 public constant MIN_SUPPLY = 1_000;
    uint256 public constant MAX_SUPPLY = 1_000_000_000_000;

    // ============ 事件 ============
    event TokenCreated(
        address indexed tokenAddress,
        address indexed creator,
        string name,
        string symbol,
        uint256 totalSupply,
        uint256 buyTax,
        uint256 sellTax,
        uint256 index
    );
    event CreationFeeUpdated(uint256 oldFee, uint256 newFee);
    event FeeWithdrawn(address indexed to, uint256 amount);

    // ============ 构造函数 ============
    constructor(uint256 _creationFee) Ownable(msg.sender) {
        require(_creationFee <= MAX_CREATION_FEE, "fee too high");
        creationFee = _creationFee;
    }

    // ============ 核心：创建代币 ============

    function createToken(TokenParams calldata _params) external payable returns (address) {
        require(msg.value >= creationFee, "insufficient creation fee");

        // 参数校验
        bytes memory nameBytes = bytes(_params.name);
        require(nameBytes.length > 0 && nameBytes.length <= MAX_NAME_LENGTH, "invalid name length");

        bytes memory symbolBytes = bytes(_params.symbol);
        require(symbolBytes.length > 0 && symbolBytes.length <= MAX_SYMBOL_LENGTH, "invalid symbol length");

        require(
            _params.totalSupply >= MIN_SUPPLY && _params.totalSupply <= MAX_SUPPLY,
            "supply out of range"
        );

        require(_params.marketingWallet != address(0), "zero marketing wallet");
        require(_params.teamWallet != address(0), "zero team wallet");
        require(_params.buyTax <= 2500 && _params.sellTax <= 2500, "tax too high");

        // 创建代币
        MemeToken newToken = new MemeToken(
            _params.name,
            _params.symbol,
            _params.totalSupply,
            _params.marketingWallet,
            _params.teamWallet,
            _params.buyTax,
            _params.sellTax
        );

        // 将所有权转移给创建者
        newToken.transferOwnership(msg.sender);

        address tokenAddr = address(newToken);

        // 记录
        allTokens.push(tokenAddr);
        creatorTokens[msg.sender].push(tokenAddr);
        tokenParams[tokenAddr] = _params;

        emit TokenCreated(
            tokenAddr,
            msg.sender,
            _params.name,
            _params.symbol,
            _params.totalSupply,
            _params.buyTax,
            _params.sellTax,
            allTokens.length - 1
        );

        return tokenAddr;
    }

    // ============ 查询函数 ============

    function totalTokens() external view returns (uint256) {
        return allTokens.length;
    }

    function getTokensByCreator(address _creator) external view returns (address[] memory) {
        return creatorTokens[_creator];
    }

    function getTokenCountByCreator(address _creator) external view returns (uint256) {
        return creatorTokens[_creator].length;
    }

    function getTokensPaginated(uint256 _offset, uint256 _limit)
        external
        view
        returns (address[] memory tokens, uint256 total)
    {
        total = allTokens.length;
        if (_offset >= total) {
            return (new address[](0), total);
        }

        uint256 end = _offset + _limit;
        if (end > total) {
            end = total;
        }
        uint256 size = end - _offset;

        tokens = new address[](size);
        for (uint256 i = 0; i < size; i++) {
            tokens[i] = allTokens[_offset + i];
        }
    }

    // ============ 费用管理 ============

    function setCreationFee(uint256 _newFee) external onlyOwner {
        require(_newFee <= MAX_CREATION_FEE, "fee too high");
        uint256 oldFee = creationFee;
        creationFee = _newFee;
        emit CreationFeeUpdated(oldFee, _newFee);
    }

    function withdrawFees() external onlyOwner {
        uint256 amount = address(this).balance;
        payable(owner()).transfer(amount);
        emit FeeWithdrawn(owner(), amount);
    }
}
