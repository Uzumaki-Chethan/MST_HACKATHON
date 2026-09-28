// Mirrors of the Solidity enums in Appendix A. Order is fixed: index = on-chain value.

export const Kind = {
  TENANT: 1, LANDLORD: 2, HOMEOWNER: 4, CONTRACTOR: 8,
  VENDOR: 16, SUPPLIER: 32, COMMITTEE: 64, ARBITER: 128,
} as const;
export type KindName = keyof typeof Kind;

export const Stat = [
  "RentOnTime", "RentLate", "LeasesCompleted", "DepositFullRefunds",
  "DepositsReturned", "DeductionsUpheld", "DeductionsRejected",
  "MilestonesApproved", "MilestonesOnTime", "MilestonesLate",
  "ProjectsCompleted", "ProjectsAbandoned",
  "PromptDecisions", "SilentDecisions",
  "DisputesWon", "DisputesLost",
  "InvoicesPaid", "InvoicesFlagged", "Deliveries", "DeliveryAccuracyBpsSum",
  "CommitteeVotes", "FlagOverrides",
] as const;

export const TrancheStatus = ["Pending", "Open", "Claimed", "Disputed", "Settled", "Refunded"] as const;
export const LeaseStatus = ["Offered", "Active", "MovingOut", "Closed", "Cancelled"] as const;
export const BaselineStatus = ["None", "Submitted", "Agreed", "Contested", "PresumedAccepted"] as const;
export const ProjectStatus = ["AwaitingAcceptance", "Active", "Completed", "Cancelled"] as const;
export const DisputeStatus = ["Open", "Resolved"] as const;
export const ProposalKind = ["PayVendor", "FundWork", "WorkDecision", "TankerOrder"] as const;
export const ProposalStatus = ["Pending", "CommitteeApproved", "Executed", "Rejected", "Cancelled"] as const;
export const OrderStatus = ["Open", "Delivering", "Settled", "Expired"] as const;

/** WorkDecision `action` values (SPEC §5.8). */
export const WorkAction = { Accept: 0, Dispute: 1, Rework: 2 } as const;

/** Custom errors shared by every contract (SPEC §5.1). */
export const ContractErrors = [
  "NotParty", "BadStatus", "WindowClosed", "WindowOpen", "BadAmount", "BadInput", "NotAuthorized",
] as const;

export const MAX_ITEMS = 10;
export const MAX_MILESTONES = 12;
