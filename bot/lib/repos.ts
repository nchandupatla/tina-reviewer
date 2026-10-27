export const REPOS: readonly string[] = ["nchandupatla/tina-agent"];

export function watches(fullName: string): boolean {
  return REPOS.some((repo) => repo.toLowerCase() === fullName.toLowerCase());
}
