import { useEffect, useState } from "react";
import { get } from "../../../api/client";

export interface WaveformData {
  buckets: number;
  duration: number;
  peaks: number[];
}

// In-memory cache so re-renders / re-opens of the same track are instant.
const cache = new Map<string, WaveformData>();
const MAX_CACHE = 200;

export function useWaveform(
  rootId: string,
  path: string
): { data: WaveformData | null; loading: boolean } {
  const [state, setState] = useState<{ data: WaveformData | null; loading: boolean }>({
    data: null,
    loading: false,
  });
  const key = `${rootId}|${path}`;

  useEffect(() => {
    let cancelled = false;
    const cached = cache.get(key);
    if (cached) {
      setState({ data: cached, loading: false });
      return;
    }
    setState({ data: null, loading: true });
    get<WaveformData>("/audio/waveform", { root: rootId, path })
      .then((d) => {
        if (cancelled) return;
        cache.set(key, d);
        if (cache.size > MAX_CACHE) {
          const oldest = cache.keys().next().value as string | undefined;
          if (oldest) cache.delete(oldest);
        }
        setState({ data: d, loading: false });
      })
      .catch(() => {
        if (!cancelled) setState({ data: null, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return state;
}
