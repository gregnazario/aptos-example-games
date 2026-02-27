import { Network } from "@aptos-labs/ts-sdk";
import { AptosWalletAdapterProvider } from "@aptos-labs/wallet-adapter-react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");

createRoot(rootEl).render(
	<StrictMode>
		<AptosWalletAdapterProvider
			autoConnect={true}
			dappConfig={{ network: Network.DEVNET }}
			onError={(error) => console.error("Wallet error:", error)}
		>
			<App />
		</AptosWalletAdapterProvider>
	</StrictMode>,
);
