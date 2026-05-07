import { describe, expect, it } from "vitest";
import type { BuiltRequest } from "../src/client.js";
import { formatDryRun } from "../src/snippets.js";

const baseHeaders: Record<string, string> = {
  Authorization: "Bearer <STRAVA_ACCESS_TOKEN>",
  Accept: "application/json",
};

function makeGet(): BuiltRequest {
  return {
    method: "GET",
    url: "https://www.strava.com/api/v3/athlete",
    headers: { ...baseHeaders },
  };
}

function makeJsonPost(): BuiltRequest {
  const value = { name: "Ride", distance: 12000 };
  return {
    method: "POST",
    url: "https://www.strava.com/api/v3/activities",
    headers: { ...baseHeaders, "Content-Type": "application/json" },
    body: { kind: "json", value, serialized: JSON.stringify(value) },
  };
}

function makeFormPost(): BuiltRequest {
  const value = { name: "Ride", trainer: "1" };
  return {
    method: "POST",
    url: "https://www.strava.com/api/v3/activities",
    headers: { ...baseHeaders, "Content-Type": "application/x-www-form-urlencoded" },
    body: {
      kind: "form",
      value,
      serialized: new URLSearchParams(value).toString(),
    },
  };
}

function makeMultipartPost(): BuiltRequest {
  return {
    method: "POST",
    url: "https://www.strava.com/api/v3/uploads",
    headers: { ...baseHeaders, "Content-Type": "multipart/form-data" },
    body: {
      kind: "multipart",
      parts: [
        { name: "file", value: "<binary ride.fit>", isFile: true, filename: "ride.fit" },
        { name: "data_type", value: "fit", isFile: false },
      ],
    },
  };
}

describe("formatDryRun GET no body", () => {
  const result = formatDryRun(makeGet());

  it("emits curl with -X GET and headers and no -d", () => {
    expect(result.snippets.curl).toContain("curl -X GET");
    expect(result.snippets.curl).toContain("-H 'Authorization: Bearer <STRAVA_ACCESS_TOKEN>'");
    expect(result.snippets.curl).not.toContain("-d ");
    expect(result.snippets.curl).not.toContain("--data-urlencode");
  });

  it("emits TypeScript fetch call", () => {
    expect(result.snippets.typescript).toContain("await fetch(");
    expect(result.snippets.typescript).toContain('method: "GET"');
  });

  it("emits Python requests.request call", () => {
    expect(result.snippets.python).toContain("import requests");
    expect(result.snippets.python).toContain('requests.request("GET"');
  });
});

describe("formatDryRun JSON body", () => {
  const result = formatDryRun(makeJsonPost());

  it("curl serializes json after -d", () => {
    expect(result.snippets.curl).toMatch(/-d '.*"name":"Ride".*'/);
  });

  it("TypeScript uses JSON.stringify", () => {
    expect(result.snippets.typescript).toContain("JSON.stringify(");
  });

  it("Python passes json= argument", () => {
    expect(result.snippets.python).toContain("json=json_body");
  });
});

describe("formatDryRun form body", () => {
  const result = formatDryRun(makeFormPost());

  it("curl uses --data-urlencode per field", () => {
    expect(result.snippets.curl).toContain("--data-urlencode 'name=Ride'");
    expect(result.snippets.curl).toContain("--data-urlencode 'trainer=1'");
  });

  it("TypeScript uses URLSearchParams", () => {
    expect(result.snippets.typescript).toContain("new URLSearchParams(");
  });

  it("Python passes data= argument", () => {
    expect(result.snippets.python).toContain("data=data");
  });
});

describe("formatDryRun multipart body", () => {
  const result = formatDryRun(makeMultipartPost());

  it("curl uses -F for each part", () => {
    expect(result.snippets.curl).toContain("-F 'file=@/path/to/ride.fit'");
    expect(result.snippets.curl).toContain("-F 'data_type=fit'");
  });

  it("TypeScript uses FormData", () => {
    expect(result.snippets.typescript).toContain("new FormData()");
    expect(result.snippets.typescript).toContain('fd.append("file"');
    expect(result.snippets.typescript).toContain('fd.append("data_type"');
  });

  it("Python uses both files= and data=", () => {
    expect(result.snippets.python).toContain("files=files");
    expect(result.snippets.python).toContain("data=data");
    expect(result.snippets.python).toContain('open("/path/to/ride.fit"');
  });
});

describe("formatDryRun notes", () => {
  it("notes array is non-empty", () => {
    const result = formatDryRun(makeGet());
    expect(Array.isArray(result.notes)).toBe(true);
    expect(result.notes.length).toBeGreaterThan(0);
  });
});

describe("formatDryRun curl quote escaping", () => {
  it("escapes single quotes in header values", () => {
    const req: BuiltRequest = {
      method: "GET",
      url: "https://www.strava.com/api/v3/athlete",
      headers: { ...baseHeaders, "X-Custom": "it's fine" },
    };
    const result = formatDryRun(req);
    expect(result.snippets.curl).toContain("'\\''");
    expect(result.snippets.curl).not.toMatch(/X-Custom: it's fine'/);
  });

  it("escapes single quotes in json body values", () => {
    const value = { note: "it's a ride" };
    const req: BuiltRequest = {
      method: "POST",
      url: "https://www.strava.com/api/v3/activities",
      headers: { ...baseHeaders, "Content-Type": "application/json" },
      body: { kind: "json", value, serialized: JSON.stringify(value) },
    };
    const result = formatDryRun(req);
    expect(result.snippets.curl).toContain("'\\''");
  });
});
