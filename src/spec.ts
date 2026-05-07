import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface SwaggerParameter {
  name: string;
  in: "path" | "query" | "body" | "formData" | "header";
  description?: string;
  required?: boolean;
  type?: string;
  format?: string;
  enum?: string[];
  default?: unknown;
  items?: unknown;
  schema?: unknown;
}

interface ParameterRef {
  $ref: string;
}

interface SwaggerOperation {
  operationId: string;
  summary?: string;
  description?: string;
  parameters?: Array<SwaggerParameter | ParameterRef>;
  consumes?: string[];
  produces?: string[];
  responses?: Record<string, { description?: string; schema?: unknown }>;
}

interface SwaggerSpec {
  swagger: string;
  info: { title: string; version: string };
  host: string;
  basePath: string;
  schemes?: string[];
  paths: Record<string, Record<string, SwaggerOperation>>;
  parameters?: Record<string, SwaggerParameter>;
}

const here = dirname(fileURLToPath(import.meta.url));
const specPath = join(here, "strava-spec.json");
const spec = JSON.parse(readFileSync(specPath, "utf8")) as SwaggerSpec;

const sharedParameters = spec.parameters ?? {};

function resolveParam(p: SwaggerParameter | ParameterRef): SwaggerParameter | null {
  if ("$ref" in p) {
    const refKey = p.$ref.startsWith("#/parameters/") ? p.$ref.slice("#/parameters/".length) : null;
    if (!refKey) return null;
    return sharedParameters[refKey] ?? null;
  }
  return p;
}

function resolveParams(
  params: Array<SwaggerParameter | ParameterRef> | undefined,
): SwaggerParameter[] {
  if (!params) return [];
  return params.map(resolveParam).filter((p): p is SwaggerParameter => p !== null);
}

const operationIndex = new Map<string, { method: string; path: string; op: SwaggerOperation }>();
for (const [path, methods] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(methods)) {
    if (!op.operationId) continue;
    operationIndex.set(op.operationId, {
      method: method.toUpperCase(),
      path,
      op,
    });
  }
}

export interface OperationDescription {
  operationId: string;
  method: string;
  path: string;
  summary?: string;
  description?: string;
  parameters: Array<{
    name: string;
    in: string;
    required: boolean;
    type?: string;
    format?: string;
    enum?: string[];
    description?: string;
  }>;
  consumes?: string[];
  produces?: string[];
  responses?: Record<string, { description?: string }>;
  recommendedScopes: string[];
  rateLimitNote: string;
  docsUrl: string;
  notes: string[];
}

export function listOperationIds(): string[] {
  return Array.from(operationIndex.keys()).sort();
}

export function describeOperation(operationId: string): OperationDescription | null {
  const entry = operationIndex.get(operationId);
  if (!entry) return null;
  const { method, path, op } = entry;
  return {
    operationId,
    method,
    path,
    summary: op.summary,
    description: op.description,
    parameters: resolveParams(op.parameters).map((p) => ({
      name: p.name,
      in: p.in,
      required: !!p.required,
      type: p.type,
      format: p.format,
      enum: p.enum,
      description: p.description,
    })),
    consumes: op.consumes,
    produces: op.produces,
    responses: op.responses
      ? Object.fromEntries(
          Object.entries(op.responses).map(([code, r]) => [code, { description: r.description }]),
        )
      : undefined,
    recommendedScopes: scopeHintFor(operationId, method),
    rateLimitNote:
      "Strava limits: 100 requests / 15 min and 1000 requests / day per access token (shared across all endpoints).",
    docsUrl: "https://developers.strava.com/docs/reference/",
    notes: notesFor(op),
  };
}

function notesFor(op: SwaggerOperation): string[] {
  const out: string[] = [];
  const params = resolveParams(op.parameters);
  if (params.some((p) => p.name === "page" || p.name === "per_page")) {
    out.push(
      "Pagination: iterate page=1,2,3,... until the response is an empty array. Strava may return fewer than per_page items on a non-final page; fewer-than-per_page does NOT mean last page.",
    );
  }
  if (params.some((p) => /date/i.test(p.name) || (p.format && /date|time/i.test(p.format)))) {
    out.push(
      "Dates use ISO 8601 (e.g. 2026-05-07T15:46:20Z). Epoch-based filters (`before`/`after`) take Unix timestamps in seconds.",
    );
  }
  if (op.consumes?.includes("multipart/form-data")) {
    out.push("Request body is multipart/form-data; binary fields are file uploads.");
  }
  if (
    /route|segment|activity/i.test(op.operationId) &&
    /export|stream|getById|byId/i.test(op.operationId)
  ) {
    out.push(
      "Map polylines (`map.polyline`, `map.summary_polyline`) use Google's Encoded Polyline Algorithm. Decode with @mapbox/polyline (JS) or polyline (Python).",
    );
  }
  out.push(
    "See strava_api_conventions for the full convention reference (object representations, status codes, scope details).",
  );
  return out;
}

function scopeHintFor(operationId: string, method: string): string[] {
  const id = operationId.toLowerCase();
  const isWrite = method !== "GET";
  if (
    id.includes("athlete") &&
    (id.includes("zone") || id.includes("stats") || id === "getloggedinathlete")
  ) {
    return ["read,activity:read_all,profile:read_all"];
  }
  if (id.includes("activity") || id.includes("activities")) {
    return [isWrite ? "activity:write" : "activity:read,activity:read_all"];
  }
  if (id.includes("segment")) {
    return [isWrite ? "activity:write" : "read,read_all"];
  }
  if (id.includes("club")) return ["read"];
  if (id.includes("route")) return ["read,read_all"];
  if (id.includes("upload")) return ["activity:write"];
  if (id.includes("gear")) return ["profile:read_all"];
  return ["read"];
}
