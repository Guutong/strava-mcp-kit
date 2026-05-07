import { describe, expect, it } from "vitest";
import { describeOperation, listOperationIds } from "../src/spec.js";

describe("describeOperation getActivityById", () => {
  const op = describeOperation("getActivityById");

  it("returns a non-null description", () => {
    expect(op).not.toBeNull();
  });

  it("uses GET method on /activities/{id}", () => {
    expect(op?.method).toBe("GET");
    expect(op?.path).toBe("/activities/{id}");
  });

  it("includes id and include_all_efforts parameters", () => {
    expect(op?.parameters.length ?? 0).toBeGreaterThanOrEqual(2);
    const names = (op?.parameters ?? []).map((p) => p.name);
    expect(names).toContain("id");
    expect(names).toContain("include_all_efforts");
  });
});

describe("describeOperation exploreSegments", () => {
  const op = describeOperation("exploreSegments");

  it("is non-null", () => {
    expect(op).not.toBeNull();
  });

  it("declares an enum on activity_type", () => {
    const activityType = op?.parameters.find((p) => p.name === "activity_type");
    expect(activityType).toBeDefined();
    expect(Array.isArray(activityType?.enum)).toBe(true);
    expect((activityType?.enum ?? []).length).toBeGreaterThan(0);
  });
});

describe("describeOperation createActivity", () => {
  const op = describeOperation("createActivity");

  it("uses POST method", () => {
    expect(op?.method).toBe("POST");
  });

  it("has at least one formData parameter", () => {
    const formDataParams = (op?.parameters ?? []).filter((p) => p.in === "formData");
    expect(formDataParams.length).toBeGreaterThan(0);
  });
});

describe("describeOperation unknown id", () => {
  it("returns null for an unrecognized operationId", () => {
    expect(describeOperation("nope")).toBeNull();
  });
});

describe("listOperationIds", () => {
  const ids = listOperationIds();

  it("returns at least 30 ids", () => {
    expect(ids.length).toBeGreaterThanOrEqual(30);
  });

  it("includes getLoggedInAthlete", () => {
    expect(ids).toContain("getLoggedInAthlete");
  });
});

describe("describeOperation recommendedScopes", () => {
  it("is a non-empty array of strings", () => {
    const op = describeOperation("getLoggedInAthlete");
    expect(op).not.toBeNull();
    expect(Array.isArray(op?.recommendedScopes)).toBe(true);
    expect((op?.recommendedScopes ?? []).length).toBeGreaterThan(0);
    for (const s of op?.recommendedScopes ?? []) {
      expect(typeof s).toBe("string");
      expect(s.length).toBeGreaterThan(0);
    }
  });
});
