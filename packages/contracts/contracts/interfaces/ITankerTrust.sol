// ======================= ITankerTrust.sol =======================
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ITankerTrust {
    enum OrderStatus { Open, Delivering, Settled, Expired }

    struct Device { uint256 societyId; bool active; bytes32 metaHash; }
    struct Order {
        uint256 societyId;
        address payer;
        uint256 payerRef;
        address supplier;
        address device;
        uint32 litresOrdered;
        uint128 pricePerLitre;
        uint128 escrowed;
        uint32 startLitres;
        uint32 endLitres;
        uint32 delivered;
        uint64 createdAt;
        uint64 startedAt;
        uint64 deadline;
        OrderStatus status;
    }

    event DeviceRegistered(address indexed device, uint256 indexed societyId, bytes32 metaHash);
    event DeviceRevoked(address indexed device);
    event OrderCreated(uint256 indexed orderId, uint256 indexed societyId, address indexed supplier, address device, uint32 litres, uint128 pricePerLitre, uint64 deadline);
    event ReadingAccepted(uint256 indexed orderId, uint8 phase, uint32 litres, uint64 timestamp);
    event OrderSettled(uint256 indexed orderId, uint32 delivered, uint128 paidToSupplier, uint128 refunded, uint16 accuracyBps);
    event OrderExpired(uint256 indexed orderId, bool deviceFault);
    event PayoutDeferred(address indexed to, uint256 amount);

    function registerDevice(address device, uint256 societyId, bytes32 metaHash) external;
    function revokeDevice(address device) external;
    function createOrder(uint256 societyId, address supplier, uint32 litres, uint128 pricePerLitre, address device, uint32 deliveryWindow) external payable returns (uint256 orderId);
    function submitReading(uint256 orderId, uint8 phase, uint32 litres, uint64 timestamp, bytes calldata sig) external;
    function expireOrder(uint256 orderId) external;
    function setToleranceBps(uint16 bps) external;   // admin
    function withdraw() external;

    function readingDigest(uint256 orderId, uint8 phase, uint32 litres, uint64 timestamp) external view returns (bytes32);
    function getOrder(uint256 orderId) external view returns (Order memory);
    function getDevice(address device) external view returns (Device memory);
    function ordersOf(uint256 societyId) external view returns (uint256[] memory);
    function toleranceBps() external view returns (uint16);
    function withdrawable(address user) external view returns (uint256);
}
