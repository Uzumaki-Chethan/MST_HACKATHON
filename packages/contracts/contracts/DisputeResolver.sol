// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IDisputeResolver.sol";
import "./interfaces/IAttestedEscrow.sol";
import "./interfaces/INestPassport.sol";
import "./interfaces/INestRegistry.sol";
import "./core/NestErrors.sol";

/// @notice One arbiter pool for every module (SPEC §5.7): three arbiters per dispute, per-item
/// majority, a bond from the disputer, and replacement of arbiters who never vote.
contract DisputeResolver is IDisputeResolver, ReentrancyGuard, AccessControl {
    INestRegistry public immutable registry;
    INestPassport public immutable passport;

    uint128 public disputeBond;
    uint32 public votingWindow;
    address[] internal _pool;
    mapping(address => bool) internal _inPool;
    uint256 internal _cursor;

    uint256 public nextDisputeId = 1;
    mapping(uint256 => Dispute) internal _disputes;
    mapping(address => uint256[]) internal _disputesOf;
    mapping(address => mapping(uint256 => mapping(uint16 => uint256))) internal _disputeFor;
    mapping(address => uint256) public withdrawable;

    constructor(INestRegistry registry_, INestPassport passport_, uint128 bond, uint32 votingWindow_) {
        registry = registry_;
        passport = passport_;
        disputeBond = bond;
        votingWindow = votingWindow_;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // ================================================================= admin

    function addArbiter(address arbiter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (arbiter == address(0) || _inPool[arbiter]) revert BadInput();
        _inPool[arbiter] = true;
        _pool.push(arbiter);
        emit ArbiterAdded(arbiter);
    }

    function removeArbiter(address arbiter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!_inPool[arbiter]) revert BadInput();
        _inPool[arbiter] = false;
        for (uint256 i; i < _pool.length; i++) {
            if (_pool[i] == arbiter) {
                _pool[i] = _pool[_pool.length - 1];
                _pool.pop();
                break;
            }
        }
        emit ArbiterRemoved(arbiter);
    }

    function setParams(uint128 bond, uint32 votingWindow_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (votingWindow_ == 0) revert BadInput();
        disputeBond = bond;
        votingWindow = votingWindow_;
    }

    /// After the voting deadline, swap a slot that never voted for the next eligible pool member.
    function replaceArbiter(uint256 disputeId, uint8 slot) external onlyRole(DEFAULT_ADMIN_ROLE) {
        Dispute storage d = _disputes[disputeId];
        if (d.status != DisputeStatus.Open || d.escrow == address(0)) revert BadStatus();
        if (block.timestamp <= d.voteDeadline) revert WindowOpen();
        if (slot > 2) revert BadInput();
        if (d.votedBits & (1 << slot) != 0) revert BadStatus();

        address old = d.arbiters[slot];
        uint256 n = _pool.length;
        for (uint256 step; step < n; step++) {
            address a = _pool[(_cursor + step) % n];
            if (a == d.payer || a == d.payee || _onPanel(d, a)) continue;
            _cursor = (_cursor + step + 1) % n;
            d.arbiters[slot] = a;
            d.voteDeadline = uint64(block.timestamp) + votingWindow;
            _disputesOf[a].push(disputeId);
            emit ArbiterReplaced(disputeId, slot, old, a);
            return;
        }
        revert BadStatus(); // nobody eligible left in the pool
    }

    // ============================================================ disputes

    function openDispute(
        uint256 agreementId, uint16 trancheIdx, address payer, address payee, uint16 mask,
        uint128[] calldata amounts, address bondPayer
    ) external payable nonReentrant returns (uint256 disputeId) {
        if (!registry.isModule(msg.sender)) revert NotAuthorized();
        if (msg.value != (bondPayer == address(0) ? 0 : disputeBond)) revert BadAmount();
        if (mask == 0 || amounts.length == 0 || amounts.length > 16) revert BadInput();

        disputeId = nextDisputeId++;
        Dispute storage d = _disputes[disputeId];
        d.escrow = msg.sender;
        d.agreementId = agreementId;
        d.trancheIdx = trancheIdx;
        d.payer = payer;
        d.payee = payee;
        d.mask = mask;
        d.amounts = amounts;
        d.bond = uint128(msg.value);
        d.bondPayer = bondPayer;
        d.openedAt = uint64(block.timestamp);
        d.voteDeadline = uint64(block.timestamp) + votingWindow;

        // Round-robin from the cursor; parties to the agreement are never on their own panel (N13).
        uint256 n = _pool.length;
        uint256 picked;
        uint256 step;
        for (; step < n && picked < 3; step++) {
            address a = _pool[(_cursor + step) % n];
            if (a == payer || a == payee) continue;
            d.arbiters[picked++] = a;
            _disputesOf[a].push(disputeId);
        }
        if (picked < 3) revert BadStatus(); // not enough eligible arbiters
        _cursor = (_cursor + step) % n;
        _disputeFor[msg.sender][agreementId][trancheIdx] = disputeId;

        emit DisputeCreated(disputeId, msg.sender, agreementId, trancheIdx, mask, d.arbiters, d.bond, d.voteDeadline);
    }

    /// Per-item majority: an item is decided once two votes agree on it. When every disputed item
    /// is decided the dispute resolves and the escrow pays out in the same transaction.
    function vote(uint256 disputeId, uint16 upheldMask, bytes32 rationaleHash) external nonReentrant {
        Dispute storage d = _disputes[disputeId];
        if (d.status != DisputeStatus.Open || d.escrow == address(0)) revert BadStatus();
        uint8 slot = 3;
        for (uint8 s; s < 3; s++) if (d.arbiters[s] == msg.sender) slot = s;
        if (slot == 3) revert NotAuthorized();
        if (d.votedBits & (1 << slot) != 0) revert BadStatus();
        if (upheldMask & ~d.mask != 0) revert BadInput();

        d.votes[slot] = upheldMask;
        d.votedBits |= uint8(1 << slot);
        emit Voted(disputeId, msg.sender, upheldMask, rationaleHash);

        uint16 upheld;
        for (uint256 i; i < 16; i++) {
            uint16 bit = uint16(1 << i);
            if (d.mask & bit == 0) continue;
            uint256 up;
            uint256 down;
            for (uint8 s; s < 3; s++) {
                if (d.votedBits & (1 << s) == 0) continue;
                if (d.votes[s] & bit != 0) up++;
                else down++;
            }
            if (up >= 2) upheld |= bit;
            else if (down < 2) return; // this item is still undecided
        }
        _resolve(disputeId, upheld);
    }

    function _resolve(uint256 disputeId, uint16 upheld) internal {
        Dispute storage d = _disputes[disputeId];
        uint128 upheldValue;
        uint128 disputedValue;
        for (uint256 i; i < d.amounts.length; i++) {
            if (d.mask & (1 << i) == 0) continue;
            disputedValue += d.amounts[i];
            if (upheld & (1 << i) != 0) upheldValue += d.amounts[i];
        }
        bool payeeWon = uint256(upheldValue) * 2 >= disputedValue;
        d.status = DisputeStatus.Resolved;
        d.upheldMask = upheld;

        _rec(d.payee, payeeWon ? INestPassport.Stat.DisputesWon : INestPassport.Stat.DisputesLost, d.payer);
        _rec(d.payer, payeeWon ? INestPassport.Stat.DisputesLost : INestPassport.Stat.DisputesWon, d.payee);

        // Bond (N12): back to the disputer if they won, otherwise shared by the arbiters who voted.
        if (d.bond > 0) {
            if (!payeeWon) {
                _send(d.bondPayer, d.bond);
                emit BondSettled(disputeId, d.bondPayer, d.bond);
            } else {
                uint8 voters;
                for (uint8 s; s < 3; s++) if (d.votedBits & (1 << s) != 0) voters++;
                uint128 share = d.bond / voters;
                uint128 remainder = d.bond - share * voters;
                bool first = true;
                for (uint8 s; s < 3; s++) {
                    if (d.votedBits & (1 << s) == 0) continue;
                    uint128 amt = share + (first ? remainder : 0);
                    first = false;
                    _send(d.arbiters[s], amt);
                    emit BondSettled(disputeId, d.arbiters[s], amt);
                }
            }
        }

        IAttestedEscrow(d.escrow).onDisputeResolved(d.agreementId, upheld);
        emit DisputeResolved(disputeId, upheld, payeeWon, upheldValue, disputedValue);
    }

    function withdraw() external nonReentrant {
        uint256 amount = withdrawable[msg.sender];
        if (amount == 0) revert BadAmount();
        withdrawable[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert BadStatus();
    }

    // ================================================================ views

    function arbiterPool() external view returns (address[] memory) { return _pool; }
    function getDispute(uint256 disputeId) external view returns (Dispute memory) { return _disputes[disputeId]; }
    function disputesOf(address arbiter) external view returns (uint256[] memory) { return _disputesOf[arbiter]; }
    function disputeFor(address escrow, uint256 agreementId, uint16 trancheIdx) external view returns (uint256) {
        return _disputeFor[escrow][agreementId][trancheIdx];
    }

    // ============================================================= internal

    function _onPanel(Dispute storage d, address a) internal view returns (bool) {
        return d.arbiters[0] == a || d.arbiters[1] == a || d.arbiters[2] == a;
    }

    function _send(address to, uint256 amt) internal {
        if (amt == 0) return;
        (bool ok, ) = to.call{value: amt}("");
        if (!ok) {
            withdrawable[to] += amt;
            emit PayoutDeferred(to, amt);
        }
    }

    function _rec(address who, INestPassport.Stat s, address counterparty) internal {
        if (registry.isVerified(who) && (registry.isVerified(counterparty) || registry.isModule(counterparty))) {
            passport.record(who, s, 1);
        }
    }
}
