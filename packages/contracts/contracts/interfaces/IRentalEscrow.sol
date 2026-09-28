// ======================= IRentalEscrow.sol =======================
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "./IAttestedEscrow.sol";

interface IRentalEscrow is IAttestedEscrow {
    enum LeaseStatus { Offered, Active, MovingOut, Closed, Cancelled }
    enum BaselineStatus { None, Submitted, Agreed, Contested, PresumedAccepted }

    struct LeaseTerms {
        address tenant;
        uint256 flatId;            // 0 = not in a registered society
        uint128 rent;              // wei per period
        uint128 deposit;           // ignored when useTrustPricing
        bool useTrustPricing;
        uint8 baseDepositMonths;
        uint32 period;
        uint16 periods;
        uint32 grace;
        uint32 baselineWindow;
        uint32 claimWindow;
        uint32 responseWindow;
        bytes32 termsHash;
    }
    struct Lease {
        address landlord;
        address tenant;
        uint256 flatId;
        uint256 societyId;
        uint128 rent;
        uint128 maintenance;
        uint128 deposit;
        uint32 period;
        uint16 periods;
        uint16 paidPeriods;
        uint16 latePeriods;
        uint32 grace;
        uint32 baselineWindow;
        uint32 claimWindow;
        uint64 startedAt;
        uint64 baselineAt;
        address baselineBy;
        BaselineStatus baseline;
        bytes32 baselineEvidence;
        bytes32 baselineReport;
        bytes32 counterEvidence;
        bytes32 moveOutEvidence;
        uint128 unpaidDues;
        bytes32 termsHash;
        LeaseStatus status;
    }

    event LeaseOffered(uint256 indexed leaseId, address indexed landlord, address indexed tenant, uint256 flatId, uint128 rent, uint128 maintenance, uint128 deposit, bytes32 termsHash);
    event LeaseOfferCancelled(uint256 indexed leaseId);
    event LeaseSigned(uint256 indexed leaseId, address indexed tenant, uint128 deposit, uint64 startedAt);
    event BaselineSubmitted(uint256 indexed leaseId, address indexed by, bytes32 evidenceHash, bytes32 reportHash, uint64 contestDeadline);
    event BaselineConfirmed(uint256 indexed leaseId, address indexed by);
    event BaselineContested(uint256 indexed leaseId, address indexed by, bytes32 counterEvidence);
    event BaselinePresumed(uint256 indexed leaseId);
    event RentPaid(uint256 indexed leaseId, uint16 indexed periodIndex, uint128 rent, uint128 maintenance, bool onTime);
    event MoveOutStarted(uint256 indexed leaseId, address indexed by, bytes32 evidenceHash, uint128 unpaidDues, uint64 claimDeadline);
    event DepositReleasedInFull(uint256 indexed leaseId);
    event LeaseClosed(uint256 indexed leaseId, uint128 toLandlord, uint128 toTenant);

    function requiredDeposit(address tenant, uint128 rent, uint8 baseMonths) external view returns (uint128);
    function offerLease(LeaseTerms calldata t) external returns (uint256 leaseId);
    function cancelOffer(uint256 leaseId) external;
    function signLease(uint256 leaseId) external payable;
    function submitBaseline(uint256 leaseId, bytes32 evidenceHash, bytes32 reportHash) external;
    function confirmBaseline(uint256 leaseId) external;
    function contestBaseline(uint256 leaseId, bytes32 counterEvidence) external;
    function finalizeBaseline(uint256 leaseId) external;
    function payRent(uint256 leaseId) external payable;
    function startMoveOut(uint256 leaseId, bytes32 evidenceHash) external;
    function releaseDepositInFull(uint256 leaseId) external;
    function getLease(uint256 leaseId) external view returns (Lease memory);
    function rentDueInfo(uint256 leaseId) external view returns (uint16 nextPeriod, uint64 dueAt, uint128 amount, bool overdue);
}
