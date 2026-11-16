/** @type {import('@remix-run/dev').AppConfig} */
module.exports = {
  cacheDirectory: "./node_modules/.cache/remix",
  ignoredRouteFiles: [
    "**/.*",
    "**/*.test.{ts,tsx}",
    "**/*.server.ts",
    "**/*.server.tsx",
  ],
  serverModuleFormat: "cjs",
  tailwind: true,
  postcss: true,
  future: {
    // React Router v7 behavior, still on Remix 2.17. The package swap is separate.
    v3_fetcherPersist: true,
    v3_relativeSplatPath: true,
    v3_throwAbortReason: true,
    v3_lazyRouteDiscovery: true,
    v3_singleFetch: true,
  },
  browserNodeBuiltinsPolyfill: {
    modules: {
      util: true,
      punycode: true,
      querystring: true,
      events: true,
    },
  },
};
