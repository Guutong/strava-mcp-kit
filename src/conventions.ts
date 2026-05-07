export const STRAVA_CONVENTIONS_TEXT = `# Strava API conventions cheat sheet

When in doubt about pagination, dates, or response shape, prefer this document over guessing.

## Pagination

- Default page size: 30. Max \`per_page\`: 200.
- IMPORTANT: iterate until you receive an empty array. Strava may return fewer than \`per_page\` items on a non-final page. "Fewer items than per_page" does NOT imply "last page".
- The \`page\` parameter is 1-indexed.

Iteration pattern:
\`\`\`
let page = 1; const all = [];
while (true) {
  const batch = await call({ page, per_page: 200 });
  if (batch.length === 0) break;
  all.push(...batch);
  page++;
}
\`\`\`

## Object representations

Endpoints return objects in one of three detail levels:

| resource_state | Level    | Notes                                            |
|----------------|----------|--------------------------------------------------|
| 1              | meta     | id + name only (e.g. inside a club summary)     |
| 2              | summary  | most common; list endpoints return summaries    |
| 3              | detailed | full payload; getById endpoints return detailed |

Always check \`resource_state\` before assuming a field exists.

## Polylines

\`map.polyline\` and \`map.summary_polyline\` use Google's Encoded Polyline Algorithm. Decode with:
- JavaScript: \`@mapbox/polyline\`
- Python: \`polyline\`
- Go: \`github.com/twpayne/go-polyline\`

## Dates

- ISO 8601 with timezone offset, e.g. \`2026-05-07T15:46:20Z\` or \`2026-05-07T08:46:20-07:00\`.
- \`start_date_local\` is the UTC representation of the local clock-on-the-wall time. Display it as UTC to show the user the correct local time.
- The \`timezone\` field on activities pairs with \`start_date\` for fully tz-aware display.
- Epoch-based query filters (\`before\`, \`after\`) take Unix timestamps in seconds.

## HTTP status codes

- 200 OK
- 201 Resource created
- 401 Unauthorized — token missing, invalid, or expired
- 403 Forbidden — missing scope, or accessing someone else's resource
- 404 Not found
- 429 Rate limited
- 500 Strava server error — check https://status.strava.com

## Rate limits

- 100 requests / 15 minutes
- 1000 requests / day
- Shared across all endpoints, per access token.

## OAuth scopes

| Scope                  | Grants                                                       |
|------------------------|--------------------------------------------------------------|
| \`read\`                 | Public profile, public clubs, public segments               |
| \`read_all\`             | Also private clubs and segments                             |
| \`activity:read\`        | Read public activities                                      |
| \`activity:read_all\`    | Read all activities including private                       |
| \`activity:write\`       | Create / update / star / upload activities and segments     |
| \`profile:read_all\`     | Weight, FTP, max HR                                         |
| \`profile:write\`        | Update weight                                               |

## Token lifecycle

- Access tokens expire ~6 hours after issue.
- Refresh via POST https://www.strava.com/oauth/token with form fields
  \`client_id\`, \`client_secret\`, \`grant_type=refresh_token\`, \`refresh_token\`.
- This server refreshes automatically when \`STRAVA_CLIENT_ID + STRAVA_CLIENT_SECRET + STRAVA_REFRESH_TOKEN\` are configured.

## Authoritative sources

- API reference: https://developers.strava.com/docs/reference/
- Swagger spec: https://developers.strava.com/swagger/swagger.json
- Authentication: https://developers.strava.com/docs/authentication/
- Status page: https://status.strava.com
`;

export const STRAVA_OAUTH_AUTHORIZE_URL = "https://www.strava.com/oauth/authorize";
export const STRAVA_OAUTH_TOKEN_URL = "https://www.strava.com/oauth/token";

export const DEFAULT_OAUTH_SCOPES = ["read", "activity:read_all", "profile:read_all"];

export interface StravaOAuthScope {
  name: string;
  reason: string;
}

export const ALL_OAUTH_SCOPES: StravaOAuthScope[] = [
  { name: "read", reason: "public profile, public clubs and segments" },
  { name: "read_all", reason: "private clubs and segments" },
  { name: "activity:read", reason: "read public activities" },
  { name: "activity:read_all", reason: "read all activities including private" },
  { name: "activity:write", reason: "create, update, star, upload activities and segments" },
  { name: "profile:read_all", reason: "athlete weight, FTP, max HR" },
  { name: "profile:write", reason: "update athlete weight" },
];

export function buildAuthorizeUrl(input: {
  clientId: string;
  redirectUri?: string;
  scopes?: string[];
  approvalPrompt?: "auto" | "force";
  state?: string;
}): string {
  const url = new URL(STRAVA_OAUTH_AUTHORIZE_URL);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", input.redirectUri ?? "http://localhost/exchange_token");
  url.searchParams.set("approval_prompt", input.approvalPrompt ?? "force");
  url.searchParams.set("scope", (input.scopes ?? DEFAULT_OAUTH_SCOPES).join(","));
  if (input.state) url.searchParams.set("state", input.state);
  return url.toString();
}

export interface OAuthExchangeResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  expires_in: number;
  token_type: string;
  athlete?: { id: number; username?: string | null; firstname?: string; lastname?: string };
}

export async function exchangeAuthorizationCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
}): Promise<OAuthExchangeResponse> {
  const params = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    grant_type: "authorization_code",
  });
  const res = await fetch(STRAVA_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OAuth token exchange failed (${res.status} ${res.statusText}): ${body}`);
  }
  return (await res.json()) as OAuthExchangeResponse;
}
