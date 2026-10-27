import type { Octokit } from "@octokit/rest";

// Text files worth showing the model. Everything else (images, lockfiles, run logs) is skipped.
const TEXT = /(\.(js|mjs|cjs|ts|json|md|sh|yml|yaml|txt|toml)|(^|\/)(Dockerfile|LICENSE|\.gitignore|\.env\.example))$/;
const SKIP = /(^|\/)(node_modules|runs|bench\/runs|bench\/dry-runs|assets)\/|package-lock\.json$/;
const MAX_FILE_BYTES = 100_000;
const MAX_TOTAL_BYTES = 1_000_000;

type Repo = { owner: string; repo: string };

/** One file at a ref, or null when it doesn't exist there. */
export async function readFileAt(octokit: Octokit, { owner, repo }: Repo, path: string, ref: string) {
  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref });
    if (Array.isArray(data) || data.type !== "file" || !("content" in data)) {
      return null;
    }
    return Buffer.from(data.content, "base64").toString("utf8");
  } catch (error) {
    if ((error as { status?: number }).status === 404) {
      return null;
    }
    throw error;
  }
}

/** The repository's text files at `sha`, keyed `repo/<path>`, so the model can grep around the diff. */
export async function snapshotRepo(octokit: Octokit, { owner, repo }: Repo, sha: string) {
  const { data: tree } = await octokit.rest.git.getTree({ owner, repo, tree_sha: sha, recursive: "true" });
  const files: Record<string, string> = {};
  let total = 0;
  for (const entry of tree.tree) {
    if (entry.type !== "blob" || !entry.path || !entry.sha || !TEXT.test(entry.path) || SKIP.test(entry.path)) {
      continue;
    }
    if ((entry.size ?? 0) > MAX_FILE_BYTES || total + (entry.size ?? 0) > MAX_TOTAL_BYTES) {
      continue;
    }
    const { data: blob } = await octokit.rest.git.getBlob({ owner, repo, file_sha: entry.sha });
    files[`repo/${entry.path}`] = Buffer.from(blob.content, "base64").toString("utf8");
    total += entry.size ?? 0;
  }
  return files;
}
