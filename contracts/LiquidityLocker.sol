// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title LiquidityLocker
 * @notice 流动性锁仓合约——将 LP Token 锁定到指定时间，到期前不可提取
 *
 * 核心功能：
 * - lock: 锁定 LP Token，设定解锁时间和受益人
 * - unlock: 到期后提取锁定的 LP Token
 * - extendLock: 延长锁仓时间（只能延长不能缩短）
 * - 查询函数: getLockInfo / getLocksByToken / getLocksByBeneficiary / isTokenLocked
 *
 * 安全属性：
 * - unlock 双重权限：受益人或 owner 均可提取
 * - extendLock 仅受益人或 owner 可调用
 * - LockRecord.withdrawn 防止重复提取
 * - 锁仓时长上限 3650 天（10 年）防止误操作
 */
contract LiquidityLocker is Ownable2Step {

    // ============ 锁仓记录结构体 ============
    struct LockRecord {
        address token;           // LP Token 地址（UniswapV2Pair 地址）
        uint256 amount;          // 锁仓数量
        uint256 unlockTime;      // 解锁时间戳（Unix timestamp）
        address beneficiary;     // 解锁后的受益人
        bool withdrawn;          // 是否已提取
    }

    // ============ 存储 ============
    LockRecord[] public locks;

    // ============ 事件 ============
    event LiquidityLocked(
        uint256 indexed lockId,
        address indexed token,
        address indexed beneficiary,
        uint256 amount,
        uint256 unlockTime
    );

    event LiquidityUnlocked(
        uint256 indexed lockId,
        address indexed token,
        address indexed beneficiary,
        uint256 amount
    );

    event LockExtended(
        uint256 indexed lockId,
        uint256 oldUnlockTime,
        uint256 newUnlockTime
    );

    // ============ 构造函数 ============
    constructor() Ownable(msg.sender) {}

    // ============ 核心：锁定流动性 ============

    /**
     * @notice 锁定 LP Token 到合约中
     * @param _token LP Token 地址
     * @param _amount 锁仓数量
     * @param _lockDays 锁仓天数（1 ~ 3650）
     * @param _beneficiary 解锁后的受益人
     * @return lockId 锁仓记录 ID
     */
    function lock(
        address _token,
        uint256 _amount,
        uint256 _lockDays,
        address _beneficiary
    ) public returns (uint256 lockId) {
        require(_token != address(0), "zero token");
        require(_amount > 0, "zero amount");
        require(_lockDays > 0, "zero lock days");
        require(_lockDays <= 3650, "lock too long");
        require(_beneficiary != address(0), "zero beneficiary");

        uint256 unlockTime = block.timestamp + (_lockDays * 1 days);

        lockId = locks.length;

        locks.push(LockRecord({
            token: _token,
            amount: _amount,
            unlockTime: unlockTime,
            beneficiary: _beneficiary,
            withdrawn: false
        }));

        // 将 LP Token 从调用者转入本合约
        IERC20(_token).transferFrom(msg.sender, address(this), _amount);

        emit LiquidityLocked(lockId, _token, _beneficiary, _amount, unlockTime);
    }

    /**
     * @notice 批量锁仓——一次性锁定多个 LP Token
     * @param _tokens LP Token 地址数组
     * @param _amounts 对应数量数组
     * @param _lockDaysArray 对应锁仓天数数组
     * @param _beneficiaries 对应受益人数组
     * @return lockIds 锁仓记录 ID 数组
     */
    function batchLock(
        address[] calldata _tokens,
        uint256[] calldata _amounts,
        uint256[] calldata _lockDaysArray,
        address[] calldata _beneficiaries
    ) external returns (uint256[] memory lockIds) {
        uint256 len = _tokens.length;
        require(
            len == _amounts.length &&
            len == _lockDaysArray.length &&
            len == _beneficiaries.length,
            "length mismatch"
        );

        lockIds = new uint256[](len);
        for (uint256 i = 0; i < len; i++) {
            lockIds[i] = lock(_tokens[i], _amounts[i], _lockDaysArray[i], _beneficiaries[i]);
        }
    }

    // ============ 解锁 ============

    /**
     * @notice 到期后提取锁定的 LP Token
     * @param _lockId 锁仓记录 ID
     */
    function unlock(uint256 _lockId) external {
        require(_lockId < locks.length, "invalid lock id");

        LockRecord storage record = locks[_lockId];
        require(!record.withdrawn, "already withdrawn");
        require(block.timestamp >= record.unlockTime, "still locked");
        require(
            msg.sender == record.beneficiary || msg.sender == owner(),
            "not authorized"
        );

        record.withdrawn = true;

        IERC20(record.token).transfer(record.beneficiary, record.amount);

        emit LiquidityUnlocked(_lockId, record.token, record.beneficiary, record.amount);
    }

    // ============ 延长锁仓 ============

    /**
     * @notice 延长锁仓时间（只能延长，不能缩短）
     * @param _lockId 锁仓记录 ID
     * @param _additionalDays 额外增加的天数
     */
    function extendLock(uint256 _lockId, uint256 _additionalDays) external {
        require(_lockId < locks.length, "invalid lock id");

        LockRecord storage record = locks[_lockId];
        require(!record.withdrawn, "already withdrawn");
        require(
            msg.sender == record.beneficiary || msg.sender == owner(),
            "not authorized"
        );
        require(_additionalDays > 0, "zero additional days");

        uint256 oldUnlockTime = record.unlockTime;
        uint256 newUnlockTime = oldUnlockTime + (_additionalDays * 1 days);
        require(newUnlockTime > oldUnlockTime, "overflow");

        record.unlockTime = newUnlockTime;

        emit LockExtended(_lockId, oldUnlockTime, newUnlockTime);
    }

    // ============ 查询函数 ============

    function totalLocks() external view returns (uint256) {
        return locks.length;
    }

    function getLockInfo(uint256 _lockId) external view returns (LockRecord memory) {
        require(_lockId < locks.length, "invalid lock id");
        return locks[_lockId];
    }

    function getRemainingLockTime(uint256 _lockId) external view returns (uint256) {
        if (_lockId >= locks.length) return 0;

        LockRecord storage record = locks[_lockId];
        if (record.withdrawn) return 0;
        if (block.timestamp >= record.unlockTime) return 0;

        return record.unlockTime - block.timestamp;
    }

    function getLocksByToken(address _token) external view returns (uint256[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < locks.length; i++) {
            if (locks[i].token == _token) {
                count++;
            }
        }

        uint256[] memory result = new uint256[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < locks.length; i++) {
            if (locks[i].token == _token) {
                result[index] = i;
                index++;
            }
        }

        return result;
    }

    function getLocksByBeneficiary(address _beneficiary) external view returns (uint256[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < locks.length; i++) {
            if (locks[i].beneficiary == _beneficiary) {
                count++;
            }
        }

        uint256[] memory result = new uint256[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < locks.length; i++) {
            if (locks[i].beneficiary == _beneficiary) {
                result[index] = i;
                index++;
            }
        }

        return result;
    }

    function isTokenLocked(address _token) external view returns (bool) {
        for (uint256 i = 0; i < locks.length; i++) {
            if (locks[i].token == _token && !locks[i].withdrawn) {
                return true;
            }
        }
        return false;
    }
}
