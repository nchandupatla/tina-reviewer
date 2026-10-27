#!/usr/bin/env node
// TINA's skin: banner, spinner, tool-call tree, status line and /commands.
// The agent itself lives in tina.js. This file only decides how it looks.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { SYSTEM, agent, brain, sandbox } from './tina.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const presets = Object.entries(JSON.parse(readFileSync(here + 'models.json', 'utf8'))).filter(([name]) => !name.startsWith('_'));

// ---------- colors and layout ----------
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const PALETTE = { sky: '7DD3FC', violet: 'A78BFA', pink: 'F9A8D4', red: 'F87171', green: '86EFAC', text: 'E2E8F0', soft: '94A3B8', dim: '64748B' };
const rgb = (hex) => hex.match(/../g).map((h) => parseInt(h, 16));
const paint = (hex) => (s) => (tty ? `\x1b[38;2;${rgb(hex).join(';')}m${s}\x1b[0m` : String(s));
const c = Object.fromEntries(Object.entries(PALETTE).map(([name, hex]) => [name, paint(hex)]));
const gradient = (s) => {
  if (!tty) return s;
  const [from, to] = [rgb(PALETTE.sky), rgb(PALETTE.violet)];
  return [...s].map((ch, i) => {
    const t = i / Math.max(1, s.length - 1);
    return `\x1b[1;38;2;${from.map((v, j) => Math.round(v + (to[j] - v) * t)).join(';')}m${ch}`;
  }).join('') + '\x1b[0m';
};

const visible = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const width = () => Math.min(process.stdout.columns || 80, 78);
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - visible(s).length));
const spread = (left, right, n = width()) => left + ' '.repeat(Math.max(1, n - visible(left).length - visible(right).length)) + right;
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const tilde = (p) => p.replace(homedir(), '~');
// Light markdown for model text: **bold**, `code`, and "- " bullets.
const md = (line) => (tty ? line : line.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1'))
  .replace(/^(\s*)- /, '$1• ')
  .replace(/\*\*(.+?)\*\*/g, (_, t) => `\x1b[1m${t}\x1b[22m`)
  .replace(/`([^`]+)`/g, (_, t) => c.sky(t));

function wrap(text, n) {
  return text.split('\n').flatMap((para) => {
    const lines = [''];
    for (const word of para.split(' ')) {
      if (visible(lines.at(-1) + ' ' + word).trim().length > n && lines.at(-1)) lines.push('');
      lines[lines.length - 1] = (lines.at(-1) + ' ' + word).trimStart();
    }
    return lines;
  });
}

function box(lines, title = '', color = c.dim) {
  const w = width();
  const top = title
    ? color('╭─ ') + title + ' ' + color('─'.repeat(Math.max(0, w - 5 - visible(title).length)) + '╮')
    : color('╭' + '─'.repeat(w - 2) + '╮');
  const body = lines.map((line) => color('│') + ' ' + pad(line, w - 4) + ' ' + color('│'));
  return [top, ...body, color('╰' + '─'.repeat(w - 2) + '╯')].join('\n');
}

// ---------- the mascot: Cursor Wink ----------
// Pixel art drawn with half blocks (▀▄): each text row shows two pixel rows in true color.
// c = cloud (sky → violet gradient), e = eye and smile, k = cheek, . = empty.
const MASCOT = [
  '........cccccc........',
  '......cccccccccc......',
  '..cccccccccccccccc....',
  '.cccccccccccccccccccc.',
  'cccccccccccccccccccccc',
  'cccccccccccccceecccccc',
  'cccccccceecccceecccccc',
  'cccccccceecccceecccccc',
  'ccccckkcccccccccckkccc',
  'ccccckkcceccccecckkccc',
  'cccccccccceeeecccccccc',
  '.cccccccccccccccccccc.',
  '..cccccccccccccccccc..',
  '....cccccccccccccc....',
];

function pixelArt(rows) {
  const [from, to] = [rgb(PALETTE.sky), rgb(PALETTE.violet)];
  const color = (ch, x) => {
    if (ch === 'e') return [11, 16, 32];
    if (ch === 'k') return rgb(PALETTE.pink);
    if (ch === 'c') return from.map((v, j) => Math.round(v + ((to[j] - v) * x) / (rows[0].length - 1)));
    return null;
  };
  const lines = [];
  for (let y = 0; y < rows.length; y += 2) {
    let line = '';
    for (let x = 0; x < rows[y].length; x++) {
      const top = color(rows[y][x], x);
      const bottom = color(rows[y + 1]?.[x] ?? '.', x);
      if (top && bottom) line += `\x1b[38;2;${top.join(';')};48;2;${bottom.join(';')}m▀`;
      else if (top) line += `\x1b[38;2;${top.join(';')}m▀`;
      else if (bottom) line += `\x1b[38;2;${bottom.join(';')}m▄`;
      else line += ' ';
      line += '\x1b[0m';
    }
    lines.push(line);
  }
  return lines;
}

const mascot = tty
  ? pixelArt(MASCOT)
  : ['   .-~~~~-.', ' .(  ●   ▮  ).', '(°____‿____°)'];

// ---------- session state ----------
const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    model: { type: 'string', short: 'm' },
    dir: { type: 'string', short: 'd' },
    summary: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (opts.help) {
  console.log(`tina [task]            run one task, or start a session with no task
  -m, --model <name>    brain preset (${presets.map(([n]) => n).join(', ')}) or any OpenRouter model ID
  -d, --dir <path>      project folder to mount (default: current folder)
  --summary <file>      write run stats as JSON (used by bench/)`);
  process.exit(0);
}

let model = brain(opts.model);
const dir = resolve(opts.dir ?? process.cwd());
const net = process.env.TINA_NET === '1';
const maxSteps = +(process.env.TINA_MAX_STEPS ?? 30);
const host = new URL(process.env.TINA_BASE_URL ?? 'https://openrouter.ai/api/v1').hostname;
const total = { input: 0, output: 0, cached: 0, cost: 0, priced: true };
let task = null; // per-task counters, reset on each prompt

mkdirSync(here + 'runs', { recursive: true });
const log = `${here}runs/${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;

const tokens = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const money = () => (total.priced ? `$${total.cost.toFixed(total.cost < 0.1 ? 4 : 2)}` : '$—');
const cacheRate = () => (total.input ? `${Math.round((100 * total.cached) / total.input)}% cached` : null);
const status = () => [`step ${task.step}/${maxSteps}`, `${tokens(total.input + total.output)} tok`, total.cached ? cacheRate() : null, money()].filter(Boolean).join(' · ');

// ---------- spinner ----------
const VERBS = ['Forecasting', 'Condensing', 'Drifting', 'Brewing a storm', 'Raining code', 'Gathering clouds', 'Clearing up'];
let timer = null;

function spin(verb) {
  if (!tty) return;
  const started = Date.now();
  let frame = 0;
  const draw = () => {
    const eye = frame++ % 2 ? ' ' : c.violet('▮');
    const secs = Math.floor((Date.now() - started) / 1000);
    process.stdout.write('\r\x1b[K' + spread(`${c.sky('☁')}${eye} ${c.text(verb + '…')} ${c.dim(secs + 's')}`, c.dim(status())));
  };
  draw();
  timer = setInterval(draw, 550);
}

function stopSpin() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  process.stdout.write('\r\x1b[K');
}

// ---------- rendering agent events ----------
// Turns `cat > file <<'EOF' … EOF` into "Write file +N lines", and keeps whatever else the command runs.
function describe(cmd) {
  const heredoc = /cat\s*(>>?)\s*(\S+)\s*<<-?\s*['"]?(\w+)['"]?\n([\s\S]*?)\n\3[ \t]*(?:\n|$)/g;
  const writes = [...cmd.matchAll(heredoc)];
  const rest = cmd.replace(heredoc, '\n').split('\n')
    .map((line) => line.replace(/^\s*(cd \/workspace|mkdir -p \S+)\s*(&&|;)?\s*/, '').replace(/^\s*(&&|;)\s*/, '').trim())
    .filter((line) => line && line !== '&&' && line !== ';');
  if (writes.length) {
    const files = writes.map((w) => w[2].replace(/^\/workspace\//, ''));
    const added = writes.reduce((sum, w) => sum + w[4].split('\n').length, 0);
    const verb = writes.every((w) => w[1] === '>>') ? 'Append' : 'Write';
    const then = rest.length ? ` → $ ${rest[0]}` : '';
    return [cut(`${verb} ${files.join(', ')}${then}`, width() - 22), c.green(`+${added} line${added === 1 ? '' : 's'}`)];
  }
  const lines = cmd.split('\n');
  return [`$ ${cut(lines[0], width() - 24)}`, lines.length > 1 ? c.dim(`+${lines.length - 1} more`) : ''];
}

function showOutput(out) {
  const tail = out.match(/\n?\[(?:exit code: (\d+)|(timed out) after \d+s)\]$/);
  const code = tail?.[2] ? 124 : +(tail?.[1] ?? 0);
  const body = (tail ? out.slice(0, tail.index) : out).replace(/\t/g, '  ').trimEnd();
  const ok = code === 0;
  const mark = ok ? c.green('✓') : c.red(tail?.[2] ? '✗ timed out' : `✗ exit ${code}`);
  task.lastFailed = !ok;
  if (!ok) task.errors++;

  const lines = body ? body.split('\n') : [];
  if (!lines.length) return console.log(spread(c.dim('    └ ') + c.dim(ok ? 'done' : 'no output'), mark));
  lines.slice(0, 6).forEach((line, i) => {
    const text = cut(line, width() - 18);
    const shown = c.dim(i ? '      ' : '    └ ') + (ok ? c.soft(text) : c.red(text));
    console.log(i === 0 ? spread(shown, mark) : shown);
  });
  if (lines.length > 6) console.log(c.dim(`      … ${lines.length - 6} more lines`));
}

function finish(text) {
  const secs = Math.round((Date.now() - task.started) / 1000);
  const stats = [
    `${Math.floor(secs / 60)}m${String(secs % 60).padStart(2, '0')}s`,
    `${task.step} steps`,
    task.errors ? `${task.errors} error${task.errors > 1 ? 's' : ''} recovered` : null,
    `${tokens(total.input + total.output)} tok`,
    total.cached ? cacheRate() : null,
    money(),
  ].filter(Boolean).join(' · ');
  console.log('\n' + box([...wrap(text.trim().split('\n').map(md).join('\n'), width() - 4), '', c.text(stats), c.dim(cut(`brain ${model.id} · transcript ${tilde(log)}`, width() - 4))], c.pink('☀ done'), c.pink));
}

function on(event, value) {
  if (event === 'think') {
    stopSpin();
    task.step = value.step;
    spin(task.lastFailed ? 'Fixing' : VERBS[Math.floor(Math.random() * VERBS.length)]);
  }
  if (event === 'reply') {
    stopSpin();
    const { reply, usage } = value;
    total.input += usage.prompt_tokens ?? 0;
    total.output += usage.completion_tokens ?? 0;
    total.cached += usage.prompt_tokens_details?.cached_tokens ?? 0;
    if (usage.cost != null) total.cost += usage.cost;
    else if (model.in != null) total.cost += ((usage.prompt_tokens ?? 0) * model.in + (usage.completion_tokens ?? 0) * model.out) / 1e6;
    else total.priced = false;
    if (reply.tool_calls?.length && reply.content?.trim()) {
      wrap(reply.content.trim().split('\n').map(md).join('\n'), width() - 4).forEach((line, i) => console.log((i ? '  ' : c.sky('☁ ')) + line));
    }
  }
  if (event === 'cmd') {
    const [label, extra] = describe(value);
    console.log(spread(`  ${c.violet('✋')} ${c.text(label)}`, extra));
  }
  if (event === 'out') showOutput(value);
  if (event === 'done') {
    task.finished = true;
    finish(value || '(no summary)');
  }
  if (event === 'limit') console.log('\n' + box([`Stopped after ${value} steps without finishing. Raise TINA_MAX_STEPS or try a stronger brain.`], c.red('step limit'), c.red));
}

// ---------- startup ----------
function bail(message) {
  stopSpin();
  console.error(c.red(`✗ ${message}`));
  process.exit(1);
}

if (!process.env.TINA_API_KEY) bail('No API key. Run: cp .env.example .env  and put your OpenRouter key in TINA_API_KEY.');

try {
  execFileSync('docker', ['image', 'inspect', 'tina-sandbox'], { stdio: 'ignore' });
} catch {
  try {
    console.log(c.dim('☁ building the sandbox image (first run only)…'));
    execFileSync('docker', ['build', '-q', '-t', 'tina-sandbox', here + 'sandbox'], { stdio: 'inherit' });
  } catch {
    bail("Docker isn't running. Start Docker Desktop and try again.");
  }
}

if (dir === resolve(here)) bail("Don't run TINA inside its own folder: your .env (API key) would be visible to the model. cd into a project folder.");
if (existsSync(resolve(dir, '.env'))) console.log(c.red('! this folder has a .env file. TINA can read it, so any secrets in it are visible to the model.'));

let run;
try {
  run = sandbox(dir, net);
} catch (err) {
  bail(err.message.split('\n')[0]);
}

let messages = [{ role: 'system', content: SYSTEM }];
appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), ...messages[0] }) + '\n');

function bye() {
  stopSpin();
  console.log(c.sky('\n☁ bye'));
  process.exit(130);
}
process.on('SIGINT', bye);
// Closing the terminal or killing TINA must also remove the sandbox container.
for (const signal of ['SIGTERM', 'SIGHUP']) process.on(signal, () => process.exit(129));

async function runTask(prompt) {
  task = { step: 0, errors: 0, lastFailed: false, started: Date.now(), finished: false };
  const message = { role: 'user', content: prompt };
  messages.push(message);
  appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), ...message }) + '\n');
  try {
    await agent(messages, { model, run, on, maxSteps, log });
  } catch (err) {
    stopSpin();
    console.log(c.red(`✗ ${err.message}`));
  }
  if (opts.summary) {
    writeFileSync(opts.summary, JSON.stringify({
      model: model.id, finished: task.finished, steps: task.step, errors: task.errors,
      seconds: Math.round((Date.now() - task.started) / 1000),
      tokensIn: total.input, tokensOut: total.output, tokensCached: total.cached, cost: total.priced ? total.cost : null, transcript: tilde(log),
    }, null, 2));
  }
}

// One-shot: `tina "build a todo app"`
if (positionals.length) {
  console.log(spread(`${c.sky('☁')} ${gradient('TINA')} ${c.dim('· ' + model.id)}`, c.dim(cut(tilde(dir), width() - 50))) + '\n');
  await runTask(positionals.join(' '));
  process.exit(task.finished ? 0 : 1);
}

// Interactive session
function banner() {
  const inner = width() - 4;
  const row = (key, value) => '   ' + c.dim(key.padEnd(9)) + value;
  const beside = ['', '', gradient('T I N A'), c.soft('Your Tiny AI Coding Agent'), c.dim('Tiny by name. Sandboxed by default.'), '', ''];
  const art = mascot.map((line, i) => (i === 0 ? spread(' ' + pad(line, 24) + (beside[i] ?? ''), c.dim('v0.1.1'), inner) : ' ' + pad(line, 24) + (beside[i] ?? '')));
  console.log(box([
    ...art,
    '',
    row('brain', c.text(model.id) + c.dim(` · via ${host}`)),
    row('hands', c.text(`sandbox · ${net ? c.red('network ON') : 'no network'} · ${tilde(dir)}`)),
    row('limits', c.text(`${maxSteps} steps · ${process.env.TINA_CMD_TIMEOUT ?? 60}s per command`)),
  ], '', c.violet));
  console.log(c.dim('  /model swap brain · /cost spend · /clear · /sandbox · /help · ctrl-c quit'));
}

const commands = {
  help: () => console.log(c.soft([
    '/model [name]   list brains, or switch: /model free',
    '/cost           tokens and spend this session',
    '/clear          forget the conversation (the harness is the memory)',
    '/sandbox        show what TINA can and cannot touch',
    '/exit           quit',
  ].join('\n'))),
  model: (name) => {
    if (!name) {
      for (const [preset, info] of presets) {
        const current = info.id === model.id;
        const price = info.in ? `$${info.in.toFixed(2)} / $${info.out.toFixed(2)} per 1M` : 'free';
        console.log(`${current ? c.sky('●') : ' '} ${c.text(preset.padEnd(8))} ${c.soft(info.id.padEnd(42))} ${c.dim(price)}`);
      }
      return console.log(c.dim('  switch with /model <name>, or any OpenRouter model ID'));
    }
    model = brain(name);
    console.log(`${c.sky('☁')} brain → ${gradient(model.id)}${presets.some(([p]) => p === name) ? '' : c.dim('  (raw model ID, cost not tracked)')}`);
  },
  cost: () => console.log(`${c.sky('☁')} ${tokens(total.input)} in${total.cached ? ` (${cacheRate()})` : ''} · ${tokens(total.output)} out · ${c.text(money())}`),
  clear: () => {
    messages = [messages[0]];
    console.log(`${c.sky('☁')} memory wiped. New conversation.`);
  },
  sandbox: async () => {
    const secrets = (await run("env | grep -ciE 'key|token|secret' || true")).split('\n')[0];
    const lines = [
      ['mounted', `${tilde(dir)} → /workspace (nothing else)`],
      ['network', net ? c.red('ON (TINA_NET=1)') : 'off'],
      ['root fs', 'read-only, /tmp is scratch'],
      ['limits', '1 GB memory · 256 processes · all capabilities dropped'],
      ['secrets', `${secrets} keys or tokens visible inside (the API key stays outside)`],
    ];
    console.log(box(lines.map(([k, v]) => c.dim(k.padEnd(9)) + c.text(v)), c.sky('sandbox'), c.sky));
  },
  exit: bye,
  quit: bye,
};

banner();
const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.on('SIGINT', bye);

while (true) {
  console.log();
  const input = (await rl.question(c.sky('❯ ')).catch(() => bye())).trim();
  if (!input) continue;
  if (input.startsWith('/')) {
    const [name, ...rest] = input.slice(1).split(/\s+/);
    if (commands[name]) await commands[name](rest.join(' '));
    else console.log(c.dim(`unknown command /${name}. Try /help`));
    continue;
  }
  console.log();
  await runTask(input);
}
