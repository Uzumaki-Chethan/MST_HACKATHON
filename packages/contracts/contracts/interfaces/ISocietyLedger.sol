// ======================= ISocietyLedger.sol =======================
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ISocietyLedger {
    enum ProposalKind { PayVendor, FundWork, WorkDecision, TankerOrder }
    enum ProposalStatus { Pending, CommitteeApproved, Executed, Rejected, Cancelled }

    struct SocietyConfig {
        uint8 threshold;
        uint128 tier1Limit;      // wei
        uint128 tier2Limit;      // wei
        uint16 quorumBps;
        uint32 votingPeriod;
        uint32 attestTimeout;
    }
    struct Society {
        address admin;
        string name;
        bytes32 metaHash;
        address[] committee;
        SocietyConfig config;
        uint128 balance;
        uint128 committed;
        uint32 totalWeight;
        uint128 totalCollected;
        uint128 totalSpent;
    }
    struct Flat {
        uint256 societyId;
        string label;
        address owner;
        address tenant;
        address delegate;
        uint16 weight;
        uint128 maintenance;
        uint128 totalPaid;
        uint64 lastPaidAt;
    }
    struct Proposal {
        uint256 societyId;
        ProposalKind kind;
        ProposalStatus status;
        address proposer;
        address payee;
        uint128 amount;
        bytes32 docHash;
        string category;
        uint8 tier;
        uint8 approvals;
        bool attested;
        bool flagged;
        uint8 riskScore;
        bytes32 reportHash;
        uint64 createdAt;
        uint64 voteEnds;
        uint128 votesFor;
        uint128 votesAgainst;
        uint32 month;
        uint256 resultRef;
        bytes data;
    }

    event SocietyCreated(uint256 indexed societyId, address indexed admin, string name, bytes32 metaHash);
    event FlatAdded(uint256 indexed societyId, uint256 indexed flatId, string label, address indexed owner, uint16 weight, uint128 maintenance);
    event FlatTenantSet(uint256 indexed flatId, address indexed tenant);
    event VoteDelegated(uint256 indexed flatId, address indexed delegate);
    event MaintenancePaid(uint256 indexed societyId, uint256 indexed flatId, address indexed payer, uint128 amount);
    event Deposited(uint256 indexed societyId, address indexed from, uint128 amount);
    event ProposalCreated(uint256 indexed proposalId, uint256 indexed societyId, ProposalKind kind, address indexed payee, uint128 amount, bytes32 docHash, string category, uint8 tier);
    event InvoiceAttested(uint256 indexed proposalId, bytes32 reportHash, uint8 riskScore, bool flagged);
    event Approved(uint256 indexed proposalId, address indexed member, bytes32 overrideReasonHash, uint8 approvals);
    event CommitteeApproved(uint256 indexed proposalId, uint64 voteEnds);
    event ResidentVoted(uint256 indexed proposalId, uint256 indexed flatId, address indexed voter, bool support, uint16 weight);
    event ProposalExecuted(uint256 indexed proposalId, ProposalKind kind, address indexed payee, uint128 amount, uint256 resultRef);
    event ProposalRejected(uint256 indexed proposalId);
    event ProposalCancelled(uint256 indexed proposalId);
    event PayoutDeferred(address indexed to, uint256 amount);

    function createSociety(string calldata name, bytes32 metaHash, address[] calldata committee, SocietyConfig calldata cfg) external returns (uint256 societyId);
    function addFlat(uint256 societyId, string calldata label, address owner, uint16 weight, uint128 maintenance) external returns (uint256 flatId);
    function setFlatTenant(uint256 flatId, address tenant) external;    // modules only
    function delegateVote(uint256 flatId, address delegate) external;   // flat owner
    function payMaintenance(uint256 flatId) external payable;
    function deposit(uint256 societyId) external payable;
    function propose(uint256 societyId, ProposalKind kind, address payee, uint128 amount, bytes32 docHash, string calldata category, bytes calldata data) external returns (uint256 proposalId);
    function attestInvoice(uint256 proposalId, bytes32 reportHash, uint8 riskScore, bool flagged) external;  // attestor
    function approve(uint256 proposalId, bytes32 overrideReasonHash) external;
    function castVote(uint256 proposalId, uint256 flatId, bool support) external;
    function execute(uint256 proposalId) external;
    function cancel(uint256 proposalId) external;
    function setModules(address rental, address milestone, address tanker) external;  // admin, once
    function withdraw() external;

    function getSociety(uint256 societyId) external view returns (Society memory);
    function getFlat(uint256 flatId) external view returns (Flat memory);
    function getProposal(uint256 proposalId) external view returns (Proposal memory);
    function flatsOf(uint256 societyId) external view returns (uint256[] memory);
    function proposalsOf(uint256 societyId) external view returns (uint256[] memory);
    function societiesOf(address member) external view returns (uint256[] memory);   // admin or committee
    function isCommittee(uint256 societyId, address who) external view returns (bool);
    function hasApproved(uint256 proposalId, address member) external view returns (bool);
    function hasVoted(uint256 proposalId, uint256 flatId) external view returns (bool);
    function effectiveTier(uint256 proposalId) external view returns (uint8);
    function requiredApprovals(uint256 proposalId) external view returns (uint8);
    function canExecute(uint256 proposalId) external view returns (bool ok, string memory reason);
    function availableBalance(uint256 societyId) external view returns (uint128);
    function vendorMonthCommitted(uint256 societyId, address vendor, uint32 month) external view returns (uint128);
    function flatInfo(uint256 flatId) external view returns (uint256 societyId, address owner, uint128 maintenance);
    function withdrawable(address user) external view returns (uint256);
}
