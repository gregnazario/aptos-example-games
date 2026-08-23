import {
  groupAndSortWallets,
  isInstallRequired,
  useWallet,
  WalletItem,
} from "@aptos-labs/wallet-adapter-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { shortenAddress } from "@/lib/utils";

export function WalletSelector() {
  const { connected, disconnect, account, wallets = [], notDetectedWallets = [] } =
    useWallet();
  const [open, setOpen] = useState(false);
  const { availableWallets, installableWallets } = groupAndSortWallets([
    ...wallets,
    ...notDetectedWallets,
  ]);

  if (connected) {
    const address = account?.address?.toString() ?? "";
    return (
      <div className="flex items-center gap-2">
        <span className="hidden max-w-40 truncate font-mono text-xs text-muted-foreground sm:inline">
          {address ? shortenAddress(address, 5) : "Connected"}
        </span>
        <Button variant="outline" size="sm" onClick={() => void disconnect()}>
          Disconnect
        </Button>
      </div>
    );
  }

  const allWallets = [...availableWallets, ...installableWallets];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Connect wallet</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect a wallet</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {allWallets.map((wallet) => (
            <WalletItem
              key={wallet.name}
              wallet={wallet}
              onConnect={() => setOpen(false)}
            >
              <div className="flex w-full items-center justify-between rounded-2xl border border-border p-3 hover:bg-accent">
                <div className="flex items-center gap-3">
                  <WalletItem.Icon className="size-8 rounded-lg" />
                  <WalletItem.Name className="font-medium" />
                </div>
                {isInstallRequired(wallet) ? (
                  <WalletItem.InstallLink className="text-sm text-primary hover:underline" />
                ) : (
                  <WalletItem.ConnectButton asChild>
                    <Button size="sm">Connect</Button>
                  </WalletItem.ConnectButton>
                )}
              </div>
            </WalletItem>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
