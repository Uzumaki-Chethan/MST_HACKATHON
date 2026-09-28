// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./core/AttestedEscrow.sol";
import "./interfaces/IMilestoneEscrow.sol";

/// @notice BuildSafe (SPEC §5.6). Payer = homeowner (or SocietyLedger for society works),
/// payee = contractor, one tranche per milestone, each with a materials advance paid when it opens.
contract MilestoneEscrow is AttestedEscrow, IMilestoneEscrow {
    uint256 internal constant MAX_MILESTONES = 12;
    uint16 internal constant MAX_ADVANCE_BPS = 4000;

    mapping(uint256 => Project) internal _projects;
    mapping(uint256 => mapping(uint16 => string)) internal _titles;
    mapping(uint256 => mapping(uint16 => ChangeOrder)) internal _changeOrders;
    // What a change order was priced against when proposed, so a stale one cannot be approved.
    mapping(uint256 => mapping(uint16 => bool)) internal _coAppends;
    mapping(uint256 => mapping(uint16 => uint128)) internal _coBaseAmount;

    constructor(INestRegistry registry_, INestPassport passport_, IDisputeResolver resolver_)
        AttestedEscrow(registry_, passport_, resolver_)
    {}

    // ============================================================ create / accept

    function createProject(ProjectInput calldata p, MilestoneInput[] calldata ms)
        external payable whenNotPaused nonReentrant returns (uint256 id)
    {
        uint256 n = ms.length;
        if (n == 0 || n > MAX_MILESTONES) revert BadInput();
        if (p.minScore == 0 || p.minScore > 100 || p.maxRounds > 3) revert BadInput();
        if (p.responseWindow == 0 || p.reworkWindow == 0 || p.specHash == bytes32(0)) revert BadInput();
        if (p.contractor == msg.sender || !registry.isRegistered(p.contractor)) revert BadInput();
        // Society works: only a module (the SocietyLedger) may fund a project on a society's behalf.
        if (p.payerRef != 0 && !registry.isModule(msg.sender)) revert NotAuthorized();

        uint256 total;
        for (uint256 i; i < n; i++) total += _validate(ms[i]);
        if (msg.value != total) revert BadAmount();

        id = _createAgreement(msg.sender, p.contractor, p.payerRef, p.responseWindow, p.minScore, p.maxRounds);
        for (uint256 i; i < n; i++) _appendMilestone(id, ms[i]);

        Project storage pr = _projects[id];
        pr.status = ProjectStatus.AwaitingAcceptance;
        pr.specHash = p.specHash;
        pr.reworkWindow = p.reworkWindow;
        pr.flatId = p.flatId;

        emit AgreementCreated(id, msg.sender, p.contractor, uint16(n), total);
        emit ProjectCreated(id, msg.sender, p.contractor, total, uint16(n), p.specHash);
    }

    function acceptProject(uint256 id) external nonReentrant {
        Project storage pr = _projects[id];
        if (msg.sender != _agreements[id].payee) revert NotParty();
        if (pr.status != ProjectStatus.AwaitingAcceptance) revert BadStatus();
        pr.status = ProjectStatus.Active;
        pr.acceptedAt = uint64(block.timestamp);
        emit ProjectAccepted(id, msg.sender);
        _openTranche(id, 0, uint64(block.timestamp) + _tranches[id][0].duration); // pays the first advance
    }

    function cancelUnaccepted(uint256 id) external nonReentrant {
        Project storage pr = _projects[id];
        Agreement storage ag = _agreements[id];
        if (msg.sender != ag.payer) revert NotParty();
        if (pr.status != ProjectStatus.AwaitingAcceptance) revert BadStatus();
        pr.status = ProjectStatus.Cancelled;
        ag.closed = true;
        uint128 refund = _refundFrom(id, 0);
        emit ProjectCancelled(id, refund, false);
        _payPayer(id, refund);
    }

    // ================================================================== rework

    function requestRework(uint256 id, uint16 mask, bytes32 reasonHash) external nonReentrant {
        Agreement storage ag = _agreements[id];
        if (msg.sender != ag.payer) revert NotParty();
        uint16 idx = ag.current;
        Tranche storage t = _tranches[id][idx];
        Claim storage c = _claims[id][idx];
        if (t.status != TrancheStatus.Claimed) revert BadStatus();
        if (block.timestamp > c.submittedAt + ag.responseWindow) revert WindowClosed();
        if (t.round >= ag.maxRounds) revert BadStatus();
        if (mask == 0 || mask & ~_allItems(c) != 0) revert BadInput();

        t.round += 1;
        t.status = TrancheStatus.Open;
        t.claimDeadline = uint64(block.timestamp) + _projects[id].reworkWindow;
        emit ReworkRequested(id, idx, t.round, mask, reasonHash, t.claimDeadline);
        _rec(ag.payer, INestPassport.Stat.PromptDecisions, 1, ag.payee);
    }

    // ============================================================ change orders

    function proposeChangeOrder(uint256 id, uint16 target, MilestoneInput calldata m, bytes32 reasonHash)
        external payable nonReentrant returns (uint16 coId)
    {
        Agreement storage ag = _agreements[id];
        Project storage pr = _projects[id];
        bool byPayer = msg.sender == ag.payer;
        if (!byPayer && msg.sender != ag.payee) revert NotParty();
        if (pr.status != ProjectStatus.Active) revert BadStatus();
        if (ag.payerRef != 0) revert NotAuthorized(); // society projects: P2
        if (!_targetOpenForChange(id, target)) revert BadInput();

        uint128 base = _oldAmount(id, target);
        int256 delta = int256(uint256(_validate(m))) - int256(uint256(base));
        uint128 funded;
        if (byPayer && delta > 0) {
            if (msg.value != uint256(delta)) revert BadAmount();
            funded = uint128(uint256(delta));
        } else if (msg.value != 0) {
            revert BadAmount();
        }

        coId = pr.changeOrderCount++;
        ChangeOrder storage co = _changeOrders[id][coId];
        co.proposer = msg.sender;
        co.target = target;
        co.reasonHash = reasonHash;
        co.budgetDelta = delta;
        co.fundedByProposer = funded;
        _copyMilestone(co.milestone, m);
        _coAppends[id][coId] = target == ag.trancheCount;
        _coBaseAmount[id][coId] = base;
        emit ChangeOrderProposed(id, coId, msg.sender, target, delta, reasonHash);
    }

    function approveChangeOrder(uint256 id, uint16 coId) external payable nonReentrant {
        Agreement storage ag = _agreements[id];
        ChangeOrder storage co = _changeOrders[id][coId];
        if (coId >= _projects[id].changeOrderCount || co.executed || co.rejected) revert BadStatus();
        address counterparty = co.proposer == ag.payer ? ag.payee : ag.payer;
        if (msg.sender != counterparty) revert NotParty();
        if (_projects[id].status != ProjectStatus.Active || !_targetOpenForChange(id, co.target)) revert BadStatus();
        // Still the same slot it was priced against: an append is still the next slot, a modify still has the same amount.
        if (_coAppends[id][coId] != (co.target == ag.trancheCount)) revert BadStatus();
        if (!_coAppends[id][coId] && _tranches[id][co.target].amount != _coBaseAmount[id][coId]) revert BadStatus();

        int256 delta = co.budgetDelta;
        if (msg.sender == ag.payer && delta > 0) {
            if (msg.value != uint256(delta)) revert BadAmount();
        } else if (msg.value != 0) {
            revert BadAmount();
        }
        co.executed = true;

        MilestoneInput memory m = co.milestone;
        uint128 amount = _sum(m.lineItems);
        uint128 advance = uint128(uint256(amount) * m.advanceBps / 10000);
        if (co.target < ag.trancheCount) {
            Tranche storage t = _tranches[id][co.target];
            t.amount = amount;
            t.advance = advance;
            delete t.itemCaps;
            for (uint256 i; i < m.lineItems.length; i++) t.itemCaps.push(m.lineItems[i]);
            t.duration = m.duration;
            t.specHash = m.specHash;
        } else {
            _addTranche(id, amount, advance, m.lineItems, m.duration, m.specHash);
        }
        _titles[id][co.target] = m.title;
        emit MilestoneDefined(id, co.target, m.title, amount, advance, m.duration, m.specHash);
        emit ChangeOrderApproved(id, coId, msg.sender);
        if (delta < 0) _payPayer(id, uint256(-delta));
    }

    function rejectChangeOrder(uint256 id, uint16 coId) external nonReentrant {
        Agreement storage ag = _agreements[id];
        ChangeOrder storage co = _changeOrders[id][coId];
        if (coId >= _projects[id].changeOrderCount || co.executed || co.rejected) revert BadStatus();
        if (msg.sender != ag.payer && msg.sender != ag.payee) revert NotParty(); // counterparty rejects, proposer withdraws
        co.rejected = true;
        uint128 refund = co.fundedByProposer;
        co.fundedByProposer = 0;
        emit ChangeOrderRejected(id, coId, msg.sender);
        _payPayer(id, refund);
    }

    // =================================================================== views

    function getProject(uint256 id) external view returns (Project memory) { return _projects[id]; }
    function milestoneTitle(uint256 id, uint16 idx) external view returns (string memory) { return _titles[id][idx]; }
    function getChangeOrder(uint256 id, uint16 coId) external view returns (ChangeOrder memory) {
        return _changeOrders[id][coId];
    }

    // ================================================================ internal

    /// Checks a milestone input and returns its amount (sum of line items).
    function _validate(MilestoneInput calldata m) internal pure returns (uint128 amount) {
        uint256 n = m.lineItems.length;
        if (n == 0 || n > MAX_ITEMS) revert BadInput();
        if (m.advanceBps > MAX_ADVANCE_BPS || m.duration == 0 || m.specHash == bytes32(0)) revert BadInput();
        for (uint256 i; i < n; i++) {
            if (m.lineItems[i] == 0) revert BadAmount();
            amount += m.lineItems[i];
        }
    }

    function _appendMilestone(uint256 id, MilestoneInput calldata m) internal {
        uint128 amount = _sum(m.lineItems);
        uint128 advance = uint128(uint256(amount) * m.advanceBps / 10000);
        uint16 idx = _addTranche(id, amount, advance, m.lineItems, m.duration, m.specHash);
        _titles[id][idx] = m.title;
        emit MilestoneDefined(id, idx, m.title, amount, advance, m.duration, m.specHash);
    }

    /// Copy field by field: nested dynamic arrays can't be assigned from calldata wholesale.
    function _copyMilestone(MilestoneInput storage dst, MilestoneInput calldata src) internal {
        dst.title = src.title;
        for (uint256 i; i < src.lineItems.length; i++) dst.lineItems.push(src.lineItems[i]);
        dst.advanceBps = src.advanceBps;
        dst.duration = src.duration;
        dst.specHash = src.specHash;
    }

    /// An unopened future milestone, or the next slot for an appended one.
    function _targetOpenForChange(uint256 id, uint16 target) internal view returns (bool) {
        Agreement storage ag = _agreements[id];
        if (target < ag.trancheCount) {
            return target > ag.current && _tranches[id][target].status == TrancheStatus.Pending;
        }
        return target == ag.trancheCount && target < MAX_MILESTONES;
    }

    function _oldAmount(uint256 id, uint16 target) internal view returns (uint128) {
        return target < _agreements[id].trancheCount ? _tranches[id][target].amount : 0;
    }

    function _sum(uint128[] memory xs) internal pure returns (uint128 s) {
        for (uint256 i; i < xs.length; i++) s += xs[i];
    }

    /// Marks every tranche from `from` on as fully refunded and returns the total (caller pays it).
    function _refundFrom(uint256 id, uint16 from) internal returns (uint128 total) {
        uint16 count = _agreements[id].trancheCount;
        for (uint16 i = from; i < count; i++) {
            Tranche storage t = _tranches[id][i];
            if (t.status != TrancheStatus.Pending) continue;
            t.refunded = t.amount;
            t.status = TrancheStatus.Refunded;
            total += t.amount;
            emit TrancheRefunded(id, i, t.amount);
        }
    }

    // =================================================================== hooks

    function _allowLateClaim() internal pure override returns (bool) {
        return true; // late claims are accepted and recorded as late
    }

    function _canFinalizeNoClaim(uint256 id, address caller) internal view override returns (bool) {
        return caller == _agreements[id].payer; // stall cancellation is the homeowner's choice
    }

    function _afterDispute(uint256, uint16, uint16) internal override {}

    function _afterTrancheClosed(uint256 id, uint16 idx, bool settled) internal override {
        Agreement storage ag = _agreements[id];
        Project storage pr = _projects[id];

        if (!settled) {
            // Stall: the current milestone was refunded (minus its advance); refund every future one in full.
            uint128 future = _refundFrom(id, idx + 1);
            pr.status = ProjectStatus.Cancelled;
            ag.closed = true;
            _rec(ag.payee, INestPassport.Stat.ProjectsAbandoned, 1, ag.payer);
            emit ProjectCancelled(id, _tranches[id][idx].refunded + future, true);
            _payPayer(id, future);
            return;
        }

        Claim storage c = _claims[id][idx];
        if (c.awardedMask == _allItems(c)) {
            _rec(ag.payee, INestPassport.Stat.MilestonesApproved, 1, ag.payer);
            _rec(ag.payee, c.late ? INestPassport.Stat.MilestonesLate : INestPassport.Stat.MilestonesOnTime, 1, ag.payer);
        }
        if (idx + 1 < ag.trancheCount) {
            ag.current = idx + 1;
            _openTranche(id, idx + 1, uint64(block.timestamp) + _tranches[id][idx + 1].duration); // next advance
        } else {
            pr.status = ProjectStatus.Completed;
            ag.closed = true;
            _rec(ag.payee, INestPassport.Stat.ProjectsCompleted, 1, ag.payer);
            emit ProjectCompleted(id);
        }
    }
}
