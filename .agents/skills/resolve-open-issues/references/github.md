# GitHub operations

Use an available authenticated GitHub connector if it provides these operations. Otherwise use `gh`.
These examples describe operations for a requested sweep; reading this reference does not start one.
Check command failures before consuming their output. Never treat an API error or partial page set as
a successful empty result.

## Repository and complete issue inventory

From the target checkout, inspect `git remote -v`, `git status --short`, `git branch --show-current`
and `git worktree list`. Use `gh repo view --json nameWithOwner,defaultBranchRef` to verify the target
repository and default branch. If multiple remotes make the target ambiguous, resolve that before
writing. Substitute the verified repository below; do not assume `origin` is the intended upstream.

```sh
repo='OWNER/REPO'
gh api --paginate --slurp "repos/$repo/issues?state=open&sort=created&direction=asc&per_page=100" \
  --jq '[.[][] | select(.pull_request == null) | {number, title, url: .html_url, body, labels: [.labels[].name], assignees: [.assignees[].login], created_at, updated_at, comments}]'
```

Save successful output with the inventory timestamp in local run notes. `--paginate` follows every
page; `--slurp` wraps the page arrays so the query produces one issue array. The filter removes PRs,
which GitHub also returns from this endpoint. Ordering by creation time reduces page movement as
discussions change, but the result is not an atomic snapshot; reconcile issue numbers again at the end.

For each issue, fetch the current body and every comment page. Replace `123` with the issue number:

```sh
issue=123
gh api "repos/$repo/issues/$issue"
gh api --paginate --slurp "repos/$repo/issues/$issue/comments?per_page=100" --jq 'add'
```

An authenticated REST or GraphQL client may replace these commands. It must follow pagination for
both issues and comments and distinguish issues from PRs. Do not rely on `gh issue list`'s default
limit or assume a connector's first result page is complete.

## One PR, including retries

Find the existing PR by the exact head repository, branch and base using the connector or a paginated
PR query. Check open and closed results on resume: a merged or closed task PR needs reconciliation,
not an automatic replacement. Inspect its current body, checks and review feedback before editing.

With `gh`, use `gh pr create --repo OWNER/REPO --base BASE --head HEAD --title TITLE --body-file PATH`
only when no matching PR exists and publication is authorized. Use
`gh pr edit NUMBER --repo OWNER/REPO --body-file PATH` to update it. Keep the exact Markdown body in
a local file with real newlines; do not interpolate issue bodies or PR text into shell code. Preserve
existing template fields and truthful attestations when updating the body.

Use `gh pr checks NUMBER --repo OWNER/REPO` to inspect checks. For logs and review discussions, use
the connector or corresponding API endpoints, following all pages. After fixes, refresh the PR body
and issue mapping so they describe the final combined diff.

## Sources

- [GitHub CLI API pagination and output options](https://cli.github.com/manual/gh_api)
- [Repository issues API, including pull requests](https://docs.github.com/en/rest/issues/issues#list-repository-issues)
- [Closing issues through a PR and the default-branch requirement](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue)
