export const REPOS: readonly string[] = ["nchandupatla/tina-agent"];

// The rules file the reviewer checks every pull request against. Read from the base branch,
// so a pull request can't weaken the rules it is judged by.
export const RULES_PATH = "LESSONS.md";

export function watches(fullName: string): boolean {
  return REPOS.some((repo) => repo.toLowerCase() === fullName.toLowerCase());
}
