// ======================= IDisputeResolver.sol =======================
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IDisputeResolver {
    enum DisputeStatus { Open, Resolved }

    struct Dispute {
        address escrow;
        uint256 agreementId;
        uint16 trancheIdx;
        address payer;
        address payee;
        uint16 mask;
        uint128[] amounts;       // full claim items
        address[3] arbiters;
        uint16[3] votes;         // upheld mask per arbiter slot
        uint8 votedBits;         // bit s set when slot s voted
        uint128 bond;
        address bondPayer;       // zero when escalated by silence
        uint64 openedAt;
        uint64 voteDeadline;
        DisputeStatus status;
        uint16 upheldMask;
    }

    event DisputeCreated(uint256 indexed disputeId, address indexed escrow, uint256 indexed agreementId, uint16 trancheIdx, uint16 mask, address[3] arbiters, uint128 bond, uint64 voteDeadline);
    event Voted(uint256 indexed disputeId, address indexed arbiter, uint16 upheldMask, bytes32 rationaleHash);
    event DisputeResolved(uint256 indexed disputeId, uint16 upheldMask, bool payeeWon, uint128 upheldValue, uint128 disputedValue);
    event ArbiterReplaced(uint256 indexed disputeId, uint8 slot, address oldArbiter, address newArbiter);
    event ArbiterAdded(address indexed arbiter);
    event ArbiterRemoved(address indexed arbiter);
    event BondSettled(uint256 indexed disputeId, address indexed to, uint128 amount);
    event PayoutDeferred(address indexed to, uint256 amount);

    function openDispute(uint256 agreementId, uint16 trancheIdx, address payer, address payee, uint16 mask, uint128[] calldata amounts, address bondPayer) external payable returns (uint256 disputeId);
    function vote(uint256 disputeId, uint16 upheldMask, bytes32 rationaleHash) external;
    function replaceArbiter(uint256 disputeId, uint8 slot) external;   // admin
    function addArbiter(address arbiter) external;                     // admin
    function removeArbiter(address arbiter) external;                  // admin
    function setParams(uint128 bond, uint32 votingWindow) external;    // admin
    function withdraw() external;

    function disputeBond() external view returns (uint128);
    function votingWindow() external view returns (uint32);
    function arbiterPool() external view returns (address[] memory);
    function getDispute(uint256 disputeId) external view returns (Dispute memory);
    function disputesOf(address arbiter) external view returns (uint256[] memory);
    function disputeFor(address escrow, uint256 agreementId, uint16 trancheIdx) external view returns (uint256);
    function withdrawable(address user) external view returns (uint256);
}
