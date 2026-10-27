#!/usr/bin/env node
// Counts lines the same way bash-harness counted its 62: skip blank lines and comment-only lines.
// Usage: node scripts/count-lines.js [files...]  [--max N]  (--max fails if the first file is over N)
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const maxAt = args.indexOf('--max');
const max = maxAt >= 0 ? Number(args.splice(maxAt, 2)[1]) : Infinity;
const files = args.length ? args : ['tina.js', 'ui.js', '01-ask.js', '02-chat.js'];

const count = (file) => readFileSync(file, 'utf8').split('\n')
  .filter((line) => line.trim() && !/^\s*(\/\/|#!)/.test(line)).length;

const rows = files.map((file) => [file, count(file)]);
for (const [file, n] of rows) console.log(`${String(n).padStart(5)}  ${file}`);
console.log(`${String(62).padStart(5)}  03-Harness.sh from bash-harness, for reference`);

if (rows[0][1] > max) {
  console.error(`\n${rows[0][0]} has ${rows[0][1]} lines, over the limit of ${max}.`);
  process.exit(1);
}
