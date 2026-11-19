import { describe, expect, it } from "vitest";

import { serializeLookupLoaderError } from "~/features/search/services/lookup-loader-error.server";
import {
  AuthenticationError,
  ExternalServiceError,
  LookupUnsupportedKindError,
  NotFoundError,
  ValidationError,
} from "~/lib/errors";

describe("serializeLookupLoaderError", () => {
  it("maps validation, not found, unsupported, and external errors", () => {
    expect(
      serializeLookupLoaderError(
        new ValidationError("bad input", { field: "q" })
      )
    ).toEqual({
      code: "INVALID_INPUT",
      context: { field: "q" },
      message: "bad input",
    });
    expect(
      serializeLookupLoaderError(new NotFoundError("missing", { id: "1" }))
    ).toEqual({
      code: "NOT_FOUND",
      context: { id: "1" },
      message: "missing",
    });
    expect(
      serializeLookupLoaderError(
        new LookupUnsupportedKindError("unsupported kind", { kind: 6 })
      )
    ).toEqual({
      code: "UNSUPPORTED",
      context: { kind: 6 },
      message: "unsupported kind",
    });
    expect(
      serializeLookupLoaderError(
        new ExternalServiceError("cache down", 502, { service: "PrimalCache" })
      )
    ).toEqual({
      code: "EXTERNAL_ERROR",
      context: { service: "PrimalCache" },
      message: "cache down",
    });
  });

  it("omits context when the lookup error has none", () => {
    const payload = serializeLookupLoaderError(new ValidationError(""));
    expect(payload).toMatchObject({
      code: "INVALID_INPUT",
      message: "",
    });
    expect(payload.context).toBeUndefined();
    expect(serializeLookupLoaderError(new NotFoundError()).message).toBe(
      "Resource not found"
    );
  });

  it("classifies other app errors as unknown", () => {
    expect(
      serializeLookupLoaderError(
        new AuthenticationError("not authenticated", { reason: "session" })
      )
    ).toEqual({
      code: "UNKNOWN",
      context: { reason: "session" },
      message: "not authenticated",
    });
  });

  it("normalizes a plain Error and a non-error value", () => {
    expect(serializeLookupLoaderError(new Error("nope"))).toEqual({
      code: "UNKNOWN",
      context: { originalError: "nope" },
      message: "nope",
    });
    expect(serializeLookupLoaderError(new Error(""))).toEqual({
      code: "UNKNOWN",
      context: { originalError: "" },
      message: "An unexpected error occurred",
    });
    expect(serializeLookupLoaderError(null)).toEqual({
      code: "UNKNOWN",
      context: { originalError: "null" },
      message: "An unexpected error occurred",
    });
  });

  it("keeps a duck-typed error message without treating it as a lookup code", () => {
    expect(
      serializeLookupLoaderError({
        code: "TEAPOT",
        context: { pot: true },
        message: "short and stout",
        statusCode: 418,
      })
    ).toEqual({
      code: "UNKNOWN",
      context: { pot: true },
      message: "short and stout",
    });
  });

  it("maps a thrown dependency message that normalizeError rewrites", () => {
    expect(
      serializeLookupLoaderError(new Error("Unique constraint failed"))
    ).toEqual({
      code: "UNKNOWN",
      context: { originalError: "Unique constraint failed" },
      message: "A record with this information already exists",
    });
  });
});
