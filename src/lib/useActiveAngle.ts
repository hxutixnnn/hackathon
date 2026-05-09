import { useEffect, useRef, useState } from "react";
import type { AngleSummary } from "../components/Constellation";

const DEBOUNCE_MS = 200;
const ACTIVE_WINDOW_MS = 1500;

export function useActiveAngle(summaries: AngleSummary[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (summaries.length === 0) return;
    const latest = summaries.reduce((acc, s) => (s.latestAt > acc.latestAt ? s : acc));
    const ageMs = Date.now() - latest.latestAt;
    if (ageMs > ACTIVE_WINDOW_MS) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setActive(latest.angle);
      if (clearRef.current) clearTimeout(clearRef.current);
      clearRef.current = setTimeout(() => setActive(null), ACTIVE_WINDOW_MS - ageMs);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (clearRef.current) clearTimeout(clearRef.current);
    };
  }, [summaries]);

  return active;
}
