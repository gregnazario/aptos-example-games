import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { type FormEvent, useState } from "react";
import { HowToPlay } from "@/components/HowToPlay";
import { WalletClient } from "@/components/WalletProvider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { aptos } from "@/lib/aptos";
import { MODULE_ADDRESS, NETWORK } from "@/lib/constants";
import { resolveGameTarget } from "@/functions/game";

export const Route = createFileRoute("/")({
  component: LobbyPage,
});

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm" htmlFor={id}>
      <span className="font-medium text-foreground/90">{label}</span>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function LobbyPage() {
  return (
    <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
      <section className="space-y-4 pt-2">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary">
          Fully on-chain match
        </p>
        <h1 className="max-w-xl font-display text-5xl leading-[1.05] tracking-tight text-balance">
          Play tic-tac-toe where every mark is a transaction.
        </h1>
        <p className="max-w-lg text-muted-foreground">
          Create or join a named board on Aptos {NETWORK}. Turns, wins, and
          draws are enforced by Move — not by this website.
        </p>
      </section>

      <div className="space-y-6">
        <JoinCard />
        <WalletClient fallback={<CreatePlaceholder />}>
          <CreateCard />
        </WalletClient>
        <HowToPlay variant="lobby" />
      </div>
    </div>
  );
}

function JoinCard() {
  const navigate = useNavigate();
  const [creator, setCreator] = useState("");
  const [name, setName] = useState("default");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const target = await resolveGameTarget({
        data: { creator: creator.trim(), name: name.trim() },
      });
      await navigate({
        to: "/game/$creator/$name",
        params: {
          creator: target.creatorName || target.creatorAddress,
          name: target.name,
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open that game.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Join a board</CardTitle>
        <CardDescription>
          Anyone can spectate. Use an address or an .apt name.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={(event) => void onSubmit(event)}>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Field
            id="join-creator"
            label="Game creator"
            value={creator}
            onChange={setCreator}
            placeholder="0x… or name.apt"
          />
          <Field
            id="join-name"
            label="Game name"
            value={name}
            onChange={setName}
            placeholder="default"
          />
          <Button type="submit" disabled={pending || !creator.trim()}>
            {pending ? "Opening…" : "Join game"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function CreatePlaceholder() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Start a match</CardTitle>
        <CardDescription>Connect a wallet to create a new board.</CardDescription>
      </CardHeader>
    </Card>
  );
}

function CreateCard() {
  const { account, connected, network, signAndSubmitTransaction } = useWallet();
  const navigate = useNavigate();
  const [gameName, setGameName] = useState("default");
  const [playerX, setPlayerX] = useState("");
  const [playerO, setPlayerO] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const networkName = network?.name ? String(network.name).toLowerCase() : "";
  const wrongNetwork = connected && networkName !== NETWORK;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!account) return;
    setError("");
    setPending(true);
    try {
      const target = await resolveGameTarget({
        data: { creator: account.address.toString(), name: gameName.trim() },
      });
      const x = await resolveGameTarget({
        data: { creator: playerX.trim(), name: gameName.trim() },
      });
      const o = await resolveGameTarget({
        data: { creator: playerO.trim(), name: gameName.trim() },
      });

      const response = await signAndSubmitTransaction({
        data: {
          function: `${MODULE_ADDRESS}::tic_tac_toe::start_game`,
          functionArguments: [gameName.trim(), x.creatorAddress, o.creatorAddress],
        },
      });
      await aptos.waitForTransaction({ transactionHash: response.hash });
      await navigate({
        to: "/game/$creator/$name",
        params: {
          creator: target.creatorName || account.address.toString(),
          name: gameName.trim(),
        },
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not start the game.",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Start a match</CardTitle>
        <CardDescription>
          You become the game creator. Player X and O must be different
          addresses.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!connected && (
          <Alert>
            <AlertDescription>
              Connect your wallet to publish a new board.
            </AlertDescription>
          </Alert>
        )}
        {wrongNetwork && (
          <Alert variant="warning">
            <AlertDescription>
              Wallet is on {network?.name}. Switch to {NETWORK} to create a
              game.
            </AlertDescription>
          </Alert>
        )}
        <form className="space-y-4" onSubmit={(event) => void onSubmit(event)}>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Field
            id="new-name"
            label="Game name"
            value={gameName}
            onChange={setGameName}
            placeholder="default"
          />
          <Field
            id="player-x"
            label="Player X"
            value={playerX}
            onChange={setPlayerX}
            placeholder="Address or .apt name"
          />
          <Field
            id="player-o"
            label="Player O"
            value={playerO}
            onChange={setPlayerO}
            placeholder="Address or .apt name"
          />
          <Button
            type="submit"
            disabled={
              pending ||
              !connected ||
              wrongNetwork ||
              !playerX.trim() ||
              !playerO.trim()
            }
          >
            {pending ? "Starting…" : "Start new game"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
