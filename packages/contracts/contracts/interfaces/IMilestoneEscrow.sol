// ======================= IMilestoneEscrow.sol =======================
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "./IAttestedEscrow.sol";

interface IMilestoneEscrow is IAttestedEscrow {
    enum ProjectStatus { AwaitingAcceptance, Active, Completed, Cancelled }

    struct MilestoneInput {
        string title;
        uint128[] lineItems;     // 1..10 amounts (wei); sum = milestone amount
        uint16 advanceBps;       // 0..4000
        uint32 duration;         // seconds from opening to claim deadline
        bytes32 specHash;        // nestledger.milestone-spec.v1
    }
    struct ProjectInput {
        address contractor;
        bytes32 specHash;        // nestledger.project-spec.v1
        uint32 responseWindow;
        uint32 reworkWindow;
        uint8 minScore;          // 1..100
        uint8 maxRounds;         // 0..3
        uint256 payerRef;        // 0 for homeowners; societyId when called by SocietyLedger
        uint256 flatId;          // optional context
    }
    struct Project {
        ProjectStatus status;
        bytes32 specHash;
        uint32 reworkWindow;
        uint256 flatId;
        uint64 acceptedAt;
        uint16 changeOrderCount;
    }
    struct ChangeOrder {
        address proposer;
        uint16 target;           // unopened milestone index, or trancheCount to append
        MilestoneInput milestone;
        bytes32 reasonHash;
        int256 budgetDelta;
        uint128 fundedByProposer;
        bool executed;
        bool rejected;
    }

    event ProjectCreated(uint256 indexed id, address indexed payer, address indexed contractor, uint256 total, uint16 milestoneCount, bytes32 specHash);
    event MilestoneDefined(uint256 indexed id, uint16 indexed idx, string title, uint128 amount, uint128 advance, uint32 duration, bytes32 specHash);
    event ProjectAccepted(uint256 indexed id, address indexed contractor);
    event ProjectCancelled(uint256 indexed id, uint128 refundedToPayer, bool stalled);
    event ProjectCompleted(uint256 indexed id);
    event ChangeOrderProposed(uint256 indexed id, uint16 indexed coId, address indexed proposer, uint16 target, int256 budgetDelta, bytes32 reasonHash);
    event ChangeOrderApproved(uint256 indexed id, uint16 indexed coId, address indexed approver);
    event ChangeOrderRejected(uint256 indexed id, uint16 indexed coId, address indexed by);

    function createProject(ProjectInput calldata p, MilestoneInput[] calldata ms) external payable returns (uint256 id);
    function acceptProject(uint256 id) external;
    function cancelUnaccepted(uint256 id) external;
    function requestRework(uint256 id, uint16 mask, bytes32 reasonHash) external;
    function proposeChangeOrder(uint256 id, uint16 target, MilestoneInput calldata m, bytes32 reasonHash) external payable returns (uint16 coId);
    function approveChangeOrder(uint256 id, uint16 coId) external payable;
    function rejectChangeOrder(uint256 id, uint16 coId) external;

    function getProject(uint256 id) external view returns (Project memory);
    function milestoneTitle(uint256 id, uint16 idx) external view returns (string memory);
    function getChangeOrder(uint256 id, uint16 coId) external view returns (ChangeOrder memory);
}
