// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./core/AttestedEscrow.sol";
import "./interfaces/IRentalEscrow.sol";
import "./interfaces/ISocietyLedger.sol";

/// @notice DepositLock (SPEC §5.5). Lease id = agreement id. Payer = tenant, payee = landlord,
/// one tranche (the deposit), opened at move-out. Item 0 of every claim is unpaid rent.
contract RentalEscrow is AttestedEscrow, IRentalEscrow {
    ISocietyLedger public immutable ledger;
    mapping(uint256 => Lease) internal _leases;

    constructor(INestRegistry registry_, INestPassport passport_, IDisputeResolver resolver_, ISocietyLedger ledger_)
        AttestedEscrow(registry_, passport_, resolver_)
    {
        ledger = ledger_;
    }

    // =============================================================== lease setup

    function requiredDeposit(address tenant, uint128 rent, uint8 baseMonths) public view returns (uint128) {
        return uint128(uint256(rent) * baseMonths * passport.depositMultiplierBps(tenant) / 10000);
    }

    function offerLease(LeaseTerms calldata t) external whenNotPaused nonReentrant returns (uint256 leaseId) {
        if (!registry.isRegistered(msg.sender)) revert NotAuthorized();
        if (t.tenant == msg.sender || !registry.isRegistered(t.tenant)) revert BadInput();
        if (t.rent == 0 || t.periods == 0) revert BadAmount();
        if (t.period == 0 || t.grace == 0 || t.baselineWindow == 0 || t.claimWindow == 0 || t.responseWindow == 0) {
            revert BadInput();
        }
        uint256 societyId;
        uint128 maintenance;
        if (t.flatId != 0) {
            address owner;
            (societyId, owner, maintenance) = ledger.flatInfo(t.flatId);
            if (owner != msg.sender) revert NotAuthorized();
        }
        uint128 deposit = t.useTrustPricing ? requiredDeposit(t.tenant, t.rent, t.baseDepositMonths) : t.deposit;
        if (deposit == 0) revert BadAmount();

        leaseId = _createAgreement(t.tenant, msg.sender, 0, t.responseWindow, 0, 0);
        _addTranche(leaseId, deposit, 0, new uint128[](0), 0, t.termsHash);

        Lease storage L = _leases[leaseId];
        L.landlord = msg.sender;
        L.tenant = t.tenant;
        L.flatId = t.flatId;
        L.societyId = societyId;
        L.rent = t.rent;
        L.maintenance = maintenance;
        L.deposit = deposit;
        L.period = t.period;
        L.periods = t.periods;
        L.grace = t.grace;
        L.baselineWindow = t.baselineWindow;
        L.claimWindow = t.claimWindow;
        L.termsHash = t.termsHash;
        L.status = LeaseStatus.Offered;

        emit AgreementCreated(leaseId, t.tenant, msg.sender, 1, deposit);
        emit LeaseOffered(leaseId, msg.sender, t.tenant, t.flatId, t.rent, maintenance, deposit, t.termsHash);
    }

    function cancelOffer(uint256 leaseId) external nonReentrant {
        Lease storage L = _leases[leaseId];
        if (msg.sender != L.landlord) revert NotParty();
        if (L.status != LeaseStatus.Offered) revert BadStatus();
        L.status = LeaseStatus.Cancelled;
        _agreements[leaseId].closed = true;
        emit LeaseOfferCancelled(leaseId);
    }

    function signLease(uint256 leaseId) external payable nonReentrant {
        Lease storage L = _leases[leaseId];
        if (msg.sender != L.tenant) revert NotParty();
        if (L.status != LeaseStatus.Offered) revert BadStatus();
        if (msg.value != L.deposit) revert BadAmount();
        L.status = LeaseStatus.Active;
        L.startedAt = uint64(block.timestamp);
        emit LeaseSigned(leaseId, msg.sender, L.deposit, L.startedAt);
        if (L.flatId != 0) ledger.setFlatTenant(L.flatId, msg.sender);
    }

    // ========================================================= move-in baseline

    /// Whoever documents first sets the baseline; the other side gets baselineWindow to contest.
    /// The landlord may only document after the tenant's own window has passed (mirror rule).
    function submitBaseline(uint256 leaseId, bytes32 evidenceHash, bytes32 reportHash) external nonReentrant {
        Lease storage L = _leases[leaseId];
        if (L.status != LeaseStatus.Active) revert BadStatus();
        if (L.baseline != BaselineStatus.None) revert BadStatus();
        if (evidenceHash == bytes32(0)) revert BadInput();
        if (msg.sender == L.landlord) {
            if (block.timestamp <= L.startedAt + L.baselineWindow) revert WindowOpen();
        } else if (msg.sender != L.tenant) {
            revert NotParty();
        }
        L.baselineBy = msg.sender;
        L.baselineEvidence = evidenceHash;
        L.baselineReport = reportHash;
        L.baselineAt = uint64(block.timestamp);
        L.baseline = BaselineStatus.Submitted;
        emit BaselineSubmitted(leaseId, msg.sender, evidenceHash, reportHash, uint64(block.timestamp) + L.baselineWindow);
    }

    function confirmBaseline(uint256 leaseId) external nonReentrant {
        Lease storage L = _baselineCounterparty(leaseId);
        L.baseline = BaselineStatus.Agreed;
        emit BaselineConfirmed(leaseId, msg.sender);
    }

    function contestBaseline(uint256 leaseId, bytes32 counterEvidence) external nonReentrant {
        if (counterEvidence == bytes32(0)) revert BadInput();
        Lease storage L = _baselineCounterparty(leaseId);
        L.baseline = BaselineStatus.Contested;
        L.counterEvidence = counterEvidence;
        emit BaselineContested(leaseId, msg.sender, counterEvidence);
    }

    function finalizeBaseline(uint256 leaseId) external nonReentrant {
        Lease storage L = _leases[leaseId];
        if (L.baseline != BaselineStatus.Submitted) revert BadStatus();
        if (block.timestamp <= L.baselineAt + L.baselineWindow) revert WindowOpen();
        L.baseline = BaselineStatus.PresumedAccepted;
        emit BaselinePresumed(leaseId);
    }

    function _baselineCounterparty(uint256 leaseId) internal view returns (Lease storage L) {
        L = _leases[leaseId];
        if (L.baseline != BaselineStatus.Submitted) revert BadStatus();
        address counterparty = L.baselineBy == L.tenant ? L.landlord : L.tenant;
        if (msg.sender != counterparty) revert NotParty();
        if (block.timestamp > L.baselineAt + L.baselineWindow) revert WindowClosed();
    }

    // ===================================================================== rent

    /// One payment: rent goes to the landlord, maintenance to the society treasury.
    function payRent(uint256 leaseId) external payable nonReentrant {
        Lease storage L = _leases[leaseId];
        if (L.status != LeaseStatus.Active) revert BadStatus();
        if (L.paidPeriods >= L.periods) revert BadStatus();
        if (msg.value != uint256(L.rent) + L.maintenance) revert BadAmount();
        uint16 k = L.paidPeriods;
        uint256 dueAt = uint256(L.startedAt) + uint256(k) * L.period;
        bool onTime = block.timestamp <= dueAt + L.grace;
        L.paidPeriods = k + 1;
        if (!onTime) L.latePeriods += 1;

        emit RentPaid(leaseId, k, L.rent, L.maintenance, onTime);
        _rec(L.tenant, onTime ? INestPassport.Stat.RentOnTime : INestPassport.Stat.RentLate, 1, L.landlord);
        _send(L.landlord, L.rent);
        if (L.maintenance > 0) ledger.payMaintenance{value: L.maintenance}(L.flatId);
    }

    function rentDueInfo(uint256 leaseId)
        external view returns (uint16 nextPeriod, uint64 dueAt, uint128 amount, bool overdue)
    {
        Lease storage L = _leases[leaseId];
        nextPeriod = L.paidPeriods;
        dueAt = uint64(uint256(L.startedAt) + uint256(L.paidPeriods) * L.period);
        amount = L.rent + L.maintenance;
        overdue = L.status == LeaseStatus.Active && L.paidPeriods < L.periods && block.timestamp > uint256(dueAt) + L.grace;
    }

    // ================================================================= move-out

    function startMoveOut(uint256 leaseId, bytes32 evidenceHash) external nonReentrant {
        Lease storage L = _leases[leaseId];
        if (msg.sender != L.tenant && msg.sender != L.landlord) revert NotParty();
        if (L.status != LeaseStatus.Active) revert BadStatus();
        bool termOver = block.timestamp >= uint256(L.startedAt) + uint256(L.periods) * L.period;
        if (!termOver && L.paidPeriods != L.periods) revert WindowOpen();

        L.unpaidDues = uint128(uint256(L.periods - L.paidPeriods) * L.rent);
        L.moveOutEvidence = evidenceHash;
        L.status = LeaseStatus.MovingOut;
        uint64 claimDeadline = uint64(block.timestamp) + L.claimWindow;
        emit MoveOutStarted(leaseId, msg.sender, evidenceHash, L.unpaidDues, claimDeadline);
        _openTranche(leaseId, 0, claimDeadline);
    }

    /// A landlord with no deductions returns the whole deposit now.
    function releaseDepositInFull(uint256 leaseId) external nonReentrant {
        Lease storage L = _leases[leaseId];
        if (msg.sender != L.landlord) revert NotParty();
        if (L.status != LeaseStatus.MovingOut) revert BadStatus();
        if (_tranches[leaseId][0].status != TrancheStatus.Open) revert BadStatus();
        emit DepositReleasedInFull(leaseId);
        _refundTranche(leaseId);
    }

    function getLease(uint256 leaseId) external view returns (Lease memory) {
        return _leases[leaseId];
    }

    // ==================================================================== hooks

    /// Item 0 of a rental claim is unpaid rent, backed by the contract's own records (N4).
    function _systemSupported(uint256 id, uint256 item) internal view override returns (uint128) {
        return item == 0 ? _leases[id].unpaidDues : 0;
    }

    function _allowLateClaim() internal pure override returns (bool) {
        return false; // the landlord's claim deadline is strict
    }

    function _canFinalizeNoClaim(uint256, address) internal pure override returns (bool) {
        return true; // anyone (normally the keeper) can refund an unclaimed deposit
    }

    function _afterDispute(uint256 id, uint16 upheldMask, uint16 disputedMask) internal override {
        Lease storage L = _leases[id];
        _rec(L.landlord, INestPassport.Stat.DeductionsUpheld, _popcount(upheldMask), L.tenant);
        _rec(L.landlord, INestPassport.Stat.DeductionsRejected, _popcount(disputedMask & ~upheldMask), L.tenant);
    }

    function _afterTrancheClosed(uint256 id, uint16, bool) internal override {
        Lease storage L = _leases[id];
        Tranche storage t = _tranches[id][0];
        L.status = LeaseStatus.Closed;
        _agreements[id].closed = true;

        _rec(L.tenant, INestPassport.Stat.LeasesCompleted, 1, L.landlord);
        if (t.refunded == t.amount) _rec(L.tenant, INestPassport.Stat.DepositFullRefunds, 1, L.landlord);
        if (_claims[id][0].disputedMask == 0) _rec(L.landlord, INestPassport.Stat.DepositsReturned, 1, L.tenant);
        emit LeaseClosed(id, t.released, t.refunded);
        if (L.flatId != 0) ledger.setFlatTenant(L.flatId, address(0));
    }
}
