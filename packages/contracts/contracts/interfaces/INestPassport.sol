// ======================= INestPassport.sol =======================
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface INestPassport {
    enum Stat {
        RentOnTime, RentLate, LeasesCompleted, DepositFullRefunds,          // 0-3   tenant
        DepositsReturned, DeductionsUpheld, DeductionsRejected,             // 4-6   landlord
        MilestonesApproved, MilestonesOnTime, MilestonesLate,               // 7-9   contractor
        ProjectsCompleted, ProjectsAbandoned,                               // 10-11 contractor
        PromptDecisions, SilentDecisions,                                   // 12-13 payer reliability
        DisputesWon, DisputesLost,                                          // 14-15 any party
        InvoicesPaid, InvoicesFlagged, Deliveries, DeliveryAccuracyBpsSum,  // 16-19 vendor / supplier
        CommitteeVotes, FlagOverrides                                       // 20-21 committee
    }

    event PassportMinted(address indexed holder, uint256 indexed tokenId);
    event StatRecorded(address indexed holder, Stat indexed stat, uint32 amount, address indexed module);
    event TierParamsSet(uint32 minPayments);

    function mint(address holder) external;                              // registry only
    function record(address holder, Stat stat, uint32 amount) external;  // registry.isModule(msg.sender)
    function setTierParams(uint32 minPayments) external;                 // admin
    function setBaseURI(string calldata baseURI) external;               // admin (P1)

    function hasPassport(address holder) external view returns (bool);
    function tokenIdOf(address holder) external pure returns (uint256);  // uint256(uint160(holder))
    function statOf(address holder, Stat stat) external view returns (uint32);
    function statsOf(address holder) external view returns (uint32[22] memory);
    function tierMinPayments() external view returns (uint32);
    function tenantTier(address holder) external view returns (uint8);             // 0..3
    function depositMultiplierBps(address tenant) external view returns (uint16);  // 10000 / 7500 / 5000
    function trustScore(address holder) external view returns (uint16);            // 0..1000
}
