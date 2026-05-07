import type { BuiltRequest } from "./client.js";

export interface DryRunResult {
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: unknown;
  };
  snippets: {
    curl: string;
    typescript: string;
    python: string;
  };
  notes: string[];
}

export function formatDryRun(req: BuiltRequest): DryRunResult {
  const bodyForDisplay = describeBody(req);
  return {
    request: {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: bodyForDisplay,
    },
    snippets: {
      curl: toCurl(req),
      typescript: toTypeScript(req),
      python: toPython(req),
    },
    notes: [
      "Authorization header uses a placeholder. Replace <STRAVA_ACCESS_TOKEN> with a real bearer token.",
      "For multipart bodies, the snippets show a structural sketch — substitute real file handles in your code.",
    ],
  };
}

function describeBody(req: BuiltRequest): unknown {
  if (!req.body) return undefined;
  if (req.body.kind === "json") return req.body.value;
  if (req.body.kind === "form") return req.body.value;
  return req.body.parts.map((p) => ({
    name: p.name,
    type: p.isFile ? "file" : "field",
    value: p.value,
  }));
}

function toCurl(req: BuiltRequest): string {
  const lines: string[] = [`curl -X ${req.method} '${req.url}' \\`];
  for (const [k, v] of Object.entries(req.headers)) {
    lines.push(`  -H '${k}: ${escapeSingleQuote(v)}' \\`);
  }
  if (req.body?.kind === "json") {
    lines.push(`  -d '${escapeSingleQuote(req.body.serialized)}'`);
  } else if (req.body?.kind === "form") {
    for (const [k, v] of Object.entries(req.body.value)) {
      lines.push(`  --data-urlencode '${k}=${escapeSingleQuote(v)}' \\`);
    }
    return trimTrailingBackslash(lines);
  } else if (req.body?.kind === "multipart") {
    for (const p of req.body.parts) {
      if (p.isFile) {
        lines.push(`  -F '${p.name}=@/path/to/${p.filename ?? "file"}' \\`);
      } else {
        lines.push(`  -F '${p.name}=${escapeSingleQuote(p.value)}' \\`);
      }
    }
    return trimTrailingBackslash(lines);
  }
  return trimTrailingBackslash(lines);
}

function toTypeScript(req: BuiltRequest): string {
  const init: string[] = [`  method: "${req.method}",`];
  init.push("  headers: {");
  for (const [k, v] of Object.entries(req.headers)) {
    init.push(`    "${k}": ${JSON.stringify(v)},`);
  }
  init.push("  },");

  if (req.body?.kind === "json") {
    init.push(
      `  body: JSON.stringify(${JSON.stringify(req.body.value, null, 2).replace(/\n/g, "\n  ")}),`,
    );
  } else if (req.body?.kind === "form") {
    init.push(
      `  body: new URLSearchParams(${JSON.stringify(req.body.value, null, 2).replace(/\n/g, "\n  ")}).toString(),`,
    );
  } else if (req.body?.kind === "multipart") {
    init.push("  body: (() => {");
    init.push("    const fd = new FormData();");
    for (const p of req.body.parts) {
      if (p.isFile) {
        init.push(
          `    fd.append(${JSON.stringify(p.name)}, /* Blob or File */ blob, ${JSON.stringify(p.filename ?? "file")});`,
        );
      } else {
        init.push(`    fd.append(${JSON.stringify(p.name)}, ${JSON.stringify(p.value)});`);
      }
    }
    init.push("    return fd;");
    init.push("  })(),");
  }

  return [
    `const res = await fetch(${JSON.stringify(req.url)}, {`,
    ...init,
    "});",
    "const data = await res.json();",
  ].join("\n");
}

function toPython(req: BuiltRequest): string {
  const lines: string[] = ["import requests", ""];
  lines.push(`url = ${JSON.stringify(req.url)}`);
  lines.push(`headers = ${pyDict(req.headers)}`);

  if (req.body?.kind === "json") {
    lines.push(`json_body = ${pyValue(req.body.value)}`);
    lines.push(
      `res = requests.request(${JSON.stringify(req.method)}, url, headers=headers, json=json_body)`,
    );
  } else if (req.body?.kind === "form") {
    lines.push(`data = ${pyDict(req.body.value)}`);
    lines.push(
      `res = requests.request(${JSON.stringify(req.method)}, url, headers=headers, data=data)`,
    );
  } else if (req.body?.kind === "multipart") {
    const fields: string[] = [];
    const files: string[] = [];
    for (const p of req.body.parts) {
      if (p.isFile) {
        files.push(
          `    ${JSON.stringify(p.name)}: open(${JSON.stringify(`/path/to/${p.filename ?? "file"}`)}, "rb")`,
        );
      } else {
        fields.push(`    ${JSON.stringify(p.name)}: ${JSON.stringify(p.value)}`);
      }
    }
    if (fields.length) lines.push(`data = {\n${fields.join(",\n")},\n}`);
    if (files.length) lines.push(`files = {\n${files.join(",\n")},\n}`);
    const args = ["url", "headers=headers"];
    if (fields.length) args.push("data=data");
    if (files.length) args.push("files=files");
    lines.push(`res = requests.request(${JSON.stringify(req.method)}, ${args.join(", ")})`);
  } else {
    lines.push(`res = requests.request(${JSON.stringify(req.method)}, url, headers=headers)`);
  }

  lines.push("res.raise_for_status()");
  lines.push("data = res.json()");
  return lines.join("\n");
}

function pyDict(obj: Record<string, string>): string {
  const entries = Object.entries(obj).map(
    ([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`,
  );
  return `{\n${entries.join(",\n")},\n}`;
}

function pyValue(value: unknown): string {
  // JSON is a valid Python literal subset for primitives + dicts + lists.
  return JSON.stringify(value, null, 4)
    .replace(/\btrue\b/g, "True")
    .replace(/\bfalse\b/g, "False")
    .replace(/\bnull\b/g, "None");
}

function escapeSingleQuote(s: string): string {
  return s.replace(/'/g, "'\\''");
}

function trimTrailingBackslash(lines: string[]): string {
  if (lines.length === 0) return "";
  const last = lines[lines.length - 1] ?? "";
  lines[lines.length - 1] = last.replace(/\s*\\$/, "");
  return lines.join("\n");
}
