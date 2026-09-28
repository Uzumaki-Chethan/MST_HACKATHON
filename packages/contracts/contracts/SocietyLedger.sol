// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/ISocietyLedger.sol";
import "./interfaces/IMilestoneEscrow.sol";
import "./interfaces/ITankerTrust.sol";
import "./interfaces/INestPassport.sol";
import "./interfaces/INestRegistry.sol";
import "./core/NestErrors.sol";

/// @notice Transparent society treasury (SPEC §5.8): maintenance collections, tiered committee
/// approvals, AI invoice attestation (a flag escalates, never blocks), weighted resident voting,
/// and execution of vendor payments, building works, work decisions and tanker orders.
contract SocietyLedger is ISocietyLedger, ReentrancyGuard, Pausable, AccessControl {
    uint256 internal constant MAX_COMMITTEE = 5;
    uint256 internal constant MAX_FLATS = 50;

    INestRegistry public immutable registry;
    INestPassport public immutable passport;
    address public rental;
    IMilestoneEscrow public milestone;
    ITankerTrust public tanker;

    uint256 public nextSocietyId = 1;
    uint256 public nextFlatId = 1;
    uint256 public nextProposalId = 1;
    mapping(uint256 => Society) internal _societies;
    mapping(uint256 => Flat) internal _flats;
    mapping(uint256 => Proposal) internal _proposals;
    mapping(uint256 => uint256[]) internal _flatsOf;
    mapping(uint256 => uint256[]) internal _proposalsOf;
    mapping(address => uint256[]) internal _societiesOf;
    mapping(uint256 => mapping(address => mapping(uint32 => uint128))) public vendorMonthCommitted;
    mapping(address => uint256) public withdrawable;

    // Approval / vote epochs: a flag bumps the epoch, which resets approvals and votes without looping.
    mapping(uint256 => uint32) internal _epoch;
    mapping(uint256 => mapping(address => uint32)) internal _approvedEpoch; // stores epoch + 1
    mapping(uint256 => mapping(uint256 => uint32)) internal _votedEpoch;    // stores epoch + 1

    constructor(INestRegistry registry_, INestPassport passport_) {
        registry = registry_;
        passport = passport_;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function setModules(address rental_, address milestone_, address tanker_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (rental != address(0)) revert BadStatus();
        rental = rental_;
        milestone = IMilestoneEscrow(milestone_);
        tanker = ITankerTrust(tanker_);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ============================================================ society setup

    function createSociety(string calldata name, bytes32 metaHash, address[] calldata committee, SocietyConfig calldata cfg)
        external whenNotPaused returns (uint256 societyId)
    {
        if (!registry.isRegistered(msg.sender)) revert NotAuthorized();
        uint256 n = committee.length;
        if (n == 0 || n > MAX_COMMITTEE) revert BadInput();
        if (cfg.threshold == 0 || cfg.threshold > n) revert BadInput();
        if (cfg.tier1Limit >= cfg.tier2Limit || cfg.quorumBps > 10000) revert BadInput();
        for (uint256 i; i < n; i++) {
            if (committee[i] == address(0)) revert BadInput();
            for (uint256 j; j < i; j++) if (committee[j] == committee[i]) revert BadInput();
        }

        societyId = nextSocietyId++;
        Society storage s = _societies[societyId];
        s.admin = msg.sender;
        s.name = name;
        s.metaHash = metaHash;
        s.committee = committee;
        s.config = cfg;
        bool adminOnCommittee;
        for (uint256 i; i < n; i++) {
            _societiesOf[committee[i]].push(societyId);
            if (committee[i] == msg.sender) adminOnCommittee = true;
        }
        if (!adminOnCommittee) _societiesOf[msg.sender].push(societyId);
        emit SocietyCreated(societyId, msg.sender, name, metaHash);
    }

    function addFlat(uint256 societyId, string calldata label, address owner, uint16 weight, uint128 maintenance)
        external returns (uint256 flatId)
    {
        Society storage s = _societies[societyId];
        if (msg.sender != s.admin) revert NotAuthorized();
        if (weight == 0 || owner == address(0)) revert BadInput();
        if (_flatsOf[societyId].length >= MAX_FLATS) revert BadStatus();
        flatId = nextFlatId++;
        Flat storage f = _flats[flatId];
        f.societyId = societyId;
        f.label = label;
        f.owner = owner;
        f.weight = weight;
        f.maintenance = maintenance;
        _flatsOf[societyId].push(flatId);
        s.totalWeight += weight;
        emit FlatAdded(societyId, flatId, label, owner, weight, maintenance);
    }

    function setFlatTenant(uint256 flatId, address tenant) external {
        if (msg.sender != rental || rental == address(0)) revert NotAuthorized();
        _flats[flatId].tenant = tenant;
        emit FlatTenantSet(flatId, tenant);
    }

    function delegateVote(uint256 flatId, address delegate) external {
        if (msg.sender != _flats[flatId].owner) revert NotAuthorized();
        _flats[flatId].delegate = delegate;
        emit VoteDelegated(flatId, delegate);
    }

    // ================================================================= money in

    function payMaintenance(uint256 flatId) external payable {
        Flat storage f = _flats[flatId];
        if (f.societyId == 0) revert BadInput();
        if (msg.value == 0) revert BadAmount();
        Society storage s = _societies[f.societyId];
        s.balance += uint128(msg.value);
        s.totalCollected += uint128(msg.value);
        f.totalPaid += uint128(msg.value);
        f.lastPaidAt = uint64(block.timestamp);
        emit MaintenancePaid(f.societyId, flatId, msg.sender, uint128(msg.value));
    }

    /// Credits a society directly. Escrow refunds to a society use this, even mid-execution (not nonReentrant on purpose).
    function deposit(uint256 societyId) external payable {
        if (_societies[societyId].admin == address(0)) revert BadInput();
        if (msg.value == 0) revert BadAmount();
        _societies[societyId].balance += uint128(msg.value);
        emit Deposited(societyId, msg.sender, uint128(msg.value));
    }

    // =============================================================== proposals

    function propose(
        uint256 societyId, ProposalKind kind, address payee, uint128 amount, bytes32 docHash,
        string calldata category, bytes calldata data
    ) external whenNotPaused nonReentrant returns (uint256 proposalId) {
        if (!isCommittee(societyId, msg.sender)) revert NotAuthorized();
        if (payee == address(0) || docHash == bytes32(0)) revert BadInput();
        Society storage s = _societies[societyId];
        if (amount > s.balance - s.committed) revert BadAmount();
        _checkData(kind, payee, amount, data);

        uint32 month = uint32(block.timestamp / 30 days);
        uint128 mtd = vendorMonthCommitted[societyId][payee][month] + amount;
        uint8 tier = mtd <= s.config.tier1Limit ? 0 : (mtd <= s.config.tier2Limit ? 1 : 2);
        if (kind == ProposalKind.WorkDecision && tier < 1) tier = 1;

        proposalId = nextProposalId++;
        Proposal storage p = _proposals[proposalId];
        p.societyId = societyId;
        p.kind = kind;
        p.status = ProposalStatus.Pending;
        p.proposer = msg.sender;
        p.payee = payee;
        p.amount = amount;
        p.docHash = docHash;
        p.category = category;
        p.tier = tier;
        p.createdAt = uint64(block.timestamp);
        p.month = month;
        p.data = data;
        _proposalsOf[societyId].push(proposalId);
        s.committed += amount;
        vendorMonthCommitted[societyId][payee][month] = mtd;

        emit ProposalCreated(proposalId, societyId, kind, payee, amount, docHash, category, tier);
        _approve(proposalId, p, bytes32(0)); // the proposer's own approval counts
    }

    /// The AI's invoice verdict. A flag never blocks: it escalates the tier and resets approvals (G8, N19).
    function attestInvoice(uint256 proposalId, bytes32 reportHash, uint8 riskScore, bool flagged) external {
        if (!registry.isAttestor(msg.sender)) revert NotAuthorized();
        Proposal storage p = _proposals[proposalId];
        if (p.status != ProposalStatus.Pending && p.status != ProposalStatus.CommitteeApproved) revert BadStatus();
        if (p.attested) revert BadStatus();
        if (riskScore > 100) revert BadInput();
        p.attested = true;
        p.reportHash = reportHash;
        p.riskScore = riskScore;
        p.flagged = flagged;
        if (flagged) {
            _epoch[proposalId] += 1;
            p.approvals = 0;
            p.votesFor = 0;
            p.votesAgainst = 0;
            p.status = ProposalStatus.Pending;
            p.voteEnds = 0;
        }
        emit InvoiceAttested(proposalId, reportHash, riskScore, flagged);
    }

    function approve(uint256 proposalId, bytes32 overrideReasonHash) external {
        Proposal storage p = _proposals[proposalId];
        if (!isCommittee(p.societyId, msg.sender)) revert NotAuthorized();
        if (p.status != ProposalStatus.Pending) revert BadStatus();
        if (hasApproved(proposalId, msg.sender)) revert BadStatus();
        if (p.flagged && overrideReasonHash == bytes32(0)) revert BadInput(); // written reason required
        _approve(proposalId, p, overrideReasonHash);
    }

    function castVote(uint256 proposalId, uint256 flatId, bool support) external {
        Proposal storage p = _proposals[proposalId];
        Flat storage f = _flats[flatId];
        if (p.status != ProposalStatus.CommitteeApproved) revert BadStatus();
        if (block.timestamp >= p.voteEnds) revert WindowClosed();
        if (f.societyId != p.societyId) revert BadInput();
        address voter = f.delegate != address(0) ? f.delegate : f.owner;
        if (msg.sender != voter) revert NotAuthorized();
        if (hasVoted(proposalId, flatId)) revert BadStatus();
        _votedEpoch[proposalId][flatId] = _epoch[proposalId] + 1;
        if (support) p.votesFor += f.weight;
        else p.votesAgainst += f.weight;
        emit ResidentVoted(proposalId, flatId, msg.sender, support, f.weight);
    }

    /// Anyone (normally the keeper) executes once the rules are met. A tier-2 proposal whose vote
    /// ended without quorum or majority is rejected and its reservation released.
    function execute(uint256 proposalId) external nonReentrant {
        Proposal storage p = _proposals[proposalId];
        if (p.status == ProposalStatus.CommitteeApproved && block.timestamp >= p.voteEnds && !_votePassed(p)) {
            p.status = ProposalStatus.Rejected;
            _release(p);
            emit ProposalRejected(proposalId);
            return;
        }
        (bool ok, ) = canExecute(proposalId);
        if (!ok) revert BadStatus();

        Society storage s = _societies[p.societyId];
        p.status = ProposalStatus.Executed;
        s.committed -= p.amount;
        s.balance -= p.amount;
        s.totalSpent += p.amount;
        uint256 resultRef = _dispatch(p);
        p.resultRef = resultRef;
        emit ProposalExecuted(proposalId, p.kind, p.payee, p.amount, resultRef);
    }

    function cancel(uint256 proposalId) external {
        Proposal storage p = _proposals[proposalId];
        if (msg.sender != p.proposer) revert NotAuthorized();
        if (p.status != ProposalStatus.Pending && p.status != ProposalStatus.CommitteeApproved) revert BadStatus();
        p.status = ProposalStatus.Cancelled;
        _release(p);
        emit ProposalCancelled(proposalId);
    }

    function withdraw() external nonReentrant {
        uint256 amount = withdrawable[msg.sender];
        if (amount == 0) revert BadAmount();
        withdrawable[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert BadStatus();
    }

    // =================================================================== views

    function getSociety(uint256 societyId) external view returns (Society memory) { return _societies[societyId]; }
    function getFlat(uint256 flatId) external view returns (Flat memory) { return _flats[flatId]; }
    function getProposal(uint256 proposalId) external view returns (Proposal memory) { return _proposals[proposalId]; }
    function flatsOf(uint256 societyId) external view returns (uint256[] memory) { return _flatsOf[societyId]; }
    function proposalsOf(uint256 societyId) external view returns (uint256[] memory) { return _proposalsOf[societyId]; }
    function societiesOf(address member) external view returns (uint256[] memory) { return _societiesOf[member]; }

    function isCommittee(uint256 societyId, address who) public view returns (bool) {
        address[] storage c = _societies[societyId].committee;
        for (uint256 i; i < c.length; i++) if (c[i] == who) return true;
        return false;
    }

    function hasApproved(uint256 proposalId, address member) public view returns (bool) {
        return _approvedEpoch[proposalId][member] == _epoch[proposalId] + 1;
    }

    function hasVoted(uint256 proposalId, uint256 flatId) public view returns (bool) {
        return _votedEpoch[proposalId][flatId] == _epoch[proposalId] + 1;
    }

    function effectiveTier(uint256 proposalId) public view returns (uint8) {
        Proposal storage p = _proposals[proposalId];
        return p.flagged && p.tier < 1 ? 1 : p.tier;
    }

    function requiredApprovals(uint256 proposalId) public view returns (uint8) {
        return effectiveTier(proposalId) == 0 ? 1 : _societies[_proposals[proposalId].societyId].config.threshold;
    }

    function canExecute(uint256 proposalId) public view returns (bool ok, string memory reason) {
        Proposal storage p = _proposals[proposalId];
        SocietyConfig storage cfg = _societies[p.societyId].config;
        uint8 tier = effectiveTier(proposalId);
        if (p.status != ProposalStatus.Pending && p.status != ProposalStatus.CommitteeApproved) return (false, "not open");
        if (!p.attested && block.timestamp < p.createdAt + cfg.attestTimeout) return (false, "awaiting AI attestation");
        if (tier < 2) {
            if (p.approvals < requiredApprovals(proposalId)) return (false, "needs more committee approvals");
            return (true, "");
        }
        if (p.status != ProposalStatus.CommitteeApproved) return (false, "needs more committee approvals");
        if (block.timestamp < p.voteEnds) return (false, "resident vote still open");
        if (!_quorumMet(p)) return (false, "resident quorum not met");
        if (p.votesFor <= p.votesAgainst) return (false, "residents voted against");
        return (true, "");
    }

    function availableBalance(uint256 societyId) external view returns (uint128) {
        Society storage s = _societies[societyId];
        return s.balance - s.committed;
    }

    function flatInfo(uint256 flatId) external view returns (uint256 societyId, address owner, uint128 maintenance) {
        Flat storage f = _flats[flatId];
        return (f.societyId, f.owner, f.maintenance);
    }

    // ================================================================ internal

    function _approve(uint256 proposalId, Proposal storage p, bytes32 overrideReasonHash) internal {
        _approvedEpoch[proposalId][msg.sender] = _epoch[proposalId] + 1;
        p.approvals += 1;
        _rec(msg.sender, INestPassport.Stat.CommitteeVotes);
        if (p.flagged) _rec(msg.sender, INestPassport.Stat.FlagOverrides);
        emit Approved(proposalId, msg.sender, overrideReasonHash, p.approvals);
        // Tier 2: enough committee approvals opens the resident vote.
        if (effectiveTier(proposalId) == 2 && p.approvals >= requiredApprovals(proposalId)) {
            p.status = ProposalStatus.CommitteeApproved;
            p.voteEnds = uint64(block.timestamp) + _societies[p.societyId].config.votingPeriod;
            emit CommitteeApproved(proposalId, p.voteEnds);
        }
    }

    function _quorumMet(Proposal storage p) internal view returns (bool) {
        uint256 cast = uint256(p.votesFor) + p.votesAgainst;
        Society storage s = _societies[p.societyId];
        return cast * 10000 >= uint256(s.config.quorumBps) * s.totalWeight;
    }

    function _votePassed(Proposal storage p) internal view returns (bool) {
        return _quorumMet(p) && p.votesFor > p.votesAgainst;
    }

    function _release(Proposal storage p) internal {
        _societies[p.societyId].committed -= p.amount;
        vendorMonthCommitted[p.societyId][p.payee][p.month] -= p.amount;
    }

    /// Validates `data` for the kind at proposal time, so a bad proposal fails early (SPEC §5.8 encodings).
    function _checkData(ProposalKind kind, address payee, uint128 amount, bytes calldata data) internal view {
        if (kind == ProposalKind.PayVendor) {
            if (amount == 0 || data.length != 0) revert BadInput();
        } else if (kind == ProposalKind.FundWork) {
            (IMilestoneEscrow.ProjectInput memory pi, IMilestoneEscrow.MilestoneInput[] memory ms) =
                abi.decode(data, (IMilestoneEscrow.ProjectInput, IMilestoneEscrow.MilestoneInput[]));
            uint256 total;
            for (uint256 i; i < ms.length; i++) for (uint256 j; j < ms[i].lineItems.length; j++) total += ms[i].lineItems[j];
            if (pi.contractor != payee || total != amount || amount == 0) revert BadInput();
        } else if (kind == ProposalKind.WorkDecision) {
            (, uint8 action, , ) = abi.decode(data, (uint256, uint8, uint16, bytes32));
            if (action > 2) revert BadInput();
            if (action != 1 && amount != 0) revert BadInput(); // only a dispute carries value (the bond)
        } else {
            // TankerTrust is out of scope for this build (SPEC-CHANGES 2026-09-29): no tanker module, no orders.
            if (address(tanker) == address(0)) revert BadInput();
            (uint32 litres, uint128 price, , ) = abi.decode(data, (uint32, uint128, address, uint32));
            if (uint256(litres) * price != amount || amount == 0) revert BadInput();
        }
    }

    function _dispatch(Proposal storage p) internal returns (uint256 resultRef) {
        if (p.kind == ProposalKind.PayVendor) {
            _send(p.payee, p.amount);
            _rec(p.payee, INestPassport.Stat.InvoicesPaid);
            if (p.flagged) _rec(p.payee, INestPassport.Stat.InvoicesFlagged);
        } else if (p.kind == ProposalKind.FundWork) {
            (IMilestoneEscrow.ProjectInput memory pi, IMilestoneEscrow.MilestoneInput[] memory ms) =
                abi.decode(p.data, (IMilestoneEscrow.ProjectInput, IMilestoneEscrow.MilestoneInput[]));
            pi.payerRef = p.societyId;
            resultRef = milestone.createProject{value: p.amount}(pi, ms);
        } else if (p.kind == ProposalKind.WorkDecision) {
            (uint256 projectId, uint8 action, uint16 mask, bytes32 reasonHash) =
                abi.decode(p.data, (uint256, uint8, uint16, bytes32));
            if (milestone.getAgreement(projectId).payer != address(this)) revert BadInput();
            if (action == 0) milestone.respond(projectId, 0);
            else if (action == 1) milestone.respond{value: p.amount}(projectId, mask);
            else milestone.requestRework(projectId, mask, reasonHash);
            resultRef = projectId;
        } else {
            (uint32 litres, uint128 price, address device, uint32 window) =
                abi.decode(p.data, (uint32, uint128, address, uint32));
            resultRef = tanker.createOrder{value: p.amount}(p.societyId, p.payee, litres, price, device, window);
        }
    }

    function _send(address to, uint256 amt) internal {
        if (amt == 0) return;
        (bool ok, ) = to.call{value: amt}("");
        if (!ok) {
            withdrawable[to] += amt;
            emit PayoutDeferred(to, amt);
        }
    }

    /// The counterparty of a society action is the ledger itself (a module), so only `who` must be verified.
    function _rec(address who, INestPassport.Stat s) internal {
        if (registry.isVerified(who)) passport.record(who, s, 1);
    }
}
