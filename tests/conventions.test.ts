import { describe, expect, it } from "vitest";
import {
  ALL_OAUTH_SCOPES,
  DEFAULT_OAUTH_SCOPES,
  STRAVA_CONVENTIONS_TEXT,
  buildAuthorizeUrl,
} from "../src/conventions.js";

describe("STRAVA_CONVENTIONS_TEXT", () => {
  it("documents the pagination iteration rule", () => {
    expect(STRAVA_CONVENTIONS_TEXT).toMatch(/iterate.+empty array/i);
    expect(STRAVA_CONVENTIONS_TEXT).toMatch(/fewer.+per_page/i);
  });

  it("documents object representations", () => {
    expect(STRAVA_CONVENTIONS_TEXT).toMatch(/resource_state/);
    expect(STRAVA_CONVENTIONS_TEXT).toMatch(/meta/);
    expect(STRAVA_CONVENTIONS_TEXT).toMatch(/summary/);
    expect(STRAVA_CONVENTIONS_TEXT).toMatch(/detailed/);
  });

  it("documents polylines, dates, status codes, and rate limits", () => {
    expect(STRAVA_CONVENTIONS_TEXT).toMatch(/Encoded Polyline/);
    expect(STRAVA_CONVENTIONS_TEXT).toMatch(/ISO 8601/);
    expect(STRAVA_CONVENTIONS_TEXT).toMatch(/429/);
    expect(STRAVA_CONVENTIONS_TEXT).toMatch(/100 requests \/ 15 minutes/);
  });

  it("lists every recognised OAuth scope", () => {
    for (const scope of ALL_OAUTH_SCOPES) {
      expect(STRAVA_CONVENTIONS_TEXT).toContain(scope.name);
    }
  });
});

describe("buildAuthorizeUrl", () => {
  it("builds a URL with default scopes when none provided", () => {
    const url = buildAuthorizeUrl({ clientId: "12345" });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://www.strava.com/oauth/authorize");
    expect(parsed.searchParams.get("client_id")).toBe("12345");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("scope")).toBe(DEFAULT_OAUTH_SCOPES.join(","));
    expect(parsed.searchParams.get("redirect_uri")).toBe("http://localhost/exchange_token");
    expect(parsed.searchParams.get("approval_prompt")).toBe("force");
  });

  it("honours custom scopes, redirect uri, approval prompt, and state", () => {
    const url = buildAuthorizeUrl({
      clientId: "9999",
      scopes: ["read", "activity:write"],
      redirectUri: "https://example.com/cb",
      approvalPrompt: "auto",
      state: "xyz",
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("client_id")).toBe("9999");
    expect(parsed.searchParams.get("scope")).toBe("read,activity:write");
    expect(parsed.searchParams.get("redirect_uri")).toBe("https://example.com/cb");
    expect(parsed.searchParams.get("approval_prompt")).toBe("auto");
    expect(parsed.searchParams.get("state")).toBe("xyz");
  });
});

describe("DEFAULT_OAUTH_SCOPES", () => {
  it("is read-only and does not include any write scope", () => {
    for (const scope of DEFAULT_OAUTH_SCOPES) {
      expect(scope.endsWith(":write")).toBe(false);
    }
    expect(DEFAULT_OAUTH_SCOPES).toContain("activity:read_all");
  });
});
