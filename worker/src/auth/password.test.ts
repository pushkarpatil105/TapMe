
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password";

const TEST_PEPPER =
  "tapme-test-pepper-32-bytes-minimum-123456789";

describe("Password security", () => {
  it("should generate a password hash", async () => {
    const hash = await hashPassword(
      "TapMeStrongPassword123!",
      TEST_PEPPER
    );

    expect(hash).toContain("pbkdf2$sha256$100000$");
    expect(hash).not.toContain("TapMeStrongPassword123!");
  });

  it("should verify the correct password", async () => {
    const password = "TapMeStrongPassword123!";
    const hash = await hashPassword(password, TEST_PEPPER);

    expect(
      await verifyPassword(password, hash, TEST_PEPPER)
    ).toBe(true);
  });

  it("should reject an incorrect password", async () => {
    const hash = await hashPassword(
      "TapMeStrongPassword123!",
      TEST_PEPPER
    );

    expect(
      await verifyPassword("WrongPassword123!", hash, TEST_PEPPER)
    ).toBe(false);
  });

  it("should reject a malformed hash", async () => {
    expect(
      await verifyPassword("SomePassword123!", "invalid-hash", TEST_PEPPER)
    ).toBe(false);
  });

  it("should reject passwords shorter than 12 characters", async () => {
    await expect(
      hashPassword("short", TEST_PEPPER)
    ).rejects.toThrow("Password must contain at least 12 characters.");
  });

  it("should reject hashes created with a different pepper", async () => {
    const password = "TapMeStrongPassword123!";
    const hash = await hashPassword(password, TEST_PEPPER);

    expect(
      await verifyPassword(password, hash, "another-test-pepper-32-bytes-long")
    ).toBe(false);
  });
});
    