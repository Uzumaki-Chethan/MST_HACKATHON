// ======================= IAttestedEscrow.sol =======================
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAttestedEscrow {
    enum TrancheStatus { Pending, Open, Claimed, Disputed, Settled, Refunded }

    struct Agreement {
        address payer;          // accepts/disputes; receives refunds
        address payee;          // claims
        uint256 payerRef;       // != 0 => payer is SocietyLedger; refunds call deposit{value}(payerRef)
        uint32 responseWindow;
        uint8 minScore;         // 0 = score not required for backing
        uint8 maxRounds;        // rework rounds allowed (0 = none)
        uint16 trancheCount;
        uint16 current;
        bool closed;
        uint64 createdAt;
    }
    struct Tranche {
        uint128 amount;
        uint128 advance;
        uint128 released;
        uint128 refunded;
        uint128[] itemCaps;     // fixed line items; empty = free-form items
        uint32 duration;
        uint64 openedAt;
        uint64 claimDeadline;
        uint8 round;
        TrancheStatus status;
        bytes32 specHash;
    }
    struct Claim {
        uint128[] items;
        bytes32 evidenceHash;
        uint64 submittedAt;
        uint8 round;
        uint16 disputedMask;
        uint16 awardedMask;
        uint256 disputeId;
        bool late;
    }
    struct Attestation {
        bytes32 reportHash;
        uint128[] supported;
        uint8 score;
        uint64 attestedAt;
        address attestor;
    }

    event AgreementCreated(uint256 indexed id, address indexed payer, address indexed payee, uint16 trancheCount, uint256 total);
    event TrancheOpened(uint256 indexed id, uint16 indexed idx, uint64 claimDeadline, uint128 advancePaid);
    event ClaimSubmitted(uint256 indexed id, uint16 indexed idx, uint8 round, uint128[] items, bytes32 evidenceHash, bool late);
    event Attested(uint256 indexed id, uint16 indexed idx, uint8 round, bytes32 reportHash, uint128[] supported, uint8 score, address attestor);
    event Responded(uint256 indexed id, uint16 indexed idx, uint16 disputedMask);
    event SilenceFinalized(uint256 indexed id, uint16 indexed idx, uint16 backedMask, uint16 escalatedMask);
    event ReworkRequested(uint256 indexed id, uint16 indexed idx, uint8 newRound, uint16 mask, bytes32 reasonHash, uint64 newDeadline);
    event DisputeEscalated(uint256 indexed id, uint16 indexed idx, uint256 indexed disputeId, uint16 mask, bool bySilence);
    event ItemsAwarded(uint256 indexed id, uint16 indexed idx, uint16 awardedMask, uint128 paidToPayee, uint128 refundedToPayer);
    event TrancheSettled(uint256 indexed id, uint16 indexed idx, uint128 totalToPayee, uint128 totalToPayer);
    event TrancheRefunded(uint256 indexed id, uint16 indexed idx, uint128 toPayer);
    event PayoutDeferred(address indexed to, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    function submitClaim(uint256 id, uint128[] calldata items, bytes32 evidenceHash) external;
    function attest(uint256 id, uint8 round, bytes32 reportHash, uint128[] calldata supported, uint8 score) external;
    function respond(uint256 id, uint16 disputedMask) external payable;
    function finalizeAfterSilence(uint256 id) external;
    function finalizeNoClaim(uint256 id) external;
    function onDisputeResolved(uint256 id, uint16 upheldMask) external;   // resolver only
    function withdraw() external;

    function nextId() external view returns (uint256);
    function getAgreement(uint256 id) external view returns (Agreement memory);
    function getTranche(uint256 id, uint16 idx) external view returns (Tranche memory);
    function getClaim(uint256 id, uint16 idx) external view returns (Claim memory);
    function getAttestation(uint256 id, uint16 idx) external view returns (Attestation memory);
    function agreementsOf(address user) external view returns (uint256[] memory);
    function isBacked(uint256 id, uint8 item) external view returns (bool);
    function backedMask(uint256 id) external view returns (uint16);
    function withdrawable(address user) external view returns (uint256);
}
