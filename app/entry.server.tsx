/**
 * React Router server entry. The request nonce from `loadContext` is passed
 * to `ServerRouter` and to `renderToPipeableStream`. Router scripts use the
 * prop. React's own inline scripts only receive the nonce from the render
 * option.
 */

import { PassThrough } from "node:stream";

import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import { renderToPipeableStream } from "react-dom/server";
import {
  ServerRouter,
  type EntryContext,
  type RouterContextProvider,
} from "react-router";

import { nonceContext } from "#nonce-context";
import { logError } from "~/lib/error-logger.server";
import { initSentry } from "~/lib/sentry.server";
import { withStreamNonce } from "~/lib/stream-nonce.server";

// Initialize Sentry early for server-side error tracking

initSentry();

/**
 * How long single fetch waits for deferred loader promises. The render abort
 * is longer so a timed-out promise can flush before the HTML stream closes.
 */
export const streamTimeout = 5_000;

const ABORT_DELAY = streamTimeout + 1_000;

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  reactRouterContext: EntryContext,
  loadContext: RouterContextProvider
) {
  const nonceValue = loadContext.get(nonceContext);
  const nonce = typeof nonceValue === "string" ? nonceValue : undefined;
  return isbot(request.headers.get("user-agent"))
    ? handleBotRequest(
        request,
        responseStatusCode,
        responseHeaders,
        reactRouterContext,
        nonce
      )
    : handleBrowserRequest(
        request,
        responseStatusCode,
        responseHeaders,
        reactRouterContext,
        nonce
      );
}

function handleBotRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  reactRouterContext: EntryContext,
  nonce: string | undefined
) {
  return new Promise((resolve, reject) => {
    const { abort, pipe } = renderToPipeableStream(
      <ServerRouter
        context={reactRouterContext}
        url={request.url}
        nonce={nonce}
      />,
      withStreamNonce(nonce, {
        onAllReady() {
          const body = new PassThrough();

          responseHeaders.set("Content-Type", "text/html");

          resolve(
            new Response(createReadableStreamFromReadable(body), {
              headers: responseHeaders,
              status: responseStatusCode,
            })
          );

          pipe(body);
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          // Log error through centralized logger
          logError(error instanceof Error ? error : new Error(String(error)), {
            path: request.url,
            method: request.method,
            message: "Error during bot request rendering",
          });
        },
      })
    );

    setTimeout(abort, ABORT_DELAY);
  });
}

function handleBrowserRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  reactRouterContext: EntryContext,
  nonce: string | undefined
) {
  return new Promise((resolve, reject) => {
    const { abort, pipe } = renderToPipeableStream(
      <ServerRouter
        context={reactRouterContext}
        url={request.url}
        nonce={nonce}
      />,
      withStreamNonce(nonce, {
        onShellReady() {
          const body = new PassThrough();

          responseHeaders.set("Content-Type", "text/html");

          resolve(
            new Response(createReadableStreamFromReadable(body), {
              headers: responseHeaders,
              status: responseStatusCode,
            })
          );

          pipe(body);
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          // Log error through centralized logger
          logError(error instanceof Error ? error : new Error(String(error)), {
            path: request.url,
            method: request.method,
            message: "Error during browser request rendering",
          });
          responseStatusCode = 500;
        },
      })
    );

    setTimeout(abort, ABORT_DELAY);
  });
}
