const inflight = new Map<string, Promise<unknown>>();

/**
 * Shares one in-flight computation for a key. A rejection is not remembered,
 * so the next caller may try again.
 */
export async function singleFlight<T>(
  key: string,
  compute: () => Promise<T>
): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const promise = compute();
  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    if (inflight.get(key) === promise) inflight.delete(key);
  }
}

export function resetSingleFlightForTests(): void {
  inflight.clear();
}

export function singleFlightSize(): number {
  return inflight.size;
}
