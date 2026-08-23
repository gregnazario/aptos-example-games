import {
  ErrorComponent,
  Link,
  useLocation,
  useRouter,
} from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export function DefaultCatchBoundary({ error }: ErrorComponentProps) {
  const router = useRouter();
  const isRoot = useLocation({
    select: (location) => location.pathname === "/",
  });

  console.error(error);

  return (
    <div className="mx-auto flex max-w-lg flex-col items-start gap-4 px-6 py-16">
      <h1 className="font-display text-3xl">Something went sideways</h1>
      <ErrorComponent error={error} />
      <div className="flex gap-3">
        <Button
          type="button"
          onClick={() => {
            void router.invalidate();
          }}
        >
          Try again
        </Button>
        {isRoot ? (
          <Button variant="outline" asChild>
            <Link to="/">Home</Link>
          </Button>
        ) : (
          <Button
            variant="outline"
            type="button"
            onClick={() => window.history.back()}
          >
            Go back
          </Button>
        )}
      </div>
    </div>
  );
}
