import { Link } from "@tanstack/react-router";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useWalletMounted } from "@/components/WalletProvider";
import { WalletSelector } from "@/components/WalletSelector";
import { NETWORK } from "@/lib/constants";

function NetworkPill() {
  const { network, connected } = useWallet();
  const name = network?.name ? String(network.name) : NETWORK;
  const ok = name.toLowerCase() === NETWORK;

  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${
        !connected
          ? "border-border text-muted-foreground"
          : ok
            ? "border-primary/40 text-primary"
            : "border-destructive/40 text-destructive"
      }`}
    >
      {name}
    </span>
  );
}

export function SiteHeader() {
  const mounted = useWalletMounted();

  return (
    <header className="relative z-10 mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-6">
      <Link to="/" className="group flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-2xl border border-primary/30 bg-primary/10 font-display text-lg text-primary">
          ⨯○
        </span>
        <span>
          <span className="block font-display text-xl leading-none tracking-tight">
            Aptos Tic-Tac-Toe
          </span>
          <span className="text-xs text-muted-foreground">
            On-chain, multiplayer, uncheatable
          </span>
        </span>
      </Link>
      <div className="flex items-center gap-3">
        {mounted ? (
          <>
            <NetworkPill />
            <WalletSelector />
          </>
        ) : (
          <>
            <span className="rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {NETWORK}
            </span>
            <span className="rounded-full border border-border px-3 py-2 text-xs text-muted-foreground">
              Connect wallet
            </span>
          </>
        )}
      </div>
    </header>
  );
}
