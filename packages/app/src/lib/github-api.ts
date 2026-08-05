import { Octokit } from "@octokit/core"

export type GitHubRepository = {
  defaultBranch: string
  description: string | null
  forks: number
  htmlUrl: string
  issues: number
  name: string
  owner: string
  stars: number
}

const github = new Octokit({
  request: {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "blame-desktop",
    },
  },
})

export function parseGitHubRepository(remote: string) {
  const value = remote.trim().replace(/\.git$/, "")
  const match = value.match(
    /^(?:https?:\/\/|ssh:\/\/git@|git@)(?:www\.)?github\.com[/:]([^/]+)\/([^/]+)$/i
  )
  if (!match) return undefined
  return { name: match[2], owner: match[1] }
}

export async function fetchGitHubRepository(remote: string) {
  const repository = parseGitHubRepository(remote)
  if (!repository) return undefined

  const response = await github.request("GET /repos/{owner}/{repo}", repository)
  const data = response.data
  return {
    defaultBranch: data.default_branch,
    description: data.description,
    forks: data.forks_count,
    htmlUrl: data.html_url,
    issues: data.open_issues_count,
    name: data.name,
    owner: data.owner.login,
    stars: data.stargazers_count,
  } satisfies GitHubRepository
}
