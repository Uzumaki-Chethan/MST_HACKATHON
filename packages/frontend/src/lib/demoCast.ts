// Public addresses of the demo cast (docs/demo-cast.md, SPEC §11.1). Fictional people, real testnet wallets.
export type CastMember = { alias: string; role: string; address: `0x${string}`; scripted?: boolean };

export const DEMO_CAST: CastMember[] = [
  { alias: "ADMIN", role: "Deployer, verifier", address: "0x6410E1fE8066A5d28af8c4A23edB4Bb788519214", scripted: true },
  { alias: "AGENT", role: "AI attestor", address: "0xe0f03d31682Fe94548730668b56A4068E69b064b" },
  { alias: "KEEPER", role: "Keeper and gas drip", address: "0x1BC151217e4Bc373ce107CB7536408ed0c91e0d9" },
  { alias: "MEERA", role: "Society admin, owner of C-202", address: "0xff5b2001176224d3AE7a6cD87878a2A2285e8FFE" },
  { alias: "ROHAN", role: "Landlord of B-304, homeowner", address: "0x39E0b645025Bf43EBaEBA1C04365eB0BCbD75b31" },
  { alias: "ASHA", role: "Tenant", address: "0x6d7B1fB983c8fa39F98e9e12cBe5c1a5694eD685" },
  { alias: "PRIYA", role: "Owner of A-101, second landlord", address: "0x7BD15bfE4f22C2B621dd96169405001f60A9fbD3" },
  { alias: "C3", role: "Committee, owner of D-101", address: "0x2b0B8897Ca420e62b83C113D6E6a5d7bCEF14698", scripted: true },
  { alias: "C4", role: "Committee, owner of D-102", address: "0xdaf0bB42061CEBeF1bdb1dfD3f81CFDf72C75b86", scripted: true },
  { alias: "C5", role: "Committee, owner of D-103", address: "0x8CA9EC72aaFA6121F2569C27a8A9EC033B2841C7", scripted: true },
  { alias: "IMRAN", role: "Contractor", address: "0x37AB6f674c64D74EF6e7E1B04f1E3877E6A7D433" },
  { alias: "PLUMBER", role: "Vendor", address: "0x509ebe80b4E77d77F919C357Ef291d6b789FD360" },
  { alias: "TANKER", role: "Water supplier", address: "0xeD2327C4380ceD8c1aa3a564CE273e64df0eC648" },
  { alias: "ARB1", role: "Arbiter", address: "0xce8485c91627e185dA92fdEc17b17f83b7a6007D" },
  { alias: "ARB2", role: "Arbiter", address: "0x3DBD77b681C4c97642db780fbE50c113A5c40Ce3", scripted: true },
  { alias: "ARB3", role: "Arbiter", address: "0x7F36FE5864DE83ceED6E99F57a45627629E05d70", scripted: true },
  { alias: "DEVICE_1", role: "Sump sensor", address: "0x375D03eA0d31F8f987e0d41044ca980065541b2E" },
];
