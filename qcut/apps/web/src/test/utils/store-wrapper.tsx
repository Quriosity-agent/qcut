import { ReactNode, useEffect, useState } from "react";
import { resetAllStores } from "./store-helpers";

export function StoreTestWrapper({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await resetAllStores();
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    // Prevent children from mounting until reset completes
    return null;
  }

  return <>{children}</>;
}
