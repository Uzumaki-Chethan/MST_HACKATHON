"use client";

// UX gate (not a contract rule): "Offer a lease" is shown to wallets whose registry profile has the LANDLORD role,
// or that own a society flat. Roles stay per agreement on-chain, and a society flat can only be offered by its owner.
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAccount, useReadContract } from "wagmi";
import { Kind } from "@nestledger/shared";
import { useNest } from "@/hooks/useNest";
import { getMyFlats } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/** `undefined` while loading or with no wallet connected. */
export function useCanOfferLease(): boolean | undefined {
  const { address } = useAccount();
  const { session } = useAuth();
  const { contracts } = useNest();
  const profile = useReadContract({
    address: contracts.registry.address!, abi: contracts.registry.abi, functionName: "profileOf", args: [address!],
    query: { enabled: !!address && !!contracts.registry.address },
  });
  const flats = useQuery({ queryKey: ["myFlats", address], queryFn: getMyFlats, enabled: !!address && !!session, retry: false });

  if (!address || !profile.data) return undefined;
  const kinds = Number((profile.data as unknown as { kinds: number }).kinds);
  if (kinds & Kind.LANDLORD) return true;
  if (flats.data?.length) return true;
  // Without a session we can't ask for flats; until then only the landlord role decides.
  if (session && flats.isPending) return undefined;
  return false;
}

export function LandlordRoleNote() {
  return (
    <p className="text-sm text-slate-600">
      Offering a lease needs a landlord profile.{" "}
      <Link className="font-medium text-accent underline" href="/onboard?add=LANDLORD">Add the Landlord role</Link> to your profile.
    </p>
  );
}
