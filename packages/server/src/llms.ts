/**
 * @module llms.txt of a running server
 *
 * The plain-text guide ([llms.txt](https://llmstxt.org)) a server serves about itself at `GET /llms.txt`, for an AI
 * agent that was handed nothing but the server's address. It is written from this server's own settings (its
 * address, whether it needs a token), so what it says is true of the server that says it, and it points at the
 * machine-readable description (`/api/openapi.json`) rather than repeating it.
 */

import { packageManagerTable } from '../../reports/src/package-managers';

/** What the guide says about the server that serves it. */
export type LlmsContext = {
  /** The address clients use, such as `https://atlas.example.com`, no trailing slash. */
  readonly url: string;
  /** True when the server has no tokens: anyone who can reach it may upload. */
  readonly open: boolean;
  /** The id of the backend uploads go to. */
  readonly write: string;
};

/** The guide for one server, Markdown. Stable in structure: an agent may read it by its headings. */
export function llmsTxt(context: LlmsContext): string {
  const { url } = context;
  return `# Atlas server at ${url}

> Atlas shows whether a product still does what it was specified to do. Every environment (laptops, CI, device labs) sends its test results here as immutable "layers"; this server keeps them and shows everyone one combined report, live. The newest completed result of every check wins its slot, whoever sent it.

## Machine-readable description

- [OpenAPI 3.1](${url}/api/openapi.json): every endpoint, parameter, body, response and error. Generate a client or a test suite from it.
- [JSON Schemas](https://unpkg.com/@crvouga/atlas/packages/schema/schemas/): the layer format, the checks file, the report status and the server's responses.
- Errors are RFC 9457 problem documents (\`application/problem+json\`); \`detail\` says what to do.
- Live updates: \`GET ${url}/api/events\` (server-sent events: \`hello\`, \`report\`, \`atlas:change\`, \`ping\`).

## Authenticate

${context.open
    ? 'This server has **no tokens**: anyone who can reach it may upload. Nothing to configure.'
    : `This server needs a token. Ask the operator for a \`publish\` token (to upload) and a \`read\` token (to look). Send \`Authorization: Bearer <token>\`; the CLI reads \`ATLAS_TOKEN\`. Uploading needs the Bearer header. A token is a secret of this one server: never put it in a URL or send it to another host.`}

## Integrate a project (run in the project's repository)

Install \`@crvouga/atlas\` with the project's existing package manager first. The commands below use Bun;
substitute the executor for your package manager. Node also runs the CLI; Bun is optional. Read the installed
\`docs/agents.md\` for the supported runtime versions and full integration playbook.

${packageManagerTable()}

\`\`\`sh
bun add -d @crvouga/atlas
export ATLAS_STORE=${url}${context.open ? '' : '\nexport ATLAS_TOKEN=<a publish token>'}
export ATLAS_PROJECT=checkout-service          # choose the same stable slug locally and in CI
bunx atlas init --server ${url}                # detects test runners and specs, prints a plan (add --json for a machine-readable one)
bunx atlas init --server ${url} --write        # writes the CI workflow and the AGENTS.md section the plan names
bunx atlas report doctor                       # proves the server can be written to and read
\`\`\`

After each suite, send its results (a JUnit or CTRF file, or JSON lines as checks finish):

\`\`\`sh
bunx atlas report publish --producer <suite> --junit out.xml --specs ./specs --environment <env>
my-suite --json | bunx atlas report stream --producer <suite> --environment <env>
\`\`\`

Or with no tooling at all: \`POST ${url}/api/checks?project=<slug>\` with \`{"producer":"smoke","checks":[{"id":"login","title":"can log in","status":"passed"}]}\`.

## Ask whether it passes

\`\`\`sh
bunx atlas report status --format json --branch main --ignore-modified   # exit 0 pass, 1 does not, 2 wrong command
curl ${context.open ? '' : '-H "authorization: Bearer $ATLAS_TOKEN" '}"${url}/api/status?project=$ATLAS_PROJECT"    # the same verdict; header X-Atlas-Ok: true|false
\`\`\`

## Read the tests, their history and the runs

Every endpoint below answers JSON, or Markdown with \`format=markdown\`. Prefix it with \`/api/projects/<slug>\` (or add \`?project=<slug>\`) for a project; \`GET ${url}/api/projects\` lists them.

\`\`\`sh
curl "${url}/api/projects/$ATLAS_PROJECT/reports/tests?format=markdown&limit=50"                 # summary, environments, domains, failing, flaky, slowest, then the tests
curl "${url}/api/projects/$ATLAS_PROJECT/reports/tests?status=failed,flaky&environment=desktop-web" # filter: q, status, environment, producer, domain, spec, tag, run; sort, offset, limit
curl "${url}/api/projects/$ATLAS_PROJECT/reports/tests/history?key=<url-encoded test key>"         # one test: every recorded result, durations, branches, CI runs
curl "${url}/api/projects/$ATLAS_PROJECT/reports/runs?format=markdown"                             # CI runs, newest first, with their results by status
curl "${url}/api/projects/$ATLAS_PROJECT/reports/runs/detail?key=<url-encoded run key>"            # every test one run recorded
\`\`\`

A test's \`key\` is \`JSON.stringify([specPath, id])\`; its \`outcomes\` are its current results per environment and \`stats\` its pass rate, flips, flakiness and durations. The evidence of one result (attachments, steps, retries) is at \`/api/reports/evidence/detail/<backend>/<layer>?check=<id>\`, its files at \`/api/reports/layers/<layer>/blobs/<bundleKey>\`.

## Rules worth knowing

- **Layered, never partitioned.** A check is identified by its \`id\` (keep it stable across runs) plus producer, kind, spec, environment and parameters. A layer that re-ran one check leaves every other check as the last layer that ran it.
- **Unknown is never a pass.** A check still \`running\`, a layer that could not be read, a backend that is down, or a required environment with no results all fail the gate.
- **Failures are evidence: publish them.** Run the suite, ignore its exit code, publish, then gate.
- **Layers are immutable** and named by their content: re-publishing is safe, and a retry never makes a duplicate.
- Uploads go to the backend \`${context.write}\`. Read \`${url}/api/server\` for the backends and what this server can do (\`capabilities\`).
- Evidence (screenshots, videos, traces, logs, steps, annotations, your own data) rides on checks: see https://github.com/crvouga/atlas/blob/main/docs/extending.md
`;
}
