import { defineAgent } from "@grok/agent-sdk";

export default defineAgent({
  // Read-only: no shell, no edits. PR diffs are untrusted input, so the sandbox stays on.
  tools: ["read", "grep", "glob", "ls"],
  local: {
    sandbox: true,
  },
});
