// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/IAttestedEscrow.sol";
import "../interfaces/IDisputeResolver.sol";
import "../interfaces/INestPassport.sol";
import "../interfaces/INestRegistry.sol";
import "../interfaces/ISocietyLedger.sol";
import "./NestErrors.sol";

/// @notice The core primitive (SPEC §5.4): payee claims itemised amounts against escrowed money,
/// the AI attests support per item, the payer accepts or disputes per item, silence finalises
/// AI-backed items and escalates the rest, arbiters rule per item, and the contract pays out.
abstract contract AttestedEscrow is IAttestedEscrow, ReentrancyGuard, Pausable, AccessControl {
    uint256 internal constant MAX_ITEMS = 10;

    INestRegistry public immutable registry;
    INestPassport public immutable passport;
    IDisputeResolver public immutable resolver;

    uint256 public nextId = 1;
    mapping(uint256 => Agreement) internal _agreements;
    mapping(uint256 => mapping(uint16 => Tranche)) internal _tranches;
    mapping(uint256 => mapping(uint16 => Claim)) internal _claims;             // latest round only
    mapping(uint256 => mapping(uint16 => Attestation)) internal _attestations; // latest round only
    mapping(address => uint256[]) internal _agreementsOf;
    mapping(address => uint256) public withdrawable;

    constructor(INestRegistry registry_, INestPassport passport_, IDisputeResolver resolver_) {
        registry = registry_;
        passport = passport_;
        resolver = resolver_;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /// Pausing only blocks functions that create new agreements (SPEC §5.1). Exits always work.
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ================================================================ external

    function submitClaim(uint256 id, uint128[] calldata items, bytes32 evidenceHash) external nonReentrant {
        Agreement storage ag = _agreements[id];
        if (msg.sender != ag.payee) revert NotParty();
        if (ag.closed) revert BadStatus();
        uint16 idx = ag.current;
        Tranche storage t = _tranches[id][idx];
        if (t.status != TrancheStatus.Open) revert BadStatus();
        bool late = block.timestamp > t.claimDeadline;
        if (late && !_allowLateClaim()) revert WindowClosed();
        uint256 n = items.length;
        if (n == 0 || n > MAX_ITEMS || evidenceHash == bytes32(0)) revert BadInput();
        if (t.itemCaps.length > 0) {
            if (n != t.itemCaps.length) revert BadInput();
            for (uint256 i; i < n; i++) if (items[i] > t.itemCaps[i]) revert BadAmount();
        } else {
            uint256 sum;
            for (uint256 i; i < n; i++) sum += items[i];
            if (sum > t.amount) revert BadAmount();
        }

        Claim storage c = _claims[id][idx];
        delete _claims[id][idx];
        delete _attestations[id][idx];
        c.items = items;
        c.evidenceHash = evidenceHash;
        c.submittedAt = uint64(block.timestamp);
        c.round = t.round;
        c.late = late;
        t.status = TrancheStatus.Claimed;
        emit ClaimSubmitted(id, idx, t.round, items, evidenceHash, late);
    }

    function attest(uint256 id, uint8 round, bytes32 reportHash, uint128[] calldata supported, uint8 score)
        external
        nonReentrant
    {
        if (!registry.isAttestor(msg.sender)) revert NotAuthorized();
        uint16 idx = _agreements[id].current;
        Tranche storage t = _tranches[id][idx];
        if (t.status != TrancheStatus.Claimed) revert BadStatus();
        if (round != t.round) revert BadInput();
        Attestation storage a = _attestations[id][idx];
        if (a.attestedAt != 0) revert BadStatus();
        if (supported.length != _claims[id][idx].items.length || score > 100) revert BadInput();
        a.reportHash = reportHash;
        a.supported = supported;
        a.score = score;
        a.attestedAt = uint64(block.timestamp);
        a.attestor = msg.sender;
        emit Attested(id, idx, round, reportHash, supported, score, msg.sender);
    }

    function respond(uint256 id, uint16 disputedMask) external payable nonReentrant {
        Agreement storage ag = _agreements[id];
        if (msg.sender != ag.payer) revert NotParty();
        uint16 idx = ag.current;
        Tranche storage t = _tranches[id][idx];
        Claim storage c = _claims[id][idx];
        if (t.status != TrancheStatus.Claimed) revert BadStatus();
        if (block.timestamp > c.submittedAt + ag.responseWindow) revert WindowClosed();
        uint16 all = _allItems(c);
        if (disputedMask & ~all != 0) revert BadInput();

        emit Responded(id, idx, disputedMask);
        _rec(ag.payer, INestPassport.Stat.PromptDecisions, 1, ag.payee);
        if (disputedMask == 0) {
            if (msg.value != 0) revert BadAmount();
            _award(id, all);
            _settle(id);
        } else {
            if (msg.value != resolver.disputeBond()) revert BadAmount();
            _award(id, all & ~disputedMask);
            _escalate(id, disputedMask, ag.payer, msg.value);
        }
    }

    function finalizeAfterSilence(uint256 id) external nonReentrant {
        Agreement storage ag = _agreements[id];
        uint16 idx = ag.current;
        Tranche storage t = _tranches[id][idx];
        Claim storage c = _claims[id][idx];
        if (t.status != TrancheStatus.Claimed) revert BadStatus();
        if (block.timestamp <= c.submittedAt + ag.responseWindow) revert WindowOpen();

        uint16 b = backedMask(id);
        uint16 all = _allItems(c);
        uint16 u = _nonZeroItems(c) & ~b;
        emit SilenceFinalized(id, idx, b, u);
        _rec(ag.payer, INestPassport.Stat.SilentDecisions, 1, ag.payee);
        _award(id, all & ~u);
        if (u == 0) _settle(id);
        else _escalate(id, u, address(0), 0);
    }

    function finalizeNoClaim(uint256 id) external nonReentrant {
        if (!_canFinalizeNoClaim(id, msg.sender)) revert NotAuthorized();
        Tranche storage t = _tranches[id][_agreements[id].current];
        if (t.status != TrancheStatus.Open) revert BadStatus();
        if (block.timestamp <= t.claimDeadline) revert WindowOpen();
        _refundTranche(id);
    }

    function onDisputeResolved(uint256 id, uint16 upheldMask) external nonReentrant {
        if (msg.sender != address(resolver)) revert NotAuthorized();
        uint16 idx = _agreements[id].current;
        if (_tranches[id][idx].status != TrancheStatus.Disputed) revert BadStatus();
        uint16 disputed = _claims[id][idx].disputedMask;
        uint16 upheld = upheldMask & disputed;
        _award(id, upheld);
        _afterDispute(id, upheld, disputed);
        _settle(id);
    }

    function withdraw() external nonReentrant {
        uint256 amount = withdrawable[msg.sender];
        if (amount == 0) revert BadAmount();
        withdrawable[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert BadStatus();
        emit Withdrawn(msg.sender, amount);
    }

    // =================================================================== views

    function getAgreement(uint256 id) external view returns (Agreement memory) { return _agreements[id]; }
    function getTranche(uint256 id, uint16 idx) external view returns (Tranche memory) { return _tranches[id][idx]; }
    function getClaim(uint256 id, uint16 idx) external view returns (Claim memory) { return _claims[id][idx]; }
    function getAttestation(uint256 id, uint16 idx) external view returns (Attestation memory) {
        return _attestations[id][idx];
    }
    function agreementsOf(address user) external view returns (uint256[] memory) { return _agreementsOf[user]; }

    /// Backing rule (SPEC §5.4): zero, within contract-computed support, or within an attested
    /// amount for this round with a high enough score.
    function isBacked(uint256 id, uint8 item) public view returns (bool) {
        Agreement storage ag = _agreements[id];
        Claim storage c = _claims[id][ag.current];
        if (item >= c.items.length) return false;
        uint128 v = c.items[item];
        if (v == 0) return true;
        if (v <= _systemSupported(id, item)) return true;
        Attestation storage a = _attestations[id][ag.current];
        return a.attestedAt != 0 && v <= a.supported[item] && (ag.minScore == 0 || a.score >= ag.minScore);
    }

    function backedMask(uint256 id) public view returns (uint16 mask) {
        uint256 n = _claims[id][_agreements[id].current].items.length;
        for (uint256 i; i < n; i++) if (isBacked(id, uint8(i))) mask |= uint16(1 << i);
    }

    // ====================================================== internal API (children)

    function _createAgreement(
        address payer, address payee, uint256 payerRef, uint32 responseWindow, uint8 minScore, uint8 maxRounds
    ) internal returns (uint256 id) {
        id = nextId++;
        Agreement storage ag = _agreements[id];
        ag.payer = payer;
        ag.payee = payee;
        ag.payerRef = payerRef;
        ag.responseWindow = responseWindow;
        ag.minScore = minScore;
        ag.maxRounds = maxRounds;
        ag.createdAt = uint64(block.timestamp);
        _agreementsOf[payer].push(id);
        _agreementsOf[payee].push(id);
    }

    function _addTranche(
        uint256 id, uint128 amount, uint128 advance, uint128[] memory itemCaps, uint32 duration, bytes32 specHash
    ) internal returns (uint16 idx) {
        idx = _agreements[id].trancheCount++;
        Tranche storage t = _tranches[id][idx];
        t.amount = amount;
        t.advance = advance;
        for (uint256 i; i < itemCaps.length; i++) t.itemCaps.push(itemCaps[i]);
        t.duration = duration;
        t.specHash = specHash;
    }

    function _openTranche(uint256 id, uint16 idx, uint64 claimDeadline) internal {
        Tranche storage t = _tranches[id][idx];
        if (t.status != TrancheStatus.Pending) revert BadStatus();
        t.status = TrancheStatus.Open;
        t.openedAt = uint64(block.timestamp);
        t.claimDeadline = claimDeadline;
        t.released = t.advance;
        emit TrancheOpened(id, idx, claimDeadline, t.advance);
        _send(_agreements[id].payee, t.advance);
    }

    function _refundTranche(uint256 id) internal {
        uint16 idx = _agreements[id].current;
        Tranche storage t = _tranches[id][idx];
        uint128 amt = t.amount - t.released - t.refunded;
        t.refunded += amt;
        t.status = TrancheStatus.Refunded;
        emit TrancheRefunded(id, idx, amt);
        _payPayer(id, amt);
        _afterTrancheClosed(id, idx, false);
    }

    function _payPayer(uint256 id, uint256 amt) internal {
        if (amt == 0) return;
        Agreement storage ag = _agreements[id];
        if (ag.payerRef != 0) ISocietyLedger(ag.payer).deposit{value: amt}(ag.payerRef);
        else _send(ag.payer, amt);
    }

    /// Push payment with a pull fallback: a failing recipient never blocks a settlement.
    function _send(address to, uint256 amt) internal {
        if (amt == 0) return;
        (bool ok, ) = to.call{value: amt}("");
        if (!ok) {
            withdrawable[to] += amt;
            emit PayoutDeferred(to, amt);
        }
    }

    /// Reputation only counts when both sides are verified (or the counterparty is a module).
    function _rec(address who, INestPassport.Stat s, uint32 amt, address counterparty) internal {
        if (amt == 0) return;
        if (registry.isVerified(who) && (registry.isVerified(counterparty) || registry.isModule(counterparty))) {
            passport.record(who, s, amt);
        }
    }

    // ================================================================ settlement

    function _award(uint256 id, uint16 mask) internal {
        uint16 idx = _agreements[id].current;
        Tranche storage t = _tranches[id][idx];
        Claim storage c = _claims[id][idx];
        c.awardedMask |= mask;
        (uint128 aw, uint128 ct) = _sums(c);

        uint128 payeeTarget = _max(aw, t.advance);
        uint128 payeeDelta = payeeTarget > t.released ? payeeTarget - t.released : 0;
        t.released += payeeDelta;
        uint128 unclaimed = t.amount - _max(ct, t.advance);
        uint128 payerNow = unclaimed > t.refunded ? unclaimed - t.refunded : 0;
        t.refunded += payerNow;

        emit ItemsAwarded(id, idx, mask, payeeDelta, payerNow);
        _send(_agreements[id].payee, payeeDelta);
        _payPayer(id, payerNow);
    }

    function _settle(uint256 id) internal {
        uint16 idx = _agreements[id].current;
        Tranche storage t = _tranches[id][idx];
        (uint128 aw, ) = _sums(_claims[id][idx]);

        uint128 payeeTarget = _max(aw, t.advance);
        uint128 payeeDelta = payeeTarget > t.released ? payeeTarget - t.released : 0;
        t.released += payeeDelta;
        uint128 payerDelta = t.amount - t.released - t.refunded;
        t.refunded += payerDelta;
        t.status = TrancheStatus.Settled;

        emit TrancheSettled(id, idx, t.released, t.refunded);
        _send(_agreements[id].payee, payeeDelta);
        _payPayer(id, payerDelta);
        _afterTrancheClosed(id, idx, true);
    }

    function _escalate(uint256 id, uint16 mask, address bondPayer, uint256 value) internal {
        Agreement storage ag = _agreements[id];
        uint16 idx = ag.current;
        Claim storage c = _claims[id][idx];
        c.disputedMask = mask;
        _tranches[id][idx].status = TrancheStatus.Disputed;
        uint256 disputeId =
            resolver.openDispute{value: value}(id, idx, ag.payer, ag.payee, mask, c.items, bondPayer);
        c.disputeId = disputeId;
        emit DisputeEscalated(id, idx, disputeId, mask, bondPayer == address(0));
    }

    /// (sum of awarded items, sum of all claimed items)
    function _sums(Claim storage c) internal view returns (uint128 aw, uint128 ct) {
        for (uint256 i; i < c.items.length; i++) {
            ct += c.items[i];
            if (c.awardedMask & (1 << i) != 0) aw += c.items[i];
        }
    }

    function _allItems(Claim storage c) internal view returns (uint16) {
        return uint16((1 << c.items.length) - 1);
    }

    function _nonZeroItems(Claim storage c) internal view returns (uint16 mask) {
        for (uint256 i; i < c.items.length; i++) if (c.items[i] > 0) mask |= uint16(1 << i);
    }

    function _max(uint128 a, uint128 b) internal pure returns (uint128) { return a > b ? a : b; }

    function _popcount(uint16 x) internal pure returns (uint32 n) {
        while (x != 0) { n += x & 1; x >>= 1; }
    }

    // ==================================================================== hooks

    function _systemSupported(uint256, uint256) internal view virtual returns (uint128) { return 0; }
    function _allowLateClaim() internal view virtual returns (bool);
    function _canFinalizeNoClaim(uint256 id, address caller) internal view virtual returns (bool);
    function _afterTrancheClosed(uint256 id, uint16 idx, bool settled) internal virtual;
    function _afterDispute(uint256 id, uint16 upheldMask, uint16 disputedMask) internal virtual;
}
