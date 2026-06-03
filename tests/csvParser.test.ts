/**
 * Unit tests — CSV parsing and validation
 */

import { describe, it, expect } from "vitest";
import { parseOnboardingCsv } from "../src/lib/csvParser";

describe("parseOnboardingCsv", () => {
  it("parses a valid CSV with all required columns", async () => {
    const csv = `name,email,role,cohort_tag
Alice Andela,alice@andela.com,learner,q1-2025
Bob Admin,bob@andela.com,admin,q1-2025`;

    const { valid, errors } = await parseOnboardingCsv(csv);
    expect(errors).toHaveLength(0);
    expect(valid).toHaveLength(2);
    expect(valid[0]).toMatchObject({
      name: "Alice Andela",
      email: "alice@andela.com",
      role: "learner",
      cohort_tag: "q1-2025",
    });
  });

  it("returns an error when required columns are missing", async () => {
    const csv = `name,email\nAlice,alice@example.com`;
    const { valid, errors } = await parseOnboardingCsv(csv);
    expect(valid).toHaveLength(0);
    expect(errors[0].row).toBe(0);
    expect(errors[0].message).toMatch(/Missing required columns/);
  });

  it("rejects invalid email addresses", async () => {
    const csv = `name,email,role,cohort_tag\nAlice,not-an-email,learner,tag1`;
    const { valid, errors } = await parseOnboardingCsv(csv);
    expect(valid).toHaveLength(0);
    expect(errors[0].message).toMatch(/invalid email/);
  });

  it("rejects invalid role values", async () => {
    const csv = `name,email,role,cohort_tag\nAlice,a@b.com,superadmin,tag1`;
    const { valid, errors } = await parseOnboardingCsv(csv);
    expect(valid).toHaveLength(0);
    expect(errors[0].message).toMatch(/role must be/);
  });

  it("rejects rows with missing cohort_tag", async () => {
    const csv = `name,email,role,cohort_tag\nAlice,a@b.com,learner,`;
    const { valid, errors } = await parseOnboardingCsv(csv);
    expect(valid).toHaveLength(0);
    expect(errors[0].message).toMatch(/cohort_tag is required/);
  });

  it("separates valid rows from invalid rows in the same CSV", async () => {
    const csv = `name,email,role,cohort_tag
Good User,good@example.com,learner,cohort-a
Bad User,not-an-email,learner,cohort-a
Another Good,another@example.com,admin,cohort-b`;

    const { valid, errors } = await parseOnboardingCsv(csv);
    expect(valid).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(3); // row 3 (1-indexed + header)
  });

  it("lowercases email and role", async () => {
    const csv = `name,email,role,cohort_tag\nAlice,ALICE@EXAMPLE.COM,LEARNER,tag1`;
    const { valid } = await parseOnboardingCsv(csv);
    expect(valid[0].email).toBe("alice@example.com");
    expect(valid[0].role).toBe("learner");
  });

  it("handles empty CSV body gracefully", async () => {
    const csv = `name,email,role,cohort_tag\n`;
    const { valid, errors } = await parseOnboardingCsv(csv);
    expect(valid).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });
});
