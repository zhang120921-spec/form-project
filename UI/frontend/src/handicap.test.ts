import { describe, it, expect } from "vitest";
import { parseHandicap, formatHandicap } from "./lib/handicap";

describe("parseHandicap", () => {
  it("returns null for empty string", () => {
    expect(parseHandicap("").value).toBeNull();
    expect(parseHandicap("  ").value).toBeNull();
  });

  it("parses a plain positive number", () => {
    const r = parseHandicap("12.4");
    expect(r.ok).toBe(true);
    expect(r.value).toBe(12.4);
  });

  it("parses a negative number with leading minus", () => {
    const r = parseHandicap("-2");
    expect(r.ok).toBe(true);
    expect(r.value).toBe(-2);
  });

  it("treats + prefix as better-than-scratch (negate)", () => {
    const r = parseHandicap("+2");
    expect(r.ok).toBe(true);
    expect(r.value).toBe(-2);
  });

  it("treats +1.3 as -1.3", () => {
    const r = parseHandicap("+1.3");
    expect(r.ok).toBe(true);
    expect(r.value).toBe(-1.3);
  });

  it("accepts +0 as 0 (scratch)", () => {
    const r = parseHandicap("+0");
    expect(r.ok).toBe(true);
    expect(r.value).toBe(0);
  });

  it("rejects non-numeric input", () => {
    const r = parseHandicap("abc");
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it("rejects + with no number after it", () => {
    const r = parseHandicap("+");
    expect(r.ok).toBe(false);
  });

  it("rejects values below -10.0", () => {
    const r = parseHandicap("+10.1");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("-10");
  });

  it("rejects values above 54.0", () => {
    const r = parseHandicap("54.1");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("54");
  });

  it("accepts boundary values -10.0 and 54.0", () => {
    expect(parseHandicap("+10").ok).toBe(true);
    expect(parseHandicap("54").ok).toBe(true);
  });
});

describe("formatHandicap", () => {
  it("formats negative as plus-handicap", () => {
    expect(formatHandicap(-2)).toBe("+2.0");
    expect(formatHandicap(-1.3)).toBe("+1.3");
  });

  it("formats positive normally", () => {
    expect(formatHandicap(12.4)).toBe("12.4");
    expect(formatHandicap(0)).toBe("0.0");
  });

  it("returns dash for null/undefined", () => {
    expect(formatHandicap(null)).toBe("—");
    expect(formatHandicap(undefined)).toBe("—");
  });
});
