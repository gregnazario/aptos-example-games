import { isInstallRequired, useWallet, WalletItem } from "@aptos-labs/wallet-adapter-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";

export function WalletSelector() {
	const { connected, disconnect, account, wallets } = useWallet();
	const [open, setOpen] = useState(false);

	if (connected) {
		return (
			<div className="flex items-center gap-2">
				<span className="text-sm text-muted-foreground truncate max-w-[200px]">
					{account?.address
						? `${account.address.toString().slice(0, 6)}...${account.address.toString().slice(-4)}`
						: "Connected"}
				</span>
				<Button variant="outline" size="sm" onClick={disconnect}>
					Disconnect
				</Button>
			</div>
		);
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button>Connect Wallet</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Connect a Wallet</DialogTitle>
				</DialogHeader>
				<div className="flex flex-col gap-2">
					{wallets?.map((wallet) => (
						<WalletItem key={wallet.name} wallet={wallet} onConnect={() => setOpen(false)}>
							<div className="flex items-center justify-between w-full rounded-lg border p-3 hover:bg-accent cursor-pointer">
								<div className="flex items-center gap-3">
									<WalletItem.Icon className="h-8 w-8 rounded" />
									<WalletItem.Name className="font-medium" />
								</div>
								{isInstallRequired(wallet) ? (
									<WalletItem.InstallLink className="text-sm text-blue-500 hover:underline" />
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
