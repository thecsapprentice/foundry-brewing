#!/usr/bin/env node
// Runs every Microbrew test suite against the mocked Foundry/dnd5e harness.
//   node tests/run.mjs
// Exits non-zero if any check fails or a suite crashes. Requires tools/ldbpack (see README → Building),
// because the harness reads the built compendium packs.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const suites = [
  ["test-packs.mjs", {}],
  ["test-module.mjs", {}],
  ["test-reskin.mjs", {}],
  ["test-safety.mjs", {}],
  ["test-drop.mjs", {}],
  ["test-forage.mjs", {}],
  ["test-libwrapper.mjs", { WITH_LIBWRAPPER: "1" }],
  ["test-libwrapper.mjs", { WITH_LIBWRAPPER: "0" }],
];

let pass = 0, fail = 0, crashed = 0;
for (const [file, env] of suites) {
  const label = `${file}${env.WITH_LIBWRAPPER ? ` (libWrapper=${env.WITH_LIBWRAPPER})` : ""}`;
  const r = spawnSync(process.execPath, [path.join(dir, file)], { env: { ...process.env, ...env }, encoding: "utf8", timeout: 120000 });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const p = (out.match(/^PASS/gm) ?? []).length;
  const f = out.split("\n").filter((l) => l.startsWith("FAIL"));
  pass += p; fail += f.length;
  const broken = r.status !== 0 || p === 0;
  if (broken) crashed++;
  console.log(`${broken || f.length ? "✗" : "✓"} ${label}: ${p} passed, ${f.length} failed${broken ? " — SUITE CRASHED" : ""}`);
  for (const l of f) console.log(`    ${l}`);
  if (broken) console.log(out.split("\n").slice(-15).map((l) => `    ${l}`).join("\n"));
}
console.log(`\n${pass} passed, ${fail} failed${crashed ? `, ${crashed} suite(s) crashed` : ""}`);
process.exit(fail || crashed ? 1 : 0);
