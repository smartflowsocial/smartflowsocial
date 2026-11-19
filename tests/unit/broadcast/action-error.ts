import { expect } from "vitest";

import { BroadcastActionError } from "~/features/broadcast/broadcast-actions-shared.server";

export function anyDate(): Date {
  return expect.any(Date) as Date;
}

export function objectContaining<T extends object>(value: T): T {
  return expect.objectContaining(value) as T;
}

export async function captureBroadcastActionError(
  promise: Promise<unknown>
): Promise<BroadcastActionError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof BroadcastActionError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected BroadcastActionError");
}
