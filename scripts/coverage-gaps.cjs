#!/usr/bin/env node
/**
 * Rank files in coverage/coverage-summary.json by uncovered branches,
 * then uncovered lines. Read-only. Run pnpm test:coverage first.
 *
 * Usage:
 *   node scripts/coverage-gaps.cjs [limit]
 */

const fs = require("fs");
const path = require("path");

const { error, log } = require("./logger.cjs");

const SUMMARY_FILE = path.join(__dirname, "../coverage/coverage-summary.json");

function uncovered(metric) {
  if (!metric || typeof metric.total !== "number") return 0;
  const covered = typeof metric.covered === "number" ? metric.covered : 0;
  return Math.max(0, metric.total - covered);
}

function pct(metric) {
  const value = Number(metric?.pct);
  return Number.isFinite(value) ? value : 0;
}

function pad(value, width) {
  return String(value).padStart(width);
}

function main() {
  if (!fs.existsSync(SUMMARY_FILE)) {
    error("Coverage summary not found. Run 'pnpm test:coverage' first.");
    process.exit(1);
  }

  const limitArg = Number(process.argv[2]);
  const limit = Number.isInteger(limitArg) && limitArg > 0 ? limitArg : 40;
  const summary = JSON.parse(fs.readFileSync(SUMMARY_FILE, "utf8"));
  const total = summary.total ?? {};

  log("Coverage totals");
  for (const metricName of ["lines", "statements", "functions", "branches"]) {
    const metric = total[metricName] ?? {};
    log(
      `  ${metricName}: ${pct(metric).toFixed(2)}% (${metric.covered ?? 0}/${metric.total ?? 0}, uncovered ${uncovered(metric)})`
    );
  }

  const rows = [];
  for (const [file, data] of Object.entries(summary)) {
    if (file === "total" || !data || typeof data !== "object") continue;
    const record = data;
    rows.push({
      file: file.startsWith(process.cwd())
        ? file.slice(process.cwd().length + 1)
        : file,
      linesUncovered: uncovered(record.lines),
      branchesUncovered: uncovered(record.branches),
      functionsUncovered: uncovered(record.functions),
      linesPct: pct(record.lines),
      branchesPct: pct(record.branches),
      functionsPct: pct(record.functions),
    });
  }

  rows.sort((a, b) => {
    if (b.branchesUncovered !== a.branchesUncovered) {
      return b.branchesUncovered - a.branchesUncovered;
    }
    if (b.linesUncovered !== a.linesUncovered) {
      return b.linesUncovered - a.linesUncovered;
    }
    return a.file.localeCompare(b.file);
  });

  const shown = rows.slice(0, limit);
  log("");
  log(`Top ${shown.length} files by uncovered branches (then uncovered lines)`);
  for (const row of shown) {
    log(
      `${pad(row.branchesUncovered, 5)} branches  ${pad(row.linesUncovered, 5)} lines  ${pad(row.functionsUncovered, 4)} fn  B ${pad(row.branchesPct.toFixed(1), 6)}%  L ${pad(row.linesPct.toFixed(1), 6)}%  F ${pad(row.functionsPct.toFixed(1), 6)}%  ${row.file}`
    );
  }

  const under = rows.filter((row) => row.linesPct < 80 || row.branchesPct < 80);
  const branchGap = under.reduce((sum, row) => sum + row.branchesUncovered, 0);
  const lineGap = under.reduce((sum, row) => sum + row.linesUncovered, 0);
  log("");
  log(
    `Files under 80% lines or branches: ${under.length} (uncovered branches ${branchGap}, uncovered lines ${lineGap})`
  );
}

main();
