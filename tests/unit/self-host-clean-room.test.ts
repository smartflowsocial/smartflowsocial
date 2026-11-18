import { describe, expect, it } from "vitest";

import {
  isLoopbackHost,
  versionAtLeast,
} from "../../scripts/self-host-clean-room.mjs";

describe("self-host toolchain check", () => {
  it("accepts the pinned Node release and rejects the previous major", () => {
    expect(versionAtLeast("v26.13.1", "26.13.1")).toBe(true);
    expect(versionAtLeast("v26.14.0", "26.13.1")).toBe(true);
    expect(versionAtLeast("v24.9.0", "26.13.1")).toBe(false);
  });

  it("treats only loopback names as local", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("host.docker.internal")).toBe(false);
  });
});
