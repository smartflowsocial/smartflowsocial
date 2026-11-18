import type { AddressInfo } from "node:net";

import express from "express";
import { describe, expect, it } from "vitest";

import {
  applySecurityHeaders,
  readResponseNonce,
} from "~/lib/security-headers.server";

function directive(policy: string, name: string): string {
  const match = policy
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
  if (!match) throw new Error(`CSP is missing ${name}`);
  return match;
}

async function startApp(production: boolean): Promise<{
  origin: string;
  close: () => Promise<void>;
}> {
  const app = express();
  applySecurityHeaders(app, { production, port: "5173" });
  app.get("/", (_req, res) => {
    const nonce = readResponseNonce(res);
    res
      .type("html")
      .send(`<script nonce="${nonce}">window.__hydrated = true</script>`);
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) =>
    server.once("listening", () => resolve())
  );
  const address = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

describe("production security headers", () => {
  it("sends a fresh nonce that matches the inline script and omits development exceptions", async () => {
    const app = await startApp(true);
    try {
      const first = await fetch(`${app.origin}/`);
      const second = await fetch(`${app.origin}/`);
      const firstPolicy = first.headers.get("content-security-policy") ?? "";
      const secondPolicy = second.headers.get("content-security-policy") ?? "";
      const firstScript = directive(firstPolicy, "script-src");
      const secondScript = directive(secondPolicy, "script-src");
      const firstHtml = await first.text();
      const nonce = firstScript.match(/'nonce-([^']+)'/)?.[1] ?? "";

      expect(nonce).not.toBe("");
      expect(Buffer.from(nonce, "base64")).toHaveLength(16);
      expect(firstHtml).toContain(`nonce="${nonce}"`);
      expect(firstScript).not.toBe(secondScript);
      expect(firstScript).not.toContain("'unsafe-inline'");
      expect(firstScript).not.toContain("'unsafe-eval'");
      expect(firstScript).not.toContain("jsdelivr.net");
      expect(firstPolicy).not.toContain("127.0.0.1");
      expect(firstPolicy).not.toContain("localhost");
      expect(firstPolicy).not.toContain(":7242");
      expect(directive(firstPolicy, "connect-src")).toContain("wss:");
      expect(directive(firstPolicy, "connect-src")).toContain("https:");
      expect(directive(firstPolicy, "style-src")).toContain("'unsafe-inline'");
      expect(directive(firstPolicy, "style-src")).not.toContain("nonce-");
      expect(firstPolicy).toContain("upgrade-insecure-requests");
      expect(first.headers.get("x-frame-options")).toBe("DENY");
      expect(first.headers.get("x-content-type-options")).toBe("nosniff");
      expect(first.headers.get("referrer-policy")).toBe(
        "strict-origin-when-cross-origin"
      );
      expect(first.headers.get("strict-transport-security")).toContain(
        "max-age=31536000"
      );
    } finally {
      await app.close();
    }
  });
});

describe("development security headers", () => {
  it("allows the Vite client without opening those exceptions in production", async () => {
    const app = await startApp(false);
    try {
      const response = await fetch(`${app.origin}/`);
      const policy = response.headers.get("content-security-policy") ?? "";
      const script = directive(policy, "script-src");
      const connect = directive(policy, "connect-src");

      expect(script).toContain("'unsafe-inline'");
      expect(script).toContain("'unsafe-eval'");
      expect(script).toMatch(/'nonce-[^']+'/);
      expect(connect).toContain("ws://localhost:5173");
      expect(connect).toContain("ws://127.0.0.1:5173");
      expect(policy).not.toContain(":7242");
      expect(policy).not.toContain("upgrade-insecure-requests");
    } finally {
      await app.close();
    }
  });
});
