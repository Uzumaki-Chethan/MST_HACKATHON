import type { HardhatRuntimeEnvironment } from "hardhat/types";

// Replaced by the full SPEC §5.10 deploy in step A1.
export async function deployAll(_hre: HardhatRuntimeEnvironment) {
  return {} as Record<string, { address: string; constructorArguments: unknown[] }>;
}
