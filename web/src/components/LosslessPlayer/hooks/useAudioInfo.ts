import { useEffect, useState } from "react";
import { fetchAudioInfo, type AudioInfo } from "../../../lib/audioQuality";

export function useAudioInfo(rootId: string, path: string): { info: AudioInfo | null; loading: boolean } {
  const [state, setState] = useState<{ info: AudioInfo | null; loading: boolean }>({
    info: null,
    loading: false,
  });
  const key = `${rootId}|${path}`;

  useEffect(() => {
    let cancelled = false;
    setState({ info: null, loading: true });
    fetchAudioInfo(rootId, path).then((info) => {
      if (cancelled) return;
      setState({ info, loading: false });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}
