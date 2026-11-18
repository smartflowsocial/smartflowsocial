import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { Express, NextFunction, Request, Response } from "express";
import helmet from "helmet";

const NONCE_LOCAL = "nonce";

/**
 * A fresh nonce for this response. React Router receives the same value
 * through `res.locals.nonce` and the root document, so inline scripts can
 * satisfy `script-src` without `'unsafe-inline'`.
 */
export function assignRequestNonce(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  const locals = res.locals as Record<string, unknown>;
  locals[NONCE_LOCAL] = randomBytes(16).toString("base64");
  next();
}

export function readResponseNonce(res: ServerResponse | Response): string {
  const holder = res as { locals?: unknown };
  const locals =
    holder.locals && typeof holder.locals === "object"
      ? (holder.locals as Record<string, unknown>)
      : {};
  const nonce = locals[NONCE_LOCAL];
  if (typeof nonce !== "string" || nonce.length < 16) {
    throw new Error("CSP nonce was not assigned for this request");
  }
  return nonce;
}

function scriptSrc(
  production: boolean
): Array<string | ((req: IncomingMessage, res: ServerResponse) => string)> {
  const sources: Array<
    string | ((req: IncomingMessage, res: ServerResponse) => string)
  > = ["'self'", (_req, res) => `'nonce-${readResponseNonce(res)}'`];
  if (!production) {
    // Vite's dev server injects its HMR client without this request's nonce.
    sources.push("'unsafe-inline'", "'unsafe-eval'");
  }
  return sources;
}

/**
 * Production pages keep a per-request nonce and do not allow eval or inline
 * scripts. Style attributes still need `'unsafe-inline'`: a nonce on
 * `style-src` would make browsers ignore that keyword.
 *
 * `wss:` and `https:` stay because a user can choose any Nostr relay or
 * Blossom server. Development adds the Vite websocket only.
 */
export function securityHeaders(options: {
  production: boolean;
  port: string;
}) {
  const port = options.port || "3000";
  const connectSrc = ["'self'", "wss:", "https:"];
  if (!options.production) {
    connectSrc.push(`ws://localhost:${port}`, `ws://127.0.0.1:${port}`);
  }

  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: scriptSrc(options.production),
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "https:", "blob:"],
        connectSrc,
        workerSrc: ["'self'", "blob:"],
        fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'", "blob:", "https:"],
        frameSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: options.production ? [] : null,
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    frameguard: { action: "deny" },
    noSniff: true,
    xssFilter: true,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  });
}

export function applySecurityHeaders(
  app: Express,
  options: { production: boolean; port: string }
): void {
  app.use(assignRequestNonce);
  app.use(securityHeaders(options));
}
