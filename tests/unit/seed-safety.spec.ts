import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("synthetic seed safety", () => {
  it("rejects destructive replacement in production before connecting to a database", () => {
    const result = spawnSync(
      process.execPath,
      ["node_modules/tsx/dist/cli.mjs", "prisma/seed.ts", "--replace"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          DATABASE_URL: "",
          NODE_ENV: "production",
        },
      },
    );

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      "--replace is disabled in production",
    );
  });
});
