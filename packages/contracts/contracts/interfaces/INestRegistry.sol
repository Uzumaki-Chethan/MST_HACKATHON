// ======================= INestRegistry.sol =======================
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface INestRegistry {
    // kinds bitmask: 1 TENANT, 2 LANDLORD, 4 HOMEOWNER, 8 CONTRACTOR, 16 VENDOR, 32 SUPPLIER, 64 COMMITTEE, 128 ARBITER
    struct Profile { uint16 kinds; bool verified; uint64 registeredAt; bytes32 metaHash; }

    event Registered(address indexed user, uint16 kinds, bytes32 metaHash);
    event ProfileUpdated(address indexed user, uint16 kinds, bytes32 metaHash);
    event Verified(address indexed user, address indexed verifier);
    event Unverified(address indexed user, address indexed verifier);

    function register(uint16 kinds, bytes32 metaHash) external;
    function updateProfile(uint16 kinds, bytes32 metaHash) external;
    function verify(address user) external;                 // VERIFIER_ROLE
    function unverify(address user) external;               // VERIFIER_ROLE
    function setPassport(address passport) external;        // admin, once

    function isRegistered(address user) external view returns (bool);
    function isVerified(address user) external view returns (bool);
    function isAttestor(address a) external view returns (bool);
    function isModule(address a) external view returns (bool);
    function isVerifier(address a) external view returns (bool);
    function profileOf(address user) external view returns (Profile memory);
}
