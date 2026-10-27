// Tests run against a fake model server, so they need no API key and cost nothing.
// The sandbox tests need Docker and are skipped without it.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { SYSTEM, agent, clip, sandbox } from '../tina.js';

// ---------- a fake model that replays scripted replies ----------
let replies = [];
const requests = [];
const server = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  requests.push({ ...JSON.parse(body), headers: req.headers });
  const next = replies.shift() ?? say('(no more scripted replies)');
  res.writeHead(next.status ?? 200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(next.body ?? next));
});

before(() => new Promise((ready) => server.listen(0, '127.0.0.1', () => {
  process.env.TINA_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  ready();
})));
after(() => server.close());
beforeEach(() => {
  replies = [];
  requests.length = 0;
});

const say = (content) => ({ choices: [{ message: { role: 'assistant', content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
const toolCall = (args, id = 'call_1') => ({
  choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name: 'bash', arguments: args } }] } }],
});
const bash = (command, id) => toolCall(JSON.stringify({ command }), id);
const fresh = (task = 'do the thing') => [{ role: 'system', content: SYSTEM }, { role: 'user', content: task }];
const model = { id: 'fake/model' };
const neverRun = () => assert.fail('no command should run');

// ---------- the loop ----------
describe('agent loop', () => {
  test('stops when the model answers without a tool call', async () => {
    replies = [say('all done')];
    const answer = await agent(fresh(), { model, run: neverRun });
    assert.equal(answer, 'all done');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].tools[0].function.name, 'bash');
    assert.equal(requests[0].model, 'fake/model');
    assert.deepEqual(requests[0].cache_control, { type: 'ephemeral' });
    assert.match(requests[0].session_id, /^tina-/);
  });

  test('identifies itself to OpenRouter', async () => {
    replies = [say('hi')];
    await agent(fresh(), { model, run: neverRun });
    assert.equal(requests[0].headers['x-title'], 'TINA');
    assert.equal(requests[0].headers['http-referer'], 'https://github.com/nchandupatla/tina-agent');
  });

  test('runs the requested command and feeds the output back', async () => {
    replies = [bash('echo hi'), say('done')];
    const ran = [];
    const messages = fresh();
    await agent(messages, { model, run: async (cmd) => { ran.push(cmd); return 'hi\n[exit code: 0]'; } });
    assert.deepEqual(ran, ['echo hi']);
    assert.deepEqual(requests[1].messages.at(-1), { role: 'tool', tool_call_id: 'call_1', content: 'hi\n[exit code: 0]' });
    assert.deepEqual(messages.map((m) => m.role), ['system', 'user', 'assistant', 'tool', 'assistant']);
  });

  test('sends failures back so the model can fix them', async () => {
    replies = [bash('node app.js'), bash('node app.js', 'call_2'), say('fixed')];
    let attempt = 0;
    const run = async () => (attempt++ === 0 ? "SyntaxError: Unexpected token '}'\n[exit code: 1]" : 'ok\n[exit code: 0]');
    assert.equal(await agent(fresh(), { model, run }), 'fixed');
    assert.match(requests[1].messages.at(-1).content, /SyntaxError[\s\S]*exit code: 1/);
  });

  test('tells the model when tool arguments are cut off, instead of crashing', async () => {
    replies = [toolCall('{"command": "cat > big.html <<EOF'), say('ok, smaller pieces')];
    await agent(fresh(), { model, run: neverRun });
    assert.match(requests[1].messages.at(-1).content, /^ERROR: tool arguments were not valid JSON/);
  });

  test('stops at the step limit', async () => {
    replies = [bash('ls'), bash('ls'), bash('ls')];
    const events = [];
    const answer = await agent(fresh(), { model, run: async () => '[exit code: 0]', maxSteps: 3, on: (e, v) => events.push([e, v]) });
    assert.equal(answer, undefined);
    assert.deepEqual(events.at(-1), ['limit', 3]);
    assert.equal(requests.length, 3);
  });

  test('retries when rate limited', async () => {
    replies = [{ status: 429, body: { error: { message: 'slow down' } } }, say('ok')];
    assert.equal(await agent(fresh(), { model, run: neverRun }), 'ok');
    assert.equal(requests.length, 2);
  });

  test('surfaces API errors with their message', async () => {
    replies = [{ status: 400, body: { error: { message: 'model not found' } } }];
    await assert.rejects(agent(fresh(), { model, run: neverRun }), /model not found/);
  });

  test('writes every new message to the transcript', async () => {
    replies = [bash('ls'), say('done')];
    const log = join(mkdtempSync(join(tmpdir(), 'tina-')), 'run.jsonl');
    await agent(fresh(), { model, run: async () => '[exit code: 0]', log });
    const lines = readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(lines.map((m) => m.role), ['assistant', 'tool', 'assistant']);
    assert.ok(lines.every((m) => !Number.isNaN(Date.parse(m.at))), 'every line has a timestamp');
  });

  test('emits events in order for the UI', async () => {
    replies = [bash('ls'), say('done')];
    const events = [];
    await agent(fresh(), { model, run: async () => 'a.txt\n[exit code: 0]', on: (e) => events.push(e) });
    assert.deepEqual(events, ['think', 'reply', 'cmd', 'out', 'think', 'reply', 'done']);
  });
});

describe('clip', () => {
  test('leaves short output alone', () => assert.equal(clip('hello'), 'hello'));
  test('keeps the head and tail of long output', () => {
    const long = 'a'.repeat(6000) + 'b'.repeat(6000);
    const clipped = clip(long);
    assert.ok(clipped.startsWith('aaaa') && clipped.endsWith('bbbb'));
    assert.match(clipped, /…\[cut 2000 chars\]…/);
  });
});

// ---------- the sandbox (real Docker) ----------
const docker = (() => {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' });
    try { execFileSync('docker', ['image', 'inspect', 'tina-sandbox'], { stdio: 'ignore' }); }
    catch { execFileSync('docker', ['build', '-q', '-t', 'tina-sandbox', new URL('../sandbox', import.meta.url).pathname], { stdio: 'ignore' }); }
    return true;
  } catch {
    return false;
  }
})();

describe('sandbox', { skip: !docker && 'Docker not available' }, () => {
  let run, dir;
  before(() => {
    process.env.TINA_CMD_TIMEOUT = '3';
    process.env.TINA_API_KEY = 'sk-test-should-never-leak';
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'tina-sandbox-')));
    run = sandbox(dir);
  });

  test('runs commands and writes into the mounted folder', async () => {
    assert.equal(await run('echo hi > out.txt && cat out.txt'), 'hi\n[exit code: 0]');
    assert.ok(existsSync(join(dir, 'out.txt')));
  });

  test('reports exit codes', async () => {
    assert.match(await run('echo oops >&2; exit 3'), /oops\n\[exit code: 3\]$/);
  });

  test('kills commands that run too long', async () => {
    assert.match(await run('sleep 10'), /\[timed out after 3s\]$/);
  });

  test('has no network', async () => {
    assert.doesNotMatch(await run('curl -sS --max-time 3 https://example.com'), /\[exit code: 0\]$/);
  });

  test('cannot see the API key', async () => {
    assert.doesNotMatch(await run('env'), /sk-test-should-never-leak/);
  });

  test('cannot see the host home folder', async () => {
    assert.match(await run(`test -e ${homedir()} && echo visible || echo hidden`), /^hidden/);
  });

  test('refuses to mount the home folder', () => {
    assert.throws(() => sandbox(homedir()), /home folder/);
  });
});
