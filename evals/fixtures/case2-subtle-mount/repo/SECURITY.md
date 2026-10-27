# Security

TINA runs commands that an AI model writes. Treat it like running a stranger's
shell script.

## How TINA limits the damage

- Every command runs inside a disposable Docker container: no network by default,
  read-only root filesystem, dropped capabilities, non-root user, memory, CPU and
  process limits.
- Only the current run's folder is mounted. Your home directory, SSH keys and git
  credentials are not visible.
- Your API key stays in the host Node process and is never passed into the container.
- Every command has a timeout, output is capped, and each run has a step limit.

## What it does not protect against

- A container is not a perfect security boundary. Container escapes exist.
- With `TINA_NET=1`, the model can reach the internet from the sandbox.
- Anything you put inside the run folder, the model can read and change. That
  includes `.env` files: TINA warns when it sees one, and refuses to run inside
  its own folder, where your API key lives.
- Prompts and outputs are sent to whichever model provider you configure.
  Free providers may log them.

Don't point TINA at folders or data you care about.

## Reporting a vulnerability

If you find a way for TINA to escape its sandbox, leak the API key or touch files
outside the run folder, please open a private report via GitHub's
"Report a vulnerability" (Security tab) rather than a public issue.
