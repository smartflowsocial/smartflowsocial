import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, type Plugin } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const serverStubPrefix = "\0server-only:";

/**
 * Remix replaced `.server` modules with an empty module in the browser
 * bundle. React Router fails the client build instead. Barrels still
 * re-export those modules next to client components, so the client build
 * stubs them. Calling one from the browser throws.
 */
function stubServerModulesInClient(): Plugin {
  return {
    name: "stub-server-modules-in-client",
    enforce: "pre",
    resolveId(id) {
      if (this.environment.name !== "client") return null;
      if (id.startsWith(serverStubPrefix) || id.includes("node_modules")) {
        return null;
      }
      if (!id.endsWith(".server") && !/\.server\.[cm]?[jt]sx?$/.test(id)) {
        return null;
      }
      return serverStubPrefix + id;
    },
    load(id) {
      if (!id.startsWith(serverStubPrefix)) return null;
      return {
        code: `
          function serverOnly() {
            throw new Error("Server-only module was imported by client code");
          }
          export default serverOnly;
        `,
        syntheticNamedExports: true,
      };
    },
  };
}

export default defineConfig({
  plugins: [stubServerModulesInClient(), reactRouter(), tsconfigPaths()],
});
