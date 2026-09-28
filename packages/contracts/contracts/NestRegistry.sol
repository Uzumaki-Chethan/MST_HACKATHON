// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/INestRegistry.sol";
import "./interfaces/INestPassport.sol";
import "./core/NestErrors.sol";

/// @notice Roles, user profiles and verification (SPEC §5.2).
contract NestRegistry is INestRegistry, AccessControl {
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    bytes32 public constant ATTESTOR_ROLE = keccak256("ATTESTOR_ROLE");
    bytes32 public constant MODULE_ROLE = keccak256("MODULE_ROLE");

    mapping(address => Profile) internal profiles;
    INestPassport public passport;

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function register(uint16 kinds, bytes32 metaHash) external {
        Profile storage p = profiles[msg.sender];
        if (p.registeredAt != 0) revert BadStatus();
        if (address(passport) == address(0)) revert BadStatus();
        p.kinds = kinds;
        p.metaHash = metaHash;
        p.registeredAt = uint64(block.timestamp);
        passport.mint(msg.sender);
        emit Registered(msg.sender, kinds, metaHash);
    }

    function updateProfile(uint16 kinds, bytes32 metaHash) external {
        Profile storage p = profiles[msg.sender];
        if (p.registeredAt == 0) revert NotAuthorized();
        p.kinds = kinds;
        p.metaHash = metaHash;
        emit ProfileUpdated(msg.sender, kinds, metaHash);
    }

    function verify(address user) external onlyRole(VERIFIER_ROLE) {
        if (profiles[user].registeredAt == 0) revert BadInput();
        profiles[user].verified = true;
        emit Verified(user, msg.sender);
    }

    function unverify(address user) external onlyRole(VERIFIER_ROLE) {
        if (profiles[user].registeredAt == 0) revert BadInput();
        profiles[user].verified = false;
        emit Unverified(user, msg.sender);
    }

    function setPassport(address passport_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (address(passport) != address(0)) revert BadStatus();
        if (passport_ == address(0)) revert BadInput();
        passport = INestPassport(passport_);
    }

    function isRegistered(address user) external view returns (bool) {
        return profiles[user].registeredAt != 0;
    }

    function isVerified(address user) external view returns (bool) {
        return profiles[user].verified;
    }

    function isAttestor(address a) external view returns (bool) {
        return hasRole(ATTESTOR_ROLE, a);
    }

    function isModule(address a) external view returns (bool) {
        return hasRole(MODULE_ROLE, a);
    }

    function isVerifier(address a) external view returns (bool) {
        return hasRole(VERIFIER_ROLE, a);
    }

    function profileOf(address user) external view returns (Profile memory) {
        return profiles[user];
    }
}
