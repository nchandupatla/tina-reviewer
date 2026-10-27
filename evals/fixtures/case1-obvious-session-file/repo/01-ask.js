#!/usr/bin/env node
// Stage 1 — the MODEL. One API call. It can write code, but it can't run it or save it.
// Usage: node 01-ask.js "Build me a landing page"
import { fileURLToPath } from 'node:url';

try { process.loadEnvFile(fileURLToPath(new URL('.env', import.meta.url))); } catch {}

const res = await fetch(`${process.env.TINA_BASE_URL ?? 'https://openrouter.ai/api/v1'}/chat/completions`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.TINA_API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'anthropic/claude-haiku-5.5',
    messages: [{ role: 'user', content: process.argv.slice(2).join(' ') || 'Build me a landing page' }],
  }),
});

const data = await res.json();
console.log(data.choices?.[0].message.content ?? data.error?.message);
