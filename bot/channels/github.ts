import { defaultGitHubPullRequestDispatch, githubChannel } from "@grok/agent-sdk/channels/github";
import { readFileAt, snapshotRepo } from "../lib/repo-files.js";
import { REPOS, RULES_PATH, watches } from "../lib/repos.js";

const MAX_DIFF_CHARS = 150_000;

export default githubChannel({
  cursorAccount: { repos: REPOS },
  deliverReplies: false,
  onComment: () => null,
  onPullRequest: (ctx, pr) => {
    if (!watches(ctx.repository.fullName) || pr.draft) {
      return null;
    }
    const dispatch = defaultGitHubPullRequestDispatch(ctx, pr);
    if (dispatch === null) {
      return null;
    }
    return {
      auth: dispatch.auth,
      context: ["Read rules/LESSONS.md, then pr/diff.patch."],
      async workspaceFiles() {
        const octokit = await ctx.github.getOctokit();
        const repo = { owner: ctx.repository.owner, repo: ctx.repository.name };
        const pull = { ...repo, pull_number: pr.number };
        const [meta, diff] = await Promise.all([
          octokit.rest.pulls.get(pull),
          octokit.rest.pulls.get({ ...pull, mediaType: { format: "diff" } }),
        ]);
        const text = typeof diff.data === "string" ? diff.data : "";
        const [rules, snapshot] = await Promise.all([
          readFileAt(octokit, repo, RULES_PATH, meta.data.base.sha),
          snapshotRepo(octokit, repo, meta.data.head.sha),
        ]);
        return {
          ...snapshot,
          "rules/LESSONS.md": rules ?? `(No ${RULES_PATH} on the base branch. Report no findings.)\n`,
          "pr/diff.patch":
            text.length > MAX_DIFF_CHARS
              ? `${text.slice(0, MAX_DIFF_CHARS)}\n…[truncated]\n`
              : text,
          "pr/head.sha": meta.data.head.sha,
        };
      },
    };
  },
});
