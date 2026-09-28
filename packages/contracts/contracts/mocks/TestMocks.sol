// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Test-only stand-ins. SocietyLedger and DisputeResolver get their real implementations in A2/A3;
// these expose just the calls RentalEscrow makes, so A1 can be tested on its own.

interface IEscrowResolvable {
    function onDisputeResolved(uint256 id, uint16 upheldMask) external;
}

contract MockLedger {
    struct FlatRow { uint256 societyId; address owner; uint128 maintenance; address tenant; }
    mapping(uint256 => FlatRow) public flats;
    mapping(uint256 => uint256) public maintenancePaid; // flatId => total
    mapping(uint256 => uint256) public deposited;       // societyId => total

    function setFlat(uint256 flatId, uint256 societyId, address owner, uint128 maintenance) external {
        flats[flatId] = FlatRow(societyId, owner, maintenance, address(0));
    }

    function flatInfo(uint256 flatId) external view returns (uint256, address, uint128) {
        FlatRow storage f = flats[flatId];
        return (f.societyId, f.owner, f.maintenance);
    }

    function setFlatTenant(uint256 flatId, address tenant) external {
        flats[flatId].tenant = tenant;
    }

    function payMaintenance(uint256 flatId) external payable {
        maintenancePaid[flatId] += msg.value;
    }

    function deposit(uint256 societyId) external payable {
        deposited[societyId] += msg.value;
    }
}

contract MockResolver {
    struct Opened { address escrow; uint256 agreementId; uint16 mask; address bondPayer; uint256 value; }
    uint128 public disputeBond;
    uint256 public count;
    mapping(uint256 => Opened) public opened;

    constructor(uint128 bond) {
        disputeBond = bond;
    }

    function openDispute(
        uint256 agreementId, uint16, address, address, uint16 mask, uint128[] calldata, address bondPayer
    ) external payable returns (uint256 id) {
        id = ++count;
        opened[id] = Opened(msg.sender, agreementId, mask, bondPayer, msg.value);
    }

    /// Stands in for the arbiters' majority.
    function resolve(uint256 disputeId, uint16 upheldMask) external {
        Opened storage o = opened[disputeId];
        IEscrowResolvable(o.escrow).onDisputeResolved(o.agreementId, upheldMask);
    }
}

/// A contract wallet: forwards calls, and can refuse payments or re-enter `withdraw` on receipt.
contract Actor {
    bool public rejectPayments;
    address public reenterTarget;
    uint256 public reentries;

    function setRejectPayments(bool v) external { rejectPayments = v; }
    function setReenter(address target) external { reenterTarget = target; }

    function exec(address target, bytes calldata data) external payable returns (bytes memory) {
        (bool ok, bytes memory ret) = target.call{value: msg.value}(data);
        if (!ok) {
            assembly { revert(add(ret, 32), mload(ret)) }
        }
        return ret;
    }

    receive() external payable {
        if (rejectPayments) revert("no thanks");
        if (reenterTarget != address(0) && reentries == 0) {
            reentries++;
            // Try to withdraw a second time while the first withdraw is still running.
            (bool ok, ) = reenterTarget.call(abi.encodeWithSignature("withdraw()"));
            ok; // expected to fail (nonReentrant); ignore
        }
    }
}
