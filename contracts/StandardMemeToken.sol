// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract StandardMemeToken is ERC20, Ownable {
    // 最大供应量（不可超过，0 表示不限制）
    uint256 public maxSupply;

    event Mint(address indexed to, uint256 amount);
    event Burn(address indexed from, uint256 amount);

    constructor(
        string memory _name,
        string memory _symbol,
        uint256 _initialSupply,
        uint256 _maxSupply
    ) ERC20(_name, _symbol) Ownable(msg.sender) {
        maxSupply = _maxSupply;
        if (_initialSupply > 0) {
            _mint(msg.sender, _initialSupply * 10 ** decimals());
        }
    }

    function mint(address _to, uint256 _amount) public onlyOwner {
        uint256 amount = _amount * 10 ** decimals();
        if (maxSupply > 0) {
            require(totalSupply() + amount <= maxSupply * 10 ** decimals(), "exceeds max supply");
        }
        _mint(_to, amount);
        emit Mint(_to, amount);
    }

    function burn(uint256 _amount) public onlyOwner {
        uint256 amount = _amount * 10 ** decimals();
        _burn(msg.sender, amount);
        emit Burn(msg.sender, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 18;
    }
}
