# TINA engineering lessons

Rules every change to this repo must keep. Each rule says where it comes from, so a reviewer can check a pull request against what the project already promises its users.

TINA runs commands that an AI model writes. Most of these rules exist so that a mistake by the model, or by a contributor, can't reach the user's secrets or machine.

## Secrets

1. **The API key stays in the host Node process and is never passed into the container.**
   Source: README "Safety", SECURITY.md.

2. **TINA refuses to run in the user's home folder or in its own folder.** TINA's own folder holds `.env`, which contains the API key.
   Source: README "Quickstart", the `ui.js` startup checks, SECURITY.md.

3. **Only the current project folder is mounted, at `/workspace`.** The user's home directory, SSH keys and git credentials must not be visible inside the sandbox.
   Source: README "Safety", SECURITY.md.

4. **When a project folder contains a `.env`, TINA warns the user** that its contents are visible to the model.
   Source: SECURITY.md.

## Sandbox

5. **The network is off by default.** Only `TINA_NET=1` turns it on.
   Source: README "Safety", SECURITY.md.

6. **The container stays locked down.** Don't weaken any of these: read-only root filesystem, all Linux capabilities dropped, `no-new-privileges`, non-root user, memory and process limits.
   Source: README "Safety", SECURITY.md.

7. **Every command has a timeout, output is capped, and every run has a step limit.**
   Source: README "Safety", SECURITY.md.

8. **The sandbox container is removed when TINA exits,** including on Ctrl-C, a closed terminal or a kill signal.
   Source: the signal handling in `ui.js` (commit `808cfb6`).

## Code

9. **`tina.js` stays at 62 counted lines or fewer** (`npm run lines`). New ideas go in `ui.js` or a new file next to it.
   Source: CONTRIBUTING.md.

10. **No dependencies.** Node's standard library only.
    Source: CONTRIBUTING.md.

11. **`ui.js` is presentation only.** Delete it, and `node tina.js "task"` must still work, with the same safety.
    Source: README "How it works".

12. **Tests use the fake model server and fake keys.** They never need a real API key, and no real key is ever committed.
    Source: CONTRIBUTING.md, `test/tina.test.js`.

## Out of scope

- `bench/` is the benchmark harness from the video, not part of TINA. `bench/run-claude.sh` passes a key into Claude Code's container on purpose, because Claude Code calls its API from inside. Rules 1–4 apply to TINA (`tina.js`, `ui.js`, `prompts/`, `sandbox/`), not to `bench/`.
