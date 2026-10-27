#!/usr/bin/env node
// Builds eval fixtures from the TINA test-case patches, so evals never need GitHub or a live PR.
// For each patch: apply it to a fresh clone of TINA (with LESSONS.md committed on the base branch),
// then save what the reviewer would see: the diff, and the repo's text files after the change.
//
// Usage: node scripts/make-fixtures.mjs <tina repo> <patches dir> <LESSONS.md>
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const [tina, patches, lessons] = process.argv.slice(2).map((p) => p && resolve(p));
if (!tina || !patches || !lessons) {
  console.error('Usage: node scripts/make-fixtures.mjs <tina repo> <patches dir> <LESSONS.md>');
  process.exit(2);
}

// Same file filter as bot/lib/repo-files.ts, so evals see what a live review sees.
const TEXT = /(\.(js|mjs|cjs|ts|json|md|sh|yml|yaml|txt|toml)|(^|\/)(Dockerfile|LICENSE|\.gitignore|\.env\.example))$/;
const SKIP = /(^|\/)(node_modules|runs|bench\/runs|bench\/dry-runs|assets)\/|package-lock\.json$/;
const MAX_FILE_BYTES = 100_000;

const out = resolve(dirname(new URL(import.meta.url).pathname), '../evals/fixtures');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
copyFileSync(lessons, join(out, 'LESSONS.md'));

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=fixtures', '-c', 'user.email=fixtures@example.com', ...args], { cwd, encoding: 'utf8' });
const work = mkdtempSync(join(tmpdir(), 'tina-fixtures-'));
const clone = join(work, 'tina');
git(work, 'clone', '-q', tina, clone);
// The base branch has LESSONS.md, the same as the real repo will before any test PR is opened.
copyFileSync(lessons, join(clone, 'LESSONS.md'));
git(clone, 'add', 'LESSONS.md');
git(clone, 'commit', '-qm', 'Add LESSONS.md');
const base = git(clone, 'rev-parse', 'HEAD').trim();

for (const patch of readdirSync(patches).filter((f) => f.endsWith('.patch')).sort()) {
  const id = basename(patch, '.patch');
  git(clone, 'checkout', '-q', '-B', id, base);
  git(clone, 'am', '-q', join(patches, patch));
  const dir = join(out, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'diff.patch'), git(clone, 'diff', base, 'HEAD'));
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ title: git(clone, 'log', '-1', '--format=%s').trim(), head: git(clone, 'rev-parse', 'HEAD').trim() }, null, 2) + '\n');
  for (const file of git(clone, 'ls-files').split('\n').filter(Boolean)) {
    if (!TEXT.test(file) || SKIP.test(file) || statSync(join(clone, file)).size > MAX_FILE_BYTES) continue;
    mkdirSync(dirname(join(dir, 'repo', file)), { recursive: true });
    writeFileSync(join(dir, 'repo', file), readFileSync(join(clone, file)));
  }
  console.log(`fixture ${id}`);
}
rmSync(work, { recursive: true, force: true });
