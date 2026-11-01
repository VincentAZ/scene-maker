/** Shared planner steps support deterministic synchronous tests and cooperative
 * viewport preparation. No wall-clock time participates in the planned motion. */
export function finishNavigationWork<T>(work: Generator<void, T, unknown>): T {
  for (;;) {
    const step = work.next();
    if (step.done) return step.value;
  }
}

export async function runNavigationWork<T>(
  work: Generator<void, T, unknown>,
  options: { signal?: AbortSignal; onYield?: () => void } = {},
): Promise<T> {
  let finished = false;
  // Timer clamping can turn hundreds of small batches into minutes in a
  // background tab. Message tasks yield to input/rendering without that delay.
  const channel = new MessageChannel();
  const schedule = () =>
    new Promise<void>((resolve) => {
      channel.port1.onmessage = () => resolve();
      channel.port2.postMessage(null);
    });
  try {
    for (;;) {
      // Always yield before the first expensive step, so loading state paints.
      options.onYield?.();
      await schedule();
      const until = performance.now() + 8;
      do {
        options.signal?.throwIfAborted();
        const step = work.next();
        if (step.done) {
          finished = true;
          options.onYield?.();
          return step.value;
        }
      } while (performance.now() < until);
    }
  } finally {
    channel.port1.close();
    channel.port2.close();
    if (!finished) work.return(undefined as T);
  }
}
