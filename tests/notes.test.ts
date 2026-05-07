import { describe, expect, it } from "vitest";
import { describeOperation } from "../src/spec.js";

describe("describeOperation notes", () => {
  it("emits a pagination iteration note for paginated endpoints", () => {
    const op = describeOperation("getLoggedInAthleteActivities");
    expect(op).not.toBeNull();
    expect(op?.notes.some((n) => /iterate page/i.test(n))).toBe(true);
  });

  it("emits a date-format note when the endpoint accepts date params", () => {
    const op = describeOperation("getEffortsBySegmentId");
    expect(op).not.toBeNull();
    expect(op?.notes.some((n) => /ISO 8601/i.test(n))).toBe(true);
  });

  it("emits a multipart note when the endpoint consumes multipart", () => {
    const op = describeOperation("createUpload");
    expect(op).not.toBeNull();
    expect(op?.notes.some((n) => /multipart/i.test(n))).toBe(true);
  });

  it("emits a polyline note for endpoints that return map objects", () => {
    const op = describeOperation("getActivityById");
    expect(op).not.toBeNull();
    expect(op?.notes.some((n) => /Polyline/i.test(n))).toBe(true);
  });

  it("always includes a pointer to strava_api_conventions", () => {
    const op = describeOperation("getLoggedInAthlete");
    expect(op).not.toBeNull();
    expect(op?.notes.some((n) => /strava_api_conventions/i.test(n))).toBe(true);
  });
});

describe("describeOperation parameter resolution", () => {
  it("resolves $ref pagination parameters from spec.parameters", () => {
    const op = describeOperation("getLoggedInAthleteActivities");
    const names = (op?.parameters ?? []).map((p) => p.name).sort();
    expect(names).toContain("page");
    expect(names).toContain("per_page");
  });
});
