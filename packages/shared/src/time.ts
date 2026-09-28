// SPEC §4.6. Every window is a parameter; these are the two presets (seconds).
const HOUR = 3600, DAY = 86400;

export const WINDOWS = {
  demo: {
    period: 90, periods: 2, grace: 30, baselineWindow: 90, claimWindow: 120,
    responseWindowLease: 90, responseWindowProject: 90, milestoneDuration: 300, reworkWindow: 180,
    minScore: 80, maxRounds: 2, votingPeriod: 120, attestTimeout: 60, arbiterVotingWindow: 300,
    deliveryWindow: 600, toleranceBps: 200, tierMinPayments: 2,
  },
  production: {
    period: 30 * DAY, periods: 11, grace: 5 * DAY, baselineWindow: 48 * HOUR, claimWindow: 14 * DAY,
    responseWindowLease: 7 * DAY, responseWindowProject: 5 * DAY, milestoneDuration: 28 * DAY, reworkWindow: 7 * DAY,
    minScore: 80, maxRounds: 2, votingPeriod: 7 * DAY, attestTimeout: 24 * HOUR, arbiterVotingWindow: 5 * DAY,
    deliveryWindow: 6 * HOUR, toleranceBps: 200, tierMinPayments: 6,
  },
} as const;
export type WindowPreset = keyof typeof WINDOWS;

export const nowSec = () => Math.floor(Date.now() / 1000);
