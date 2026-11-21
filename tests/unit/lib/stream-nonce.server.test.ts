import { createHash } from "node:crypto";
import { PassThrough } from "node:stream";

import { createElement, Suspense, use } from "react";
import { renderToPipeableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { withStreamNonce } from "~/lib/stream-nonce.server";

const SHELL_SCRIPT =
  "requestAnimationFrame(function(){$RT=performance.now()});";

function sha256(body: string): string {
  return createHash("sha256").update(body).digest("base64");
}

function streamSuspendingPage(nonce: string | undefined): Promise<string> {
  return new Promise((resolve, reject) => {
    let resolveValue: (value: string) => void = () => {};
    const pending = new Promise<string>((resolvePending) => {
      resolveValue = resolvePending;
    });

    function Suspended() {
      return createElement("p", null, use(pending));
    }

    const tree = createElement(
      "div",
      null,
      createElement("h1", null, "Plans"),
      createElement(
        Suspense,
        { fallback: createElement("p", null, "loading") },
        createElement(Suspended)
      )
    );

    const chunks: Buffer[] = [];
    const { pipe } = renderToPipeableStream(
      tree,
      withStreamNonce(nonce, {
        onShellReady() {
          const body = new PassThrough();
          body.on("data", (chunk: Buffer) => chunks.push(chunk));
          body.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
          body.on("error", reject);
          pipe(body);
          setTimeout(() => resolveValue("ready"), 20);
        },
        onShellError: reject,
        onError(error: unknown) {
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      })
    );
  });
}

function inlineScripts(html: string): Array<{ attrs: string; body: string }> {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].map(
    (match) => ({
      attrs: match[1] ?? "",
      body: match[2] ?? "",
    })
  );
}

describe("withStreamNonce", () => {
  it("puts the request nonce on React's shell and suspense scripts", async () => {
    const nonce = "F+x7/WFyrR2N67tHnfCj76Q==";
    const markup = await streamSuspendingPage(nonce);
    const scripts = inlineScripts(markup);
    const shell = scripts.find((script) => script.body === SHELL_SCRIPT);
    const reveal = scripts.find((script) => script.body.includes("$RC("));

    expect(shell, markup).toBeDefined();
    expect(reveal, markup).toBeDefined();
    expect(shell?.attrs).toContain(`nonce="${nonce}"`);
    expect(reveal?.attrs).toContain(`nonce="${nonce}"`);
    expect(markup).not.toMatch(/<style[^>]*\bnonce=/);
    expect(sha256(SHELL_SCRIPT)).toBe(
      "7mu4H06fwDCjmnxxr/xNHyuQC6pLTHr4M2E4jXw5WZs="
    );
  });

  it("leaves React's inline scripts unchanged when the request has no nonce", async () => {
    const markup = await streamSuspendingPage(undefined);
    const shell = inlineScripts(markup).find(
      (script) => script.body === SHELL_SCRIPT
    );

    expect(shell, markup).toBeDefined();
    expect(shell?.attrs).not.toContain("nonce");
  });
});
