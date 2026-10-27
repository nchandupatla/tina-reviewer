#!/usr/bin/env node
// TINA — Your Tiny AI Coding Agent.
// The model is the brain. This file gives it hands: ASK → ACT → OBSERVE → REPEAT.
import { execFile, execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
try { process.loadEnvFile(here + '.env'); } catch {}
const env = (key, fallback) => process.env[key] ?? fallback;
const presets = JSON.parse(readFileSync(here + 'models.json', 'utf8'));
export const brain = (name = env('TINA_MODEL', 'haiku')) => ({ name, ...(presets[name] ?? { id: name }) });

export const SYSTEM = readFileSync(here + 'prompts/system.md', 'utf8'); // the full system prompt

const TOOLS = [{ type: 'function', function: {
  name: 'bash', description: 'Run a bash command in /workspace and return its output and exit code.',
  parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } } }];

// HANDS: a throwaway Docker container. Only `dir` is mounted, and the API key never goes in.
export function sandbox(dir = process.cwd(), net = env('TINA_NET') === '1') {
  if ([process.env.HOME, '/', here.slice(0, -1)].includes(dir.replace(/(.)\/+$/, '$1'))) throw new Error(`TINA will not mount ${dir}: it is your home folder, the root folder or TINA's own folder, where your .env lives. cd into a project folder.`);
  const box = execFileSync('docker', ['run', '-d', '--rm', ...(net ? [] : ['--network', 'none']), '--read-only', '--tmpfs', '/tmp',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '1g', '--pids-limit', '256',
    '--user', `${process.getuid()}:${process.getgid()}`, '-v', `${dir}:/workspace`, 'tina-sandbox']).toString().trim();
  process.on('exit', () => execFileSync('docker', ['rm', '-f', box], { stdio: 'ignore' }));
  const secs = env('TINA_CMD_TIMEOUT', '60');
  return (command) => new Promise((done) => execFile('docker', ['exec', box, 'timeout', '-k', '5', secs, 'bash', '-c', command],
    { maxBuffer: 1e8 }, (err, out, errOut) => done(clip(`${out}${errOut}`.trimEnd()) +
      (err?.code === 124 ? `\n[timed out after ${secs}s]` : `\n[exit code: ${err ? err.code ?? 1 : 0}]`))));
}
export const clip = (s, max = 10000) => s.length <= max ? s : `${s.slice(0, max / 2)}\n…[cut ${s.length - max} chars]…\n${s.slice(-max / 2)}`;

// Prompt caching: re-sent history is billed at ~10% instead of 100%. The session ID keeps every
// request on the same provider so the cache stays warm. Turn off with TINA_CACHE=0.
const CACHE = { cache_control: { type: 'ephemeral' }, session_id: `tina-${crypto.randomUUID()}` };

// BRAIN: one HTTP call to any OpenAI-compatible API. Rate limits, server errors and timeouts get retried.
async function ask(model, messages) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${env('TINA_BASE_URL', 'https://openrouter.ai/api/v1')}/chat/completions`, {
      method: 'POST', signal: AbortSignal.timeout(300_000), headers: { Authorization: `Bearer ${env('TINA_API_KEY')}`,
        'Content-Type': 'application/json', 'HTTP-Referer': 'https://github.com/nchandupatla/tina-agent', 'X-Title': 'TINA' },
      body: JSON.stringify({ model, messages, tools: TOOLS, max_tokens: 16000, ...(env('TINA_CACHE') !== '0' && CACHE) }) })
      .catch((err) => ({ status: 599, json: () => ({ error: { message: err.message } }) })); // timeouts and network errors retry too
    if ((res.status === 429 || res.status >= 500) && attempt < 4) { await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt)); continue; }
    const data = await res.json();
    if (!data.choices) throw new Error(data.error?.message ?? `HTTP ${res.status}`);
    return data;
  }
}

// THE LOOP: ask → act → observe → repeat, until the model stops asking for tools.
export async function agent(messages, { model = brain(), run, on = () => {}, maxSteps = +env('TINA_MAX_STEPS', 30), log } = {}) {
  const remember = (message) => { messages.push(message); if (log) appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), ...message }) + '\n'); };
  for (let step = 1; step <= maxSteps; step++) {
    on('think', { step, maxSteps });
    const { choices, usage } = await ask(model.id, messages);
    const reply = choices[0].message;
    remember(reply);
    on('reply', { reply, usage: usage ?? {} });
    if (!reply.tool_calls?.length) return on('done', reply.content ?? ''), reply.content;
    for (const call of reply.tool_calls) {
      let command; try { command = JSON.parse(call.function.arguments).command; } catch {}
      on('cmd', command ?? '(unreadable tool call)');
      const output = command ? await run(command) : 'ERROR: tool arguments were not valid JSON, the reply was probably cut off. Write big files in smaller appends.\n[exit code: 1]';
      on('out', output);
      remember({ role: 'tool', tool_call_id: call.id, content: output });
    }
  }
  on('limit', maxSteps);
}

// Plain mode: `node tina.js "build a todo app"`. The pretty terminal UI lives in ui.js.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const print = { cmd: (c) => console.log(`\n$ ${c}`), out: console.log, done: (text) => console.log(`\n${text}`) };
  await agent([{ role: 'system', content: SYSTEM }, { role: 'user', content: process.argv.slice(2).join(' ') }],
    { run: sandbox(), on: (event, value) => print[event]?.(value) });
}
