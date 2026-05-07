#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StravaClient } from "./client.js";
import { registerTools } from "./tools.js";

async function main(): Promise<void> {
  const accessToken = process.env.STRAVA_ACCESS_TOKEN?.trim();
  const clientId = process.env.STRAVA_CLIENT_ID?.trim();
  const clientSecret = process.env.STRAVA_CLIENT_SECRET?.trim();
  const refreshToken = process.env.STRAVA_REFRESH_TOKEN?.trim();
  const baseUrl = process.env.STRAVA_API_BASE_URL?.trim() || undefined;

  const client = new StravaClient({
    accessToken: accessToken || undefined,
    clientId: clientId || undefined,
    clientSecret: clientSecret || undefined,
    refreshToken: refreshToken || undefined,
    baseUrl,
  });

  const server = new McpServer(
    {
      name: "strava-mcp-kit",
      version: "0.1.0",
    },
    {
      capabilities: { tools: {} },
      instructions:
        "Strava v3 API surface (read + write), dual-purpose:\n" +
        "1. END-USER ANALYSIS: when credentials are configured, every tool calls Strava and " +
        "returns real data. Useful for fitness analysis (HR-zone time, training load, FTP trends, HR drift).\n" +
        "2. DEVELOPER ASSISTANT: pass `dry_run: true` to any tool to get the request descriptor + curl + " +
        "TypeScript + Python snippets WITHOUT calling Strava. Use `strava_describe_endpoint` for the full " +
        "OpenAPI spec of any endpoint (parameters, response, scopes, rate limits, contextual notes). " +
        "Use `strava_api_conventions` for the canonical Strava cheat sheet (pagination iteration rule, " +
        "polylines, dates, status codes, scopes). Use `strava_oauth_authorize_url` and " +
        "`strava_oauth_exchange_code` to bootstrap OAuth from a fresh client. Both modes work without credentials.",
    },
  );

  registerTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("strava-mcp-kit: stdio server ready\n");
}

main().catch((err) => {
  process.stderr.write(
    `strava-mcp-kit: fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
