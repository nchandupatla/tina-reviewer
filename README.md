# tina-reviewer

A pull-request reviewer for [TINA](https://github.com/nchandupatla/tina-agent), built with Cursor's Agent SDK. It checks every pull request against the safety rules in TINA's [`LESSONS.md`](https://github.com/nchandupatla/tina-agent/blob/main/LESSONS.md) and leaves one comment. The comment names the rule each finding breaks, plus the file and line, or reports no findings.

It started from the SDK's `security-reviewer` template. The changes on top of it:

- **The rules come from the base branch.** `LESSONS.md` is read at the pull request's base commit, not its head. A pull request can't weaken the rules it is judged by (`bot/channels/github.ts`, `bot/lib/repos.ts`).
- **It reads the full files, not just the diff.** The workspace gets a snapshot of the repository's text files with the change applied (`repo/`), so the reviewer can follow code the diff only touches.
- **It's read-only.** The tools are `read`, `grep`, `glob` and `ls`. There's no shell and no edits, and the sandbox is on (`bot/agent.ts`). Diff text is treated as data, not instructions (`bot/instructions.md`).

## Evals

`evals/tina-rules.eval.ts` runs five fixed cases offline, with no GitHub involved:

| Case | Change | Expected |
|---|---|---|
| 1 | Writes the API key into the mounted project folder | flag |
| 2 | Mounts TINA's own folder, which holds `.env` | flag |
| 3 | Only widens a warning about secret files | no flag |
| 4 | Mounts only `prompts/`, read-only | no flag |
| 5 | A real refactor that keeps an exact-match folder guard, so parent folders still mount `.env` | flag |

It isn't perfect. In our first eval runs (two runs each), it **missed case 5**, a real bug from TINA's own history. It also flagged case 4: the rule "only the project folder is mounted" is stricter than intended. Treat it as a second reviewer that knows TINA's rules, not a replacement for a human or for Bugbot.

```bash
npm run eval
```

## Run it

You need Node 22.13 or newer, and a Cursor account with GitHub connected for the watched repository (`bot/lib/repos.ts`).

```bash
npm install
npx agent-sdk login
npm run dev                                   # local server
npx agent-sdk github replay <pull-request-url> --dir .
```

To point it at your own project, change `REPOS` and `RULES_PATH` in `bot/lib/repos.ts`, and write your own numbered rules file.

## Layout

| Path | What it does |
|---|---|
| `bot/agent.ts` | Model tools and the sandbox |
| `bot/instructions.md` | What counts as a finding, and the comment format |
| `bot/channels/github.ts` | On a pull request: fetches the rules (base), the diff, and the files (head) |
| `bot/lib/repo-files.ts` | Reads one file at a commit, and snapshots the repository |
| `bot/tools/post_findings.ts` | Posts the single review comment |
| `evals/` | The five cases and their fixtures (`npm run fixtures` rebuilds them) |

## License

The code in this repository is MIT licensed. The Agent SDK it depends on is Cursor's, and is used under Cursor's terms. It isn't open source and isn't included here.
