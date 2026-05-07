import { describe, expect, it } from "vitest";
import { StravaClient } from "../src/client.js";

const PLACEHOLDER = "<STRAVA_ACCESS_TOKEN>";

describe("StravaClient.buildRequest", () => {
  it("uses placeholder bearer token in Authorization header", () => {
    const client = new StravaClient({});
    const built = client.buildRequest("/athlete");

    expect(built.headers.Authorization).toBe(`Bearer ${PLACEHOLDER}`);
    expect(built.headers.Accept).toBe("application/json");
    expect(built.method).toBe("GET");
  });

  it("appends scalar query params to URL", () => {
    const client = new StravaClient({});
    const built = client.buildRequest("/activities", {
      query: { page: 2, per_page: 30 },
    });

    expect(built.url).toContain("page=2");
    expect(built.url).toContain("per_page=30");
  });

  it("joins array query values as csv", () => {
    const client = new StravaClient({});
    const built = client.buildRequest("/activities/123/streams", {
      query: { keys: ["heartrate", "watts", "cadence"] },
    });

    expect(built.url).toContain("keys=heartrate%2Cwatts%2Ccadence");
  });

  it("skips undefined and null query values", () => {
    const client = new StravaClient({});
    const built = client.buildRequest("/activities", {
      query: { page: 1, before: undefined, after: null },
    });

    expect(built.url).toContain("page=1");
    expect(built.url).not.toContain("before");
    expect(built.url).not.toContain("after");
  });

  it("sets json content-type and serializes value for json bodies", () => {
    const client = new StravaClient({});
    const built = client.buildRequest("/activities", {
      method: "POST",
      json: { name: "Morning Ride", distance: 12000 },
    });

    expect(built.headers["Content-Type"]).toBe("application/json");
    expect(built.body?.kind).toBe("json");
    if (built.body?.kind !== "json") throw new Error("expected json body");
    expect(built.body.serialized).toBe(JSON.stringify({ name: "Morning Ride", distance: 12000 }));
    expect(built.body.value).toEqual({ name: "Morning Ride", distance: 12000 });
  });

  it("produces URLSearchParams-style serialization for form bodies", () => {
    const client = new StravaClient({});
    const built = client.buildRequest("/activities", {
      method: "POST",
      form: { name: "Run", trainer: 1, skip_me: undefined },
    });

    expect(built.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    if (built.body?.kind !== "form") throw new Error("expected form body");
    expect(built.body.value).toEqual({ name: "Run", trainer: "1" });
    expect(built.body.serialized).toContain("name=Run");
    expect(built.body.serialized).toContain("trainer=1");
    expect(built.body.serialized).not.toContain("skip_me");
  });

  it("preserves filename and detects Blob in multipart parts", () => {
    const client = new StravaClient({});
    const fileBlob = new Blob(["fakebytes"], { type: "application/octet-stream" });
    const built = client.buildRequest("/uploads", {
      method: "POST",
      multipart: [
        { name: "file", value: fileBlob, filename: "ride.fit" },
        { name: "data_type", value: "fit" },
      ],
    });

    expect(built.headers["Content-Type"]).toBe("multipart/form-data");
    if (built.body?.kind !== "multipart") throw new Error("expected multipart body");
    expect(built.body.parts).toHaveLength(2);

    const filePart = built.body.parts[0];
    if (!filePart) throw new Error("expected file part");
    expect(filePart.name).toBe("file");
    expect(filePart.isFile).toBe(true);
    expect(filePart.filename).toBe("ride.fit");
    expect(filePart.value).toContain("ride.fit");

    const fieldPart = built.body.parts[1];
    if (!fieldPart) throw new Error("expected field part");
    expect(fieldPart.name).toBe("data_type");
    expect(fieldPart.isFile).toBe(false);
    expect(fieldPart.value).toBe("fit");
  });
});

describe("StravaClient credentials", () => {
  it("does not throw when constructed with no credentials", () => {
    expect(() => new StravaClient({})).not.toThrow();
  });

  it("hasCredentials returns false when no creds provided", () => {
    const client = new StravaClient({});
    expect(client.hasCredentials()).toBe(false);
  });

  it("hasCredentials returns true when access token provided", () => {
    const client = new StravaClient({ accessToken: "tok-123" });
    expect(client.hasCredentials()).toBe(true);
  });
});

describe("StravaClient.request", () => {
  it("throws a credentials-missing error mentioning dry_run", async () => {
    const client = new StravaClient({});
    await expect(client.request("/athlete")).rejects.toThrow(/credentials missing/i);
    await expect(client.request("/athlete")).rejects.toThrow(/dry_run/);
  });
});
