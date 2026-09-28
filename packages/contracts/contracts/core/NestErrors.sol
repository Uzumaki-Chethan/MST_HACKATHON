// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Custom errors shared by every NestLedger contract (SPEC §5.1).
error NotParty();
error BadStatus();
error WindowClosed();
error WindowOpen();
error BadAmount();
error BadInput();
error NotAuthorized();
