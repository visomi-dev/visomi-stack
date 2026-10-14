/** Stop scheduling, drain owned work, then exit; registering a signal handler disables Node's default exit. */
export function stopWorkerRuntime(
  stops: readonly (() => Promise<void>)[],
  context: { exit: (code: number) => void; failed: () => void },
): () => void {
  let stopping = false;
  const drain = async () => {
    const results = await Promise.allSettled(
      stops.map(async (stop) => {
        await stop();
      }),
    );

    if (results.some((result) => result.status === 'rejected')) {
      context.failed();
      context.exit(1);

      return;
    }

    context.exit(0);
  };

  return () => {
    if (stopping) {
      return;
    }

    stopping = true;
    void drain();
  };
}
