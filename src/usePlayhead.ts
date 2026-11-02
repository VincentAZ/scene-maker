import { useCallback, useState } from "react";

/** User transport commands and renderer acknowledgements have different
 * ownership. A late frame from before a seek must never replace that seek. */
export function usePlayhead() {
  const [state, setState] = useState({ time: 0, seekVersion: 0 });
  const seek = useCallback((time: number) => {
    setState((current) => ({ time, seekVersion: current.seekVersion + 1 }));
  }, []);
  const publish = useCallback((time: number, seekVersion: number) => {
    setState((current) =>
      current.seekVersion === seekVersion && current.time !== time
        ? { ...current, time }
        : current,
    );
  }, []);
  return { ...state, seek, publish };
}
