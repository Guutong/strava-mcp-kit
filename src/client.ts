const DEFAULT_BASE_URL = "https://www.strava.com/api/v3";
const TOKEN_URL = "https://www.strava.com/oauth/token";
const REFRESH_SKEW_SECONDS = 60;
const PLACEHOLDER_TOKEN = "<STRAVA_ACCESS_TOKEN>";

export interface StravaClientConfig {
  accessToken?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  baseUrl?: string;
}

interface TokenState {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
}

interface OAuthRefreshResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  expires_in: number;
  token_type: "Bearer";
}

export class StravaApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly url: string,
    public readonly body: unknown,
  ) {
    const detail = typeof body === "string" ? body : JSON.stringify(body);
    super(`Strava API ${status} ${statusText} (${url}): ${detail}`);
    this.name = "StravaApiError";
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  query?: Record<string, unknown>;
  form?: Record<string, unknown>;
  multipart?: Array<{ name: string; value: string | Blob; filename?: string }>;
  json?: unknown;
  responseType?: "json" | "text";
}

export interface BuiltRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?:
    | { kind: "json"; value: unknown; serialized: string }
    | { kind: "form"; value: Record<string, string>; serialized: string }
    | {
        kind: "multipart";
        parts: Array<{ name: string; value: string; isFile: boolean; filename?: string }>;
      };
}

export class StravaClient {
  private readonly baseUrl: string;
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private token: TokenState | null;
  private refreshing: Promise<void> | null = null;

  constructor(config: StravaClientConfig) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;

    if (config.accessToken) {
      this.token = {
        accessToken: config.accessToken,
        expiresAt: Number.MAX_SAFE_INTEGER,
        refreshToken: config.refreshToken,
      };
    } else if (config.refreshToken && config.clientId && config.clientSecret) {
      this.token = {
        accessToken: "",
        expiresAt: 0,
        refreshToken: config.refreshToken,
      };
    } else {
      this.token = null;
    }
  }

  hasCredentials(): boolean {
    return this.token !== null;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Build a request descriptor without executing it. Used by dry_run.
   * Auth header uses a placeholder so the snippet can be shared safely.
   */
  buildRequest(path: string, opts: RequestOptions = {}): BuiltRequest {
    const url = this.buildUrl(path, opts.query);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${PLACEHOLDER_TOKEN}`,
      Accept: "application/json",
    };

    let body: BuiltRequest["body"];
    if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = {
        kind: "json",
        value: opts.json,
        serialized: JSON.stringify(opts.json),
      };
    } else if (opts.form) {
      const flat: Record<string, string> = {};
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(opts.form)) {
        if (v === undefined || v === null) continue;
        const s = String(v);
        flat[k] = s;
        params.append(k, s);
      }
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = { kind: "form", value: flat, serialized: params.toString() };
    } else if (opts.multipart) {
      headers["Content-Type"] = "multipart/form-data";
      body = {
        kind: "multipart",
        parts: opts.multipart.map((p) => ({
          name: p.name,
          value: p.value instanceof Blob ? `<binary ${p.filename ?? "blob"}>` : String(p.value),
          isFile: p.value instanceof Blob,
          filename: p.filename,
        })),
      };
    }

    return { method: opts.method ?? "GET", url, headers, body };
  }

  async request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
    if (!this.token) {
      throw new Error(
        "Strava credentials missing. Provide STRAVA_ACCESS_TOKEN, or STRAVA_CLIENT_ID + STRAVA_CLIENT_SECRET + STRAVA_REFRESH_TOKEN. (Tip: pass dry_run=true to see the request without auth.)",
      );
    }
    await this.ensureAccessToken();
    const token = this.token;
    if (!token) throw new Error("Strava client lost token state during request");
    const url = this.buildUrl(path, opts.query);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token.accessToken}`,
      Accept: "application/json",
    };

    let body: string | URLSearchParams | FormData | undefined;
    if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.json);
    } else if (opts.form) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(opts.form)) {
        if (v === undefined || v === null) continue;
        params.append(k, String(v));
      }
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = params.toString();
    } else if (opts.multipart) {
      const fd = new FormData();
      for (const part of opts.multipart) {
        if (part.value instanceof Blob) {
          fd.append(part.name, part.value, part.filename);
        } else {
          fd.append(part.name, part.value);
        }
      }
      body = fd;
    }

    const res = await fetch(url, { method: opts.method ?? "GET", headers, body });
    if (!res.ok) {
      const errBody = await this.readBody(res);
      throw new StravaApiError(res.status, res.statusText, url, errBody);
    }

    if (opts.responseType === "text") {
      return (await res.text()) as T;
    }
    if (res.status === 204) return undefined as T;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) {
      return (await res.text()) as T;
    }
    return (await res.json()) as T;
  }

  private async readBody(res: Response): Promise<unknown> {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private buildUrl(path: string, query?: Record<string, unknown>): string {
    const url = new URL(`${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null) continue;
        if (Array.isArray(v)) {
          if (v.length === 0) continue;
          url.searchParams.set(k, v.join(","));
        } else {
          url.searchParams.set(k, String(v));
        }
      }
    }
    return url.toString();
  }

  private async ensureAccessToken(): Promise<void> {
    if (!this.token) throw new Error("Strava client has no token state");
    const now = Math.floor(Date.now() / 1000);
    if (this.token.accessToken && this.token.expiresAt - REFRESH_SKEW_SECONDS > now) {
      return;
    }
    if (!this.token.refreshToken || !this.clientId || !this.clientSecret) {
      if (this.token.accessToken) return;
      throw new Error("Strava access token expired and no refresh credentials configured.");
    }
    if (!this.refreshing) {
      this.refreshing = this.refreshAccessToken().finally(() => {
        this.refreshing = null;
      });
    }
    await this.refreshing;
  }

  private async refreshAccessToken(): Promise<void> {
    if (!this.token?.refreshToken || !this.clientId || !this.clientSecret) {
      throw new Error("Cannot refresh: missing refresh credentials");
    }
    const params = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: "refresh_token",
      refresh_token: this.token.refreshToken,
    });
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new StravaApiError(res.status, res.statusText, TOKEN_URL, body);
    }
    const data = (await res.json()) as OAuthRefreshResponse;
    this.token = {
      accessToken: data.access_token,
      expiresAt: data.expires_at,
      refreshToken: data.refresh_token,
    };
  }
}
