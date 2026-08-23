import { AptosWalletAdapterProvider } from "@aptos-labs/wallet-adapter-react";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { APTOS_NETWORK } from "@/lib/constants";

const WalletMountedContext = createContext(false);

function useWalletMounted() {
  return useContext(WalletMountedContext);
}

/**
 * AptosWalletAdapterProvider is client-only (wallets/localStorage).
 * Anything that calls `useWallet()` must render inside `<WalletClient>`.
 */
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
      dappConfig={{ network: APTOS_NETWORK }}
      optInWallets={["Petra"]}
      onError={(error) => {
        console.error("Wallet adapter error", error);
      }}
    >
      {tree}
    </AptosWalletAdapterProvider>
  );
}

export function WalletClient({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const mounted = useWalletMounted();
  return mounted ? children : fallback;
}
