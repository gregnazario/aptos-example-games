import { AptosWalletAdapterProvider } from "@aptos-labs/wallet-adapter-react";
import { Network } from "@aptos-labs/ts-sdk";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

const WalletMountedContext = createContext(false);

export function useWalletMounted() {
  return useContext(WalletMountedContext);
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const tree = (
    <WalletMountedContext.Provider value={mounted}>
      {children}
    </WalletMountedContext.Provider>
  );

  if (!mounted) return tree;

  return (
    <AptosWalletAdapterProvider
      autoConnect
      dappConfig={{ network: Network.DEVNET }}
      optInWallets={["Petra"]}
      onError={(error) => {
        console.error("Wallet adapter error", error);
      }}
    >
      {tree}
    </AptosWalletAdapterProvider>
  );
}
