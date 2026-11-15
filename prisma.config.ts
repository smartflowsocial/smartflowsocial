import "dotenv/config";
import { defineConfig } from "prisma/config";

import { datasourceUrlForPrismaCommand } from "./app/lib/prisma-command-url";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // generate does not connect. migrate and db commands refuse a placeholder.
    url: datasourceUrlForPrismaCommand(process.env, process.argv),
  },
});
