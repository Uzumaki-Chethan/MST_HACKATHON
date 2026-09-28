// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "./interfaces/INestPassport.sol";
import "./interfaces/INestRegistry.sol";
import "./core/NestErrors.sol";

/// @notice One soulbound ERC-721 per wallet plus on-chain reputation counters (SPEC §5.3).
contract NestPassport is INestPassport, ERC721 {
    INestRegistry public immutable registry;
    address public immutable admin;

    mapping(address => uint32[22]) internal _stats;
    uint32 public tierMinPayments = 6;
    string internal _baseUri;

    constructor(INestRegistry registry_) ERC721("NestPassport", "NEST") {
        registry = registry_;
        admin = msg.sender;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAuthorized();
        _;
    }

    function mint(address holder) external {
        if (msg.sender != address(registry)) revert NotAuthorized();
        if (hasPassport(holder)) revert BadStatus();
        uint256 tokenId = tokenIdOf(holder);
        _mint(holder, tokenId);
        emit PassportMinted(holder, tokenId);
    }

    function record(address holder, Stat stat, uint32 amount) external {
        if (!registry.isModule(msg.sender)) revert NotAuthorized();
        if (!hasPassport(holder)) return;
        _stats[holder][uint256(stat)] += amount;
        emit StatRecorded(holder, stat, amount, msg.sender);
    }

    function setTierParams(uint32 minPayments) external onlyAdmin {
        tierMinPayments = minPayments;
        emit TierParamsSet(minPayments);
    }

    function setBaseURI(string calldata baseURI_) external onlyAdmin {
        _baseUri = baseURI_;
    }

    // ---------------------------------------------------------------- views

    function hasPassport(address holder) public view returns (bool) {
        return _ownerOf(tokenIdOf(holder)) != address(0);
    }

    function tokenIdOf(address holder) public pure returns (uint256) {
        return uint256(uint160(holder));
    }

    function statOf(address holder, Stat stat) public view returns (uint32) {
        return _stats[holder][uint256(stat)];
    }

    function statsOf(address holder) external view returns (uint32[22] memory) {
        return _stats[holder];
    }

    function tenantTier(address holder) public view returns (uint8) {
        if (!registry.isVerified(holder)) return 0;
        uint32 onTime = statOf(holder, Stat.RentOnTime);
        uint32 late = statOf(holder, Stat.RentLate);
        if (onTime < tierMinPayments || uint256(late) * 10 > onTime) return 1;
        if (statOf(holder, Stat.LeasesCompleted) >= 1 && statOf(holder, Stat.DisputesLost) == 0) return 3;
        return 2;
    }

    function depositMultiplierBps(address tenant) external view returns (uint16) {
        uint8 tier = tenantTier(tenant);
        if (tier == 3) return 5000;
        if (tier == 2) return 7500;
        return 10000;
    }

    function trustScore(address holder) external view returns (uint16) {
        int256 s = registry.isVerified(holder) ? int256(500) : int256(0);
        s += _cap(10, Stat.RentOnTime, 200, holder);
        s += _cap(50, Stat.LeasesCompleted, 150, holder);
        s += _cap(15, Stat.MilestonesApproved, 150, holder);
        s += _cap(5, Stat.InvoicesPaid, 100, holder);
        s += _cap(10, Stat.Deliveries, 100, holder);
        s += _cap(25, Stat.DisputesWon, 100, holder);
        s -= _cap(40, Stat.RentLate, 200, holder);
        s -= _cap(100, Stat.ProjectsAbandoned, 300, holder);
        s -= _cap(50, Stat.DisputesLost, 200, holder);
        if (s < 0) return 0;
        if (s > 1000) return 1000;
        return uint16(uint256(s));
    }

    /// min(cap, weight × stat)
    function _cap(uint256 weight, Stat stat, uint256 cap, address holder) internal view returns (int256) {
        uint256 v = weight * statOf(holder, stat);
        return int256(v < cap ? v : cap);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return string.concat(_baseUri, Strings.toHexString(address(uint160(tokenId))));
    }

    // ------------------------------------------------------------ soulbound

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert NotAuthorized();
        return super._update(to, tokenId, auth);
    }

    function approve(address, uint256) public pure override {
        revert NotAuthorized();
    }

    function setApprovalForAll(address, bool) public pure override {
        revert NotAuthorized();
    }
}
