import { promises as fs } from "node:fs";
import { basename } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type ZodRawShape, z } from "zod";
import { type RequestOptions, StravaApiError, type StravaClient } from "./client.js";
import {
  ALL_OAUTH_SCOPES,
  DEFAULT_OAUTH_SCOPES,
  STRAVA_CONVENTIONS_TEXT,
  buildAuthorizeUrl,
  exchangeAuthorizationCode,
} from "./conventions.js";
import { formatDryRun } from "./snippets.js";
import { describeOperation, listOperationIds } from "./spec.js";

interface RequestDescriptor {
  path: string;
  opts?: RequestOptions;
}

interface BuildContext {
  dryRun: boolean;
}

interface ToolDef<S extends ZodRawShape> {
  name: string;
  description: string;
  operationId?: string;
  schema: S;
  build: (
    args: z.objectOutputType<S, z.ZodTypeAny>,
    ctx: BuildContext,
  ) => RequestDescriptor | Promise<RequestDescriptor>;
}

const PaginationShape = {
  page: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "Page number, 1-indexed. To fetch every result, iterate page=1,2,3,... until the response is an empty array. Strava may return fewer than per_page items on a non-final page; fewer-than-per_page does NOT mean last page.",
    ),
  per_page: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe("Items per page (default 30, max 200)."),
} satisfies ZodRawShape;

const StreamKeysEnum = z.enum([
  "time",
  "distance",
  "latlng",
  "altitude",
  "velocity_smooth",
  "heartrate",
  "cadence",
  "watts",
  "temp",
  "moving",
  "grade_smooth",
]);

const DryRunShape = {
  dry_run: z
    .boolean()
    .optional()
    .describe(
      "If true, do not call Strava. Return the request descriptor and copy-pasteable curl/TS/Python snippets — useful when generating client code.",
    ),
} satisfies ZodRawShape;

// Tool name -> Strava swagger operationId. Used for describe_endpoint lookup.
const TOOL_TO_OPERATION: Record<string, string> = {
  strava_get_logged_in_athlete: "getLoggedInAthlete",
  strava_update_logged_in_athlete: "updateLoggedInAthlete",
  strava_get_logged_in_athlete_zones: "getLoggedInAthleteZones",
  strava_get_athlete_stats: "getStats",
  strava_get_logged_in_athlete_activities: "getLoggedInAthleteActivities",
  strava_get_activity_by_id: "getActivityById",
  strava_create_activity: "createActivity",
  strava_update_activity_by_id: "updateActivityById",
  strava_get_activity_laps: "getLapsByActivityId",
  strava_get_activity_zones: "getZonesByActivityId",
  strava_get_activity_comments: "getCommentsByActivityId",
  strava_get_activity_kudoers: "getKudoersByActivityId",
  strava_get_activity_streams: "getActivityStreams",
  strava_get_segment_by_id: "getSegmentById",
  strava_get_starred_segments: "getLoggedInAthleteStarredSegments",
  strava_star_segment: "starSegment",
  strava_explore_segments: "exploreSegments",
  strava_get_segment_streams: "getSegmentStreams",
  strava_get_segment_efforts: "getEffortsBySegmentId",
  strava_get_segment_effort_by_id: "getSegmentEffortById",
  strava_get_segment_effort_streams: "getSegmentEffortStreams",
  strava_get_logged_in_athlete_clubs: "getLoggedInAthleteClubs",
  strava_get_club_by_id: "getClubById",
  strava_get_club_members: "getClubMembersById",
  strava_get_club_admins: "getClubAdminsById",
  strava_get_club_activities: "getClubActivitiesById",
  strava_get_gear_by_id: "getGearById",
  strava_get_routes_by_athlete: "getRoutesByAthleteId",
  strava_get_route_by_id: "getRouteById",
  strava_export_route_gpx: "getRouteAsGPX",
  strava_export_route_tcx: "getRouteAsTCX",
  strava_get_route_streams: "getRouteStreams",
  strava_create_upload: "createUpload",
  strava_get_upload_by_id: "getUploadById",
};

export function registerTools(server: McpServer, client: StravaClient): void {
  for (const tool of buildTools()) {
    const schema = { ...tool.schema, ...DryRunShape };
    server.tool(tool.name, tool.description, schema, async (args) => {
      try {
        const { dry_run, ...rest } = args as Record<string, unknown> & {
          dry_run?: boolean;
        };
        const descriptor = await tool.build(rest as never, {
          dryRun: !!dry_run,
        });
        if (dry_run) {
          const built = client.buildRequest(descriptor.path, descriptor.opts ?? {});
          return toToolResult(formatDryRun(built));
        }
        const result = await client.request(descriptor.path, descriptor.opts ?? {});
        return toToolResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    });
  }

  // Meta tool: describe any Strava endpoint by tool name or operationId.
  server.tool(
    "strava_describe_endpoint",
    "Return the Strava OpenAPI spec for an endpoint (parameters, response shape, recommended OAuth scopes, rate limits, doc link). Accepts an MCP tool name (e.g. strava_get_activity_by_id) or a Strava operationId (e.g. getActivityById). Use this when generating client code or learning the API without making a call.",
    {
      target: z
        .string()
        .describe("Tool name (strava_get_activity_by_id) or Strava operationId (getActivityById)."),
    },
    async ({ target }) => {
      try {
        const operationId = TOOL_TO_OPERATION[target] ?? target;
        const desc = describeOperation(operationId);
        if (!desc) {
          const known = Object.keys(TOOL_TO_OPERATION)
            .concat(listOperationIds())
            .filter((v, i, a) => a.indexOf(v) === i)
            .sort();
          return toErrorResult(
            new Error(
              `Unknown endpoint '${target}'. Known tool names and operationIds:\n${known.join("\n")}`,
            ),
          );
        }
        const toolName = Object.entries(TOOL_TO_OPERATION).find(
          ([, op]) => op === operationId,
        )?.[0];
        return toToolResult({
          mcpToolName: toolName,
          ...desc,
        });
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );

  // Meta tool: Strava API conventions cheat sheet (pagination, dates, polylines, status codes, scopes).
  server.tool(
    "strava_api_conventions",
    "Return a cheat sheet of Strava API conventions: pagination iteration rule, object representations (meta/summary/detailed), polyline encoding, ISO-8601 date handling, rate limits, OAuth scopes, and HTTP status codes. Call this once when integrating with Strava to avoid common mistakes (especially the pagination rule, which differs from typical REST APIs).",
    {},
    async () => toToolResult(STRAVA_CONVENTIONS_TEXT),
  );

  // Meta tool: build an OAuth authorize URL.
  server.tool(
    "strava_oauth_authorize_url",
    "Build the Strava OAuth authorize URL for a given client_id and scopes. Returns a URL to open in a browser. After the user authorizes, Strava redirects to redirect_uri with ?code=AUTH_CODE; pass that code to strava_oauth_exchange_code to mint tokens. Works without existing credentials — useful during initial setup.",
    {
      client_id: z
        .string()
        .describe("Strava app Client ID (from https://www.strava.com/settings/api)."),
      scopes: z
        .array(z.string())
        .optional()
        .describe(
          `OAuth scopes (default: ${DEFAULT_OAUTH_SCOPES.join(", ")}). Available: ${ALL_OAUTH_SCOPES.map((s) => s.name).join(", ")}.`,
        ),
      redirect_uri: z
        .string()
        .optional()
        .describe(
          "Redirect target after authorization. Default http://localhost/exchange_token (the page will fail to load — copy the code from the URL bar).",
        ),
      approval_prompt: z
        .enum(["auto", "force"])
        .optional()
        .describe("'force' always shows the consent screen even if previously granted."),
      state: z
        .string()
        .optional()
        .describe("Opaque value echoed back in the redirect; useful for CSRF protection."),
    },
    async ({ client_id, scopes, redirect_uri, approval_prompt, state }) => {
      const url = buildAuthorizeUrl({
        clientId: client_id,
        scopes,
        redirectUri: redirect_uri,
        approvalPrompt: approval_prompt,
        state,
      });
      const scopeRows = (scopes ?? DEFAULT_OAUTH_SCOPES)
        .map((s) => {
          const meta = ALL_OAUTH_SCOPES.find((x) => x.name === s);
          return `  - ${s}${meta ? ` — ${meta.reason}` : ""}`;
        })
        .join("\n");
      return toToolResult({
        url,
        scopes: scopes ?? DEFAULT_OAUTH_SCOPES,
        next_step:
          "Open this URL in a browser, authorize the app, then copy the `code` parameter from the redirect URL and pass it to strava_oauth_exchange_code along with your client_id and client_secret.",
        scope_descriptions: scopeRows,
      });
    },
  );

  // Meta tool: exchange OAuth code for access + refresh tokens.
  server.tool(
    "strava_oauth_exchange_code",
    "Exchange a Strava OAuth authorization code for access + refresh tokens. Call this once after the user authorizes via the URL from strava_oauth_authorize_url. Returns access_token (short-lived), refresh_token (long-lived), expires_at (epoch seconds), and the athlete summary. Save the refresh_token to env STRAVA_REFRESH_TOKEN — this server will then auto-refresh access tokens as needed.",
    {
      client_id: z.string().describe("Strava app Client ID."),
      client_secret: z.string().describe("Strava app Client Secret."),
      code: z.string().describe("Authorization code from the OAuth redirect."),
    },
    async ({ client_id, client_secret, code }) => {
      try {
        const tokens = await exchangeAuthorizationCode({
          clientId: client_id,
          clientSecret: client_secret,
          code,
        });
        return toToolResult({
          ...tokens,
          next_step:
            "Set STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, and STRAVA_REFRESH_TOKEN in your MCP host config, then restart the host. The server will refresh access tokens automatically.",
        });
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );
}

function buildTools(): Array<ToolDef<ZodRawShape>> {
  const list: Array<ToolDef<ZodRawShape>> = [];
  const add = <S extends ZodRawShape>(t: ToolDef<S>) => {
    list.push(t as unknown as ToolDef<ZodRawShape>);
  };

  // ---------- Athletes ----------
  add({
    name: "strava_get_logged_in_athlete",
    description:
      "Get the currently authenticated athlete's profile (weight, FTP, max HR, premium status).",
    schema: {},
    build: () => ({ path: "/athlete" }),
  });

  add({
    name: "strava_update_logged_in_athlete",
    description:
      "Update the authenticated athlete's weight (kilograms). Requires `profile:write` scope.",
    schema: {
      weight: z.number().positive().describe("Athlete weight in kilograms."),
    },
    build: ({ weight }) => ({
      path: "/athlete",
      opts: {
        method: "PUT",
        multipart: [{ name: "weight", value: String(weight) }],
      },
    }),
  });

  add({
    name: "strava_get_logged_in_athlete_zones",
    description: "Get heart rate and power zones for the authenticated athlete.",
    schema: {},
    build: () => ({ path: "/athlete/zones" }),
  });

  add({
    name: "strava_get_athlete_stats",
    description:
      "Get totals/stats for an athlete. Only works for the authenticated athlete's own id.",
    schema: {
      id: z.number().int().describe("Athlete id (must be the authenticated athlete)."),
    },
    build: ({ id }) => ({ path: `/athletes/${id}/stats` }),
  });

  // ---------- Activities ----------
  add({
    name: "strava_get_logged_in_athlete_activities",
    description:
      "List activities for the authenticated athlete, newest first. Supports pagination and date filters.",
    schema: {
      before: z
        .number()
        .int()
        .optional()
        .describe("Epoch seconds. Only activities before this time."),
      after: z
        .number()
        .int()
        .optional()
        .describe("Epoch seconds. Only activities after this time."),
      ...PaginationShape,
    },
    build: (args) => ({ path: "/athlete/activities", opts: { query: args } }),
  });

  add({
    name: "strava_get_activity_by_id",
    description: "Get a detailed activity by id.",
    schema: {
      id: z.number().int().describe("Activity id."),
      include_all_efforts: z
        .boolean()
        .optional()
        .describe("Include all segment efforts in the response."),
    },
    build: ({ id, include_all_efforts }) => ({
      path: `/activities/${id}`,
      opts: { query: { include_all_efforts } },
    }),
  });

  add({
    name: "strava_create_activity",
    description:
      "Create a manual activity for the authenticated athlete. Requires `activity:write` scope.",
    schema: {
      name: z.string().describe("Activity name."),
      sport_type: z.string().describe("Sport type (e.g. Run, Ride, MountainBikeRide, Walk)."),
      start_date_local: z
        .string()
        .describe("ISO-8601 local start time, e.g. 2026-05-06T07:30:00Z."),
      elapsed_time: z.number().int().positive().describe("Elapsed time in seconds."),
      type: z.string().optional().describe("Deprecated activity type."),
      description: z.string().optional(),
      distance: z.number().nonnegative().optional().describe("Distance in meters."),
      trainer: z.boolean().optional().describe("Mark as trainer activity."),
      commute: z.boolean().optional().describe("Mark as commute."),
    },
    build: ({ trainer, commute, ...rest }) => {
      const form: Record<string, unknown> = { ...rest };
      if (trainer !== undefined) form.trainer = trainer ? 1 : 0;
      if (commute !== undefined) form.commute = commute ? 1 : 0;
      return { path: "/activities", opts: { method: "POST", form } };
    },
  });

  add({
    name: "strava_update_activity_by_id",
    description: "Update an existing activity. Requires `activity:write` scope.",
    schema: {
      id: z.number().int().describe("Activity id."),
      commute: z.boolean().optional(),
      trainer: z.boolean().optional(),
      hide_from_home: z.boolean().optional(),
      description: z.string().optional(),
      name: z.string().optional(),
      sport_type: z.string().optional(),
      gear_id: z.string().optional().describe("Gear id, or 'none' to unset gear."),
    },
    build: ({ id, ...body }) => ({
      path: `/activities/${id}`,
      opts: { method: "PUT", json: body },
    }),
  });

  add({
    name: "strava_get_activity_laps",
    description: "Get laps for an activity.",
    schema: { id: z.number().int().describe("Activity id.") },
    build: ({ id }) => ({ path: `/activities/${id}/laps` }),
  });

  add({
    name: "strava_get_activity_zones",
    description: "Get zone splits for an activity (requires Strava Summit).",
    schema: { id: z.number().int().describe("Activity id.") },
    build: ({ id }) => ({ path: `/activities/${id}/zones` }),
  });

  add({
    name: "strava_get_activity_comments",
    description: "List comments on an activity.",
    schema: {
      id: z.number().int().describe("Activity id."),
      ...PaginationShape,
      page_size: z.number().int().min(1).max(200).optional(),
      after_cursor: z.string().optional(),
    },
    build: ({ id, ...query }) => ({
      path: `/activities/${id}/comments`,
      opts: { query },
    }),
  });

  add({
    name: "strava_get_activity_kudoers",
    description: "List athletes who gave kudos to an activity.",
    schema: {
      id: z.number().int().describe("Activity id."),
      ...PaginationShape,
    },
    build: ({ id, ...query }) => ({
      path: `/activities/${id}/kudos`,
      opts: { query },
    }),
  });

  add({
    name: "strava_get_activity_streams",
    description: "Get raw time-series streams for an activity. Requires at least one stream key.",
    schema: {
      id: z.number().int().describe("Activity id."),
      keys: z
        .array(StreamKeysEnum)
        .min(1)
        .describe("Stream types to fetch (e.g. heartrate, watts, latlng)."),
      key_by_type: z
        .boolean()
        .optional()
        .describe("Return streams keyed by type (Strava recommends true)."),
    },
    build: ({ id, keys, key_by_type }) => ({
      path: `/activities/${id}/streams`,
      opts: { query: { keys, key_by_type: key_by_type ?? true } },
    }),
  });

  // ---------- Segments ----------
  add({
    name: "strava_get_segment_by_id",
    description: "Get details of a segment by id.",
    schema: { id: z.number().int().describe("Segment id.") },
    build: ({ id }) => ({ path: `/segments/${id}` }),
  });

  add({
    name: "strava_get_starred_segments",
    description: "List segments starred by the authenticated athlete.",
    schema: { ...PaginationShape },
    build: (args) => ({ path: "/segments/starred", opts: { query: args } }),
  });

  add({
    name: "strava_star_segment",
    description:
      "Star or unstar a segment for the authenticated athlete. Requires `activity:write` scope.",
    schema: {
      id: z.number().int().describe("Segment id."),
      starred: z.boolean().describe("True to star, false to unstar."),
    },
    build: ({ id, starred }) => ({
      path: `/segments/${id}/starred`,
      opts: { method: "PUT", form: { starred } },
    }),
  });

  add({
    name: "strava_explore_segments",
    description:
      "Explore popular segments inside a bounding box. Bounds is [SW lat, SW lng, NE lat, NE lng].",
    schema: {
      bounds: z
        .array(z.number())
        .length(4)
        .describe("[south_west_lat, south_west_lng, north_east_lat, north_east_lng]"),
      activity_type: z.enum(["running", "riding"]).optional(),
      min_cat: z.number().int().min(0).max(5).optional(),
      max_cat: z.number().int().min(0).max(5).optional(),
    },
    build: (args) => ({
      path: "/segments/explore",
      opts: { query: { ...args, bounds: args.bounds.join(",") } },
    }),
  });

  add({
    name: "strava_get_segment_streams",
    description: "Get time-series streams for a segment.",
    schema: {
      id: z.number().int().describe("Segment id."),
      keys: z.array(StreamKeysEnum).min(1),
      key_by_type: z.boolean().optional(),
    },
    build: ({ id, keys, key_by_type }) => ({
      path: `/segments/${id}/streams`,
      opts: { query: { keys, key_by_type: key_by_type ?? true } },
    }),
  });

  // ---------- Segment efforts ----------
  add({
    name: "strava_get_segment_efforts",
    description: "List segment efforts for a segment, optionally filtered by date range.",
    schema: {
      segment_id: z.number().int(),
      start_date_local: z.string().optional().describe("ISO-8601 start datetime."),
      end_date_local: z.string().optional().describe("ISO-8601 end datetime."),
      per_page: z.number().int().min(1).max(200).optional(),
    },
    build: (args) => ({ path: "/segment_efforts", opts: { query: args } }),
  });

  add({
    name: "strava_get_segment_effort_by_id",
    description: "Get a segment effort by id.",
    schema: { id: z.number().int().describe("Segment effort id.") },
    build: ({ id }) => ({ path: `/segment_efforts/${id}` }),
  });

  add({
    name: "strava_get_segment_effort_streams",
    description: "Get time-series streams for a segment effort.",
    schema: {
      id: z.number().int(),
      keys: z.array(StreamKeysEnum).min(1),
      key_by_type: z.boolean().optional(),
    },
    build: ({ id, keys, key_by_type }) => ({
      path: `/segment_efforts/${id}/streams`,
      opts: { query: { keys, key_by_type: key_by_type ?? true } },
    }),
  });

  // ---------- Clubs ----------
  add({
    name: "strava_get_logged_in_athlete_clubs",
    description: "List clubs the authenticated athlete is a member of.",
    schema: { ...PaginationShape },
    build: (args) => ({ path: "/athlete/clubs", opts: { query: args } }),
  });

  add({
    name: "strava_get_club_by_id",
    description: "Get a club by id.",
    schema: { id: z.number().int().describe("Club id.") },
    build: ({ id }) => ({ path: `/clubs/${id}` }),
  });

  add({
    name: "strava_get_club_members",
    description: "List members of a club.",
    schema: { id: z.number().int(), ...PaginationShape },
    build: ({ id, ...query }) => ({ path: `/clubs/${id}/members`, opts: { query } }),
  });

  add({
    name: "strava_get_club_admins",
    description: "List admins of a club.",
    schema: { id: z.number().int(), ...PaginationShape },
    build: ({ id, ...query }) => ({ path: `/clubs/${id}/admins`, opts: { query } }),
  });

  add({
    name: "strava_get_club_activities",
    description: "List recent activities posted to a club.",
    schema: { id: z.number().int(), ...PaginationShape },
    build: ({ id, ...query }) => ({ path: `/clubs/${id}/activities`, opts: { query } }),
  });

  // ---------- Gear ----------
  add({
    name: "strava_get_gear_by_id",
    description: "Get gear details by id (e.g. b1234567 for a bike).",
    schema: { id: z.string().describe("Gear id (string).") },
    build: ({ id }) => ({ path: `/gear/${id}` }),
  });

  // ---------- Routes ----------
  add({
    name: "strava_get_routes_by_athlete",
    description: "List routes created by an athlete.",
    schema: { id: z.number().int().describe("Athlete id."), ...PaginationShape },
    build: ({ id, ...query }) => ({ path: `/athletes/${id}/routes`, opts: { query } }),
  });

  add({
    name: "strava_get_route_by_id",
    description: "Get a route by id.",
    schema: { id: z.number().int().describe("Route id.") },
    build: ({ id }) => ({ path: `/routes/${id}` }),
  });

  add({
    name: "strava_export_route_gpx",
    description: "Export a route as GPX (returns the raw GPX XML as text).",
    schema: { id: z.number().int().describe("Route id.") },
    build: ({ id }) => ({
      path: `/routes/${id}/export_gpx`,
      opts: { responseType: "text" },
    }),
  });

  add({
    name: "strava_export_route_tcx",
    description: "Export a route as TCX (returns the raw TCX XML as text).",
    schema: { id: z.number().int().describe("Route id.") },
    build: ({ id }) => ({
      path: `/routes/${id}/export_tcx`,
      opts: { responseType: "text" },
    }),
  });

  add({
    name: "strava_get_route_streams",
    description: "Get time-series streams for a route.",
    schema: {
      id: z.number().int().describe("Route id."),
      keys: z.array(StreamKeysEnum).min(1).optional(),
      key_by_type: z.boolean().optional(),
    },
    build: ({ id, keys, key_by_type }) => ({
      path: `/routes/${id}/streams`,
      opts: keys ? { query: { keys, key_by_type: key_by_type ?? true } } : undefined,
    }),
  });

  // ---------- Uploads ----------
  add({
    name: "strava_create_upload",
    description:
      "Upload an activity file (FIT/TCX/GPX, optionally gzipped) from a local path. Requires `activity:write` scope. In dry_run mode the file is NOT read — only the filename is used.",
    schema: {
      file_path: z.string().describe("Absolute path to the activity file on disk."),
      data_type: z
        .enum(["fit", "fit.gz", "tcx", "tcx.gz", "gpx", "gpx.gz"])
        .describe("File format."),
      name: z.string().optional(),
      description: z.string().optional(),
      external_id: z.string().optional(),
      trainer: z.boolean().optional(),
      commute: z.boolean().optional(),
    },
    build: async (args, { dryRun }) => {
      const filename = basename(args.file_path);
      const fileBlob = dryRun
        ? new Blob([""], { type: "application/octet-stream" })
        : new Blob([new Uint8Array(await fs.readFile(args.file_path))]);
      const parts: Array<{ name: string; value: string | Blob; filename?: string }> = [
        { name: "file", value: fileBlob, filename },
        { name: "data_type", value: args.data_type },
      ];
      if (args.name) parts.push({ name: "name", value: args.name });
      if (args.description) parts.push({ name: "description", value: args.description });
      if (args.external_id) parts.push({ name: "external_id", value: args.external_id });
      if (args.trainer !== undefined) parts.push({ name: "trainer", value: String(args.trainer) });
      if (args.commute !== undefined) parts.push({ name: "commute", value: String(args.commute) });
      return { path: "/uploads", opts: { method: "POST", multipart: parts } };
    },
  });

  add({
    name: "strava_get_upload_by_id",
    description:
      "Check the status of an upload by id. Poll until status is 'Your activity is ready.' or an error appears.",
    schema: { uploadId: z.number().int().describe("Upload id from create_upload.") },
    build: ({ uploadId }) => ({ path: `/uploads/${uploadId}` }),
  });

  return list;
}

function toToolResult(value: unknown): {
  content: Array<{ type: "text"; text: string }>;
} {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }] };
}

function toErrorResult(err: unknown): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  let text: string;
  if (err instanceof StravaApiError) {
    text = `Strava API error ${err.status} ${err.statusText}\n${
      typeof err.body === "string" ? err.body : JSON.stringify(err.body, null, 2)
    }`;
  } else if (err instanceof Error) {
    text = `${err.name}: ${err.message}`;
  } else {
    text = `Unknown error: ${String(err)}`;
  }
  return { content: [{ type: "text", text }], isError: true };
}
