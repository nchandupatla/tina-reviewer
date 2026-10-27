#!/usr/bin/env node
// Stage 2 — MEMORY. The model is stateless: it only remembers because we resend the whole conversation.
// The harness IS the memory. Usage: node 02-chat.js  (empty line to quit)
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

try { process.loadEnvFile(fileURLToPath(new URL('.env', import.meta.url))); } catch {}

async function callLLM(messages) {
  const res = await fetch(`${process.env.TINA_BASE_URL ?? 'https://openrouter.ai/api/v1'}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.TINA_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'anthropic/claude-haiku-5.5', messages }),
  });
  const data = await res.json();
  return data.choices?.[0].message.content ?? `ERROR: ${data.error?.message}`;
}

const messages = [];
const rl = createInterface({ input: process.stdin, output: process.stdout });

while (true) {
  const input = await rl.question('you> ').catch(() => ''); // Ctrl-D ends the chat too
  if (!input) break;
  messages.push({ role: 'user', content: input });
  const reply = await callLLM(messages);
  messages.push({ role: 'assistant', content: reply });
  console.log(`llm> ${reply}\n`);
}
rl.close();
