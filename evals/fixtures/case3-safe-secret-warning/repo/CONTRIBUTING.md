# Contributing

Thanks for taking a look. TINA has one rule: **`tina.js` stays tiny.**

- The agent loop lives in `tina.js` and must stay at 62 counted lines or fewer
  (`npm run lines`). If your idea needs more, it probably belongs in `ui.js` or
  a new file next to it.
- No dependencies. Node's standard library only.
- Run `npm test` before opening a PR. The tests use a fake model, so you don't
  need an API key. The sandbox tests need Docker.
- Found a way out of the sandbox? Please read [SECURITY.md](SECURITY.md) and
  report it privately.
