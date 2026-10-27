import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEval, satisfies } from "@grok/agent-sdk/evals";

// Fixtures come from scripts/make-fixtures.mjs: the TINA test-case patches applied to a clone.
const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
const REPO = "nchandupatla/tina-agent";

type Finding = { rule: number; severity: string; file: string; line: number; title: string };

// What each case should get. `file` is where a correct finding points.
const CASES = [
  { id: "case1-obvious-session-file", flag: true, file: "ui.js", about: "writes the API key into the mounted project folder" },
  { id: "case2-subtle-mount", flag: true, file: "tina.js", about: "mounts TINA's own folder, which holds .env" },
  { id: "case3-safe-secret-warning", flag: false, about: "only widens a warning about secret files" },
  { id: "case4-safe-twin-mount", flag: false, about: "mounts only prompts/, read-only" },
  { id: "case5-refactor-guards", flag: true, file: "tina.js", about: "keeps exact-match folder guards, so parent folders still mount .env" },
] as const;

function filesUnder(root: string, prefix: string, dir = root): Record<string, string> {
  const files: Record<string, string> = {};
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      Object.assign(files, filesUnder(root, prefix, path));
    } else {
      files[prefix + relative(root, path)] = readFileSync(path, "utf8");
    }
  }
  return files;
}

function workspace(id: string) {
  const dir = join(FIXTURES, id);
  const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as { title: string; head: string };
  return {
    meta,
    files: {
      ...filesUnder(join(dir, "repo"), "repo/"),
      "rules/LESSONS.md": readFileSync(join(FIXTURES, "LESSONS.md"), "utf8"),
      "pr/diff.patch": readFileSync(join(dir, "diff.patch"), "utf8"),
      "pr/head.sha": meta.head,
    },
  };
}

function trigger(title: string, head: string) {
  return [
    `GitHub pull request trigger: ${REPO}#1`,
    "Action: opened",
    `PR: https://github.com/${REPO}/pull/1`,
    `Title: ${title}`,
    `Head: test-branch (${head})`,
    "Base: main",
    "",
    "Read rules/LESSONS.md, then pr/diff.patch.",
  ].join("\n");
}

export default defineEval({
  tags: ["tina"],
  iterations: 2,
  cases: CASES.map((c) => ({
    id: c.id,
    description: `${c.flag ? "Flag" : "Don't flag"}: ${c.about}.`,
    async test(t) {
      const { meta, files } = workspace(c.id);
      await t.send(trigger(meta.title, meta.head), { workspaceFiles: files });
      t.succeeded();
      const call = t.requireToolCall("post_findings", { count: 1 });
      const findings = ((call.input as { findings?: Finding[] })?.findings ?? []);
      if (c.flag) {
        t.check(findings, satisfies((f) => (f as Finding[]).some((x) => x.file.endsWith(c.file)), `a finding points at ${c.file}`));
      } else {
        t.check(findings, satisfies((f) => (f as Finding[]).length === 0, "no findings"));
      }
      t.score("caught", c.flag ? Number(findings.length > 0) : Number(findings.length === 0));
    },
  })),
});
