import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export function NotFound({ children }: { children?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-start gap-4 px-6 py-16">
      <h1 className="font-display text-3xl">Board not found</h1>
      <p className="text-muted-foreground">
        {children ?? "That page does not exist."}
      </p>
      <Button asChild>
        <Link to="/">Back to the lobby</Link>
      </Button>
    </div>
  );
}
