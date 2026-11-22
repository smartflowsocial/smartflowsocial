import { beforeEach, describe, expect, it, vi } from "vitest";

interface BasicUser {
  npub: string | null;
  isChild: boolean;
  parentNpub: string | null;
}

interface PlanRow {
  name?: string;
  enableRelayBlast?: boolean;
}

interface SubscriptionRow {
  status?: string;
  Plan?: PlanRow | null;
}

interface FanoutInput {
  subscriptionActive: boolean;
  planEnablesRelayBlast: boolean;
}

interface PolicyBody {
  mode: "blacklist" | "whitelist";
  enabled: boolean;
}

interface ActionBody {
  status: number;
  error?: string;
  success?: boolean;
}

const payments = vi.hoisted(() => ({
  getUserSubscription:
    vi.fn<(userId: string) => Promise<SubscriptionRow | null>>(),
}));

const access = vi.hoisted(() => ({
  relayFanoutForSubscription: vi.fn<(input: FanoutInput) => boolean>(),
}));

const users = vi.hoisted(() => ({
  getUserBasicInfo: vi.fn<(userId: string) => Promise<BasicUser | null>>(),
}));

const blastr = vi.hoisted(() => ({
  addPolicyRelay:
    vi.fn<
      (
        pubkeyHex: string,
        relayUrl: string,
        action: "allow" | "block"
      ) => Promise<boolean>
    >(),
  putUserPolicy:
    vi.fn<(pubkeyHex: string, body: PolicyBody) => Promise<boolean>>(),
  removePolicyRelay:
    vi.fn<(pubkeyHex: string, relayUrl: string) => Promise<boolean>>(),
  resolvePubkeyHex: vi.fn<(npubOrHex: string) => string | null>(),
}));

vi.mock("~/features/payments/data", () => ({
  getRelayFanoutSubscription: (userId: string) =>
    payments.getUserSubscription(userId),
  getUserSubscription: payments.getUserSubscription,
}));
vi.mock(
  "~/features/payments/entitlements/deployment-mode.server",
  () => access
);
vi.mock("~/features/user", () => users);
vi.mock("~/infra/blastr/blastr-admin.client.server", () => blastr);

import { handleBlastrPolicyAction } from "~/features/settings/actions/blastr-policy-actions.server";

const PARENT = "11".repeat(32);
const HEX = "ab".repeat(32);

function form(entries: Record<string, string> = {}): FormData {
  const body = new FormData();
  for (const [key, value] of Object.entries(entries)) body.set(key, value);
  return body;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseJson(text: string): unknown {
  return JSON.parse(text);
}

async function readAction(result: unknown): Promise<ActionBody> {
  if (result instanceof Response) {
    const payload = parseJson(await result.text());
    return {
      status: result.status,
      ...(isRecord(payload) ? pick(payload) : {}),
    };
  }
  if (
    isRecord(result) &&
    result["type"] === "DataWithResponseInit" &&
    "data" in result
  ) {
    const init = result["init"];
    const status =
      isRecord(init) && typeof init["status"] === "number"
        ? init["status"]
        : 200;
    const payload = result["data"];
    return {
      status,
      ...(isRecord(payload) ? pick(payload) : {}),
    };
  }
  if (isRecord(result)) return { status: 200, ...pick(result) };
  return { status: 0 };
}

function pick(payload: Record<string, unknown>): Omit<ActionBody, "status"> {
  const body: Omit<ActionBody, "status"> = {};
  if (typeof payload["error"] === "string") body.error = payload["error"];
  if (typeof payload["success"] === "boolean") {
    body.success = payload["success"];
  }
  return body;
}

describe("handleBlastrPolicyAction", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    users.getUserBasicInfo.mockResolvedValue({
      npub: PARENT,
      isChild: false,
      parentNpub: null,
    });
    payments.getUserSubscription.mockResolvedValue({
      status: "ACTIVE",
      Plan: { name: "Pro", enableRelayBlast: true },
    });
    access.relayFanoutForSubscription.mockImplementation(
      (input) => input.subscriptionActive && input.planEnablesRelayBlast
    );
    blastr.resolvePubkeyHex.mockReturnValue(HEX);
    blastr.putUserPolicy.mockResolvedValue(true);
    blastr.addPolicyRelay.mockResolvedValue(true);
    blastr.removePolicyRelay.mockResolvedValue(true);
  });

  it("returns null for an unrelated action", async () => {
    await expect(
      handleBlastrPolicyAction("user-1", "pause", form())
    ).resolves.toBeNull();
    expect(users.getUserBasicInfo).not.toHaveBeenCalled();
    expect(payments.getUserSubscription).not.toHaveBeenCalled();
  });

  it("requires an npub before checking fan-out", async () => {
    users.getUserBasicInfo.mockResolvedValueOnce(null);
    const missing = await readAction(
      await handleBlastrPolicyAction("user-1", "update_blastr_policy", form())
    );
    expect(missing).toEqual({ status: 403, error: "Blastr access required" });

    users.getUserBasicInfo.mockResolvedValueOnce({
      npub: "",
      isChild: false,
      parentNpub: null,
    });
    const blank = await readAction(
      await handleBlastrPolicyAction("user-1", "update_blastr_policy", form())
    );
    expect(blank).toEqual({ status: 403, error: "Blastr access required" });
    expect(access.relayFanoutForSubscription).not.toHaveBeenCalled();
    expect(blastr.resolvePubkeyHex).not.toHaveBeenCalled();
  });

  it("denies access unless the subscription is active and blast is enabled", async () => {
    const cases: Array<SubscriptionRow | null> = [
      null,
      { status: "CANCELED", Plan: { enableRelayBlast: true } },
      { status: "ACTIVE", Plan: { enableRelayBlast: false } },
      { status: "ACTIVE", Plan: null },
      { status: "ACTIVE" },
    ];
    for (const subscription of cases) {
      payments.getUserSubscription.mockResolvedValueOnce(subscription);
      const body = await readAction(
        await handleBlastrPolicyAction("user-1", "update_blastr_policy", form())
      );
      expect(body).toEqual({ status: 403, error: "Blastr access required" });
    }
    expect(blastr.resolvePubkeyHex).not.toHaveBeenCalled();
    expect(access.relayFanoutForSubscription).toHaveBeenCalledWith({
      subscriptionActive: false,
      planEnablesRelayBlast: false,
    });
    expect(access.relayFanoutForSubscription).toHaveBeenCalledWith({
      subscriptionActive: false,
      planEnablesRelayBlast: true,
    });
    expect(access.relayFanoutForSubscription).toHaveBeenCalledWith({
      subscriptionActive: true,
      planEnablesRelayBlast: false,
    });
  });

  it("denies access when the pubkey cannot be resolved", async () => {
    blastr.resolvePubkeyHex.mockReturnValue(null);
    const body = await readAction(
      await handleBlastrPolicyAction(
        "user-1",
        "update_blastr_policy",
        form({ mode: "whitelist", enabled: "true" })
      )
    );
    expect(body).toEqual({ status: 403, error: "Blastr access required" });
    expect(blastr.resolvePubkeyHex).toHaveBeenCalledWith(PARENT);
    expect(blastr.putUserPolicy).not.toHaveBeenCalled();
    expect(users.getUserBasicInfo).toHaveBeenCalledWith("user-1");
    expect(payments.getUserSubscription).toHaveBeenCalledWith("user-1");
  });

  describe("update_blastr_policy", () => {
    it("saves whitelist and blacklist flags", async () => {
      const enabled = await readAction(
        await handleBlastrPolicyAction(
          "user-1",
          "update_blastr_policy",
          form({ mode: "whitelist", enabled: "true" })
        )
      );
      expect(enabled).toEqual({ status: 200, success: true });
      expect(blastr.putUserPolicy).toHaveBeenCalledWith(HEX, {
        mode: "whitelist",
        enabled: true,
      });

      const disabled = await readAction(
        await handleBlastrPolicyAction(
          "user-1",
          "update_blastr_policy",
          form({ mode: "Whitelist", enabled: "TRUE" })
        )
      );
      expect(disabled).toEqual({ status: 200, success: true });
      expect(blastr.putUserPolicy).toHaveBeenLastCalledWith(HEX, {
        mode: "blacklist",
        enabled: false,
      });

      await handleBlastrPolicyAction("user-1", "update_blastr_policy", form());
      expect(blastr.putUserPolicy).toHaveBeenLastCalledWith(HEX, {
        mode: "blacklist",
        enabled: false,
      });
    });

    it("returns 502 when the policy update fails", async () => {
      blastr.putUserPolicy.mockResolvedValue(false);
      const body = await readAction(
        await handleBlastrPolicyAction(
          "user-1",
          "update_blastr_policy",
          form({ mode: "blacklist", enabled: "false" })
        )
      );
      expect(body).toEqual({
        status: 502,
        error: "Failed to update Blastr policy",
      });
    });

    it("propagates a thrown Error or string", async () => {
      blastr.putUserPolicy.mockRejectedValueOnce(new Error("blastr down"));
      await expect(
        handleBlastrPolicyAction("user-1", "update_blastr_policy", form())
      ).rejects.toThrow("blastr down");
      blastr.putUserPolicy.mockRejectedValueOnce("blastr down");
      await expect(
        handleBlastrPolicyAction("user-1", "update_blastr_policy", form())
      ).rejects.toBe("blastr down");
    });
  });

  describe("add_blastr_policy_relay", () => {
    it("requires a relay url", async () => {
      const missing = await readAction(
        await handleBlastrPolicyAction(
          "user-1",
          "add_blastr_policy_relay",
          form()
        )
      );
      expect(missing).toEqual({ status: 400, error: "relay_url required" });

      const blank = await readAction(
        await handleBlastrPolicyAction(
          "user-1",
          "add_blastr_policy_relay",
          form({ relay_url: "   " })
        )
      );
      expect(blank).toEqual({ status: 400, error: "relay_url required" });

      const file = new FormData();
      file.set(
        "relay_url",
        new File(["wss://relay.example"], "relay.txt", { type: "text/plain" })
      );
      const uploaded = await readAction(
        await handleBlastrPolicyAction(
          "user-1",
          "add_blastr_policy_relay",
          file
        )
      );
      expect(uploaded).toEqual({ status: 400, error: "relay_url required" });
      expect(blastr.addPolicyRelay).not.toHaveBeenCalled();
    });

    it("trims the url and maps allow versus every other action to block", async () => {
      const allowed = await readAction(
        await handleBlastrPolicyAction(
          "user-1",
          "add_blastr_policy_relay",
          form({ relay_url: "  wss://relay.example  ", action: "allow" })
        )
      );
      expect(allowed).toEqual({ status: 200, success: true });
      expect(blastr.addPolicyRelay).toHaveBeenCalledWith(
        HEX,
        "wss://relay.example",
        "allow"
      );

      const blocked = await readAction(
        await handleBlastrPolicyAction(
          "user-1",
          "add_blastr_policy_relay",
          form({ relay_url: "wss://other.example", action: "Allow" })
        )
      );
      expect(blocked).toEqual({ status: 200, success: true });
      expect(blastr.addPolicyRelay).toHaveBeenLastCalledWith(
        HEX,
        "wss://other.example",
        "block"
      );
    });

    it("returns 502 when the relay cannot be added", async () => {
      blastr.addPolicyRelay.mockResolvedValue(false);
      const body = await readAction(
        await handleBlastrPolicyAction(
          "user-1",
          "add_blastr_policy_relay",
          form({ relay_url: "wss://relay.example", action: "block" })
        )
      );
      expect(body).toEqual({
        status: 502,
        error: "Failed to add relay to Blastr policy",
      });
      expect(blastr.addPolicyRelay).toHaveBeenCalledWith(
        HEX,
        "wss://relay.example",
        "block"
      );
    });
  });

  describe("remove_blastr_policy_relay", () => {
    it("requires a relay url and trims a successful removal", async () => {
      const missing = await readAction(
        await handleBlastrPolicyAction(
          "user-1",
          "remove_blastr_policy_relay",
          form()
        )
      );
      expect(missing).toEqual({ status: 400, error: "relay_url required" });

      const blank = await readAction(
        await handleBlastrPolicyAction(
          "user-1",
          "remove_blastr_policy_relay",
          form({ relay_url: "  " })
        )
      );
      expect(blank).toEqual({ status: 400, error: "relay_url required" });

      const removed = await readAction(
        await handleBlastrPolicyAction(
          "user-1",
          "remove_blastr_policy_relay",
          form({ relay_url: "  wss://relay.example  " })
        )
      );
      expect(removed).toEqual({ status: 200, success: true });
      expect(blastr.removePolicyRelay).toHaveBeenCalledWith(
        HEX,
        "wss://relay.example"
      );
    });

    it("returns 502 when the relay cannot be removed", async () => {
      blastr.removePolicyRelay.mockResolvedValue(false);
      const body = await readAction(
        await handleBlastrPolicyAction(
          "user-1",
          "remove_blastr_policy_relay",
          form({ relay_url: "wss://relay.example" })
        )
      );
      expect(body).toEqual({
        status: 502,
        error: "Failed to remove relay from Blastr policy",
      });
    });
  });
});
