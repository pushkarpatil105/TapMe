import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getPepper } from "./create-admin";

describe("create-admin getPepper security isolation", () => {
  const originalEnvPepper = process.env.PASSWORD_PEPPER;

  beforeEach(() => {
    delete (process.env as Record<string, string | undefined>).PASSWORD_PEPPER;
  });

  afterEach(() => {
    if (originalEnvPepper !== undefined) {
      process.env.PASSWORD_PEPPER = originalEnvPepper;
    } else {
      delete (process.env as Record<string, string | undefined>).PASSWORD_PEPPER;
    }
  });

  it("strictly refuses to read .dev.vars when targeting remote D1 (isRemote = true)", () => {
    const mockDevVarsReader = vi.fn().mockReturnValue(
      "PASSWORD_PEPPER=local-secret-in-dev-vars-32-chars-long\n"
    );

    const pepper = getPepper(true, mockDevVarsReader);

    expect(pepper).toBe("");
    // Strictly verify that the local devVars reader was NEVER invoked in remote mode
    expect(mockDevVarsReader).not.toHaveBeenCalled();
  });

  it("accepts process.env.PASSWORD_PEPPER when targeting remote D1 (isRemote = true)", () => {
    const validPepper = "a-very-secure-production-pepper-32-chars-long";
    process.env.PASSWORD_PEPPER = validPepper;

    const mockDevVarsReader = vi.fn();
    const pepper = getPepper(true, mockDevVarsReader);

    expect(pepper).toBe(validPepper);
    expect(mockDevVarsReader).not.toHaveBeenCalled();
  });

  it("rejects process.env.PASSWORD_PEPPER if shorter than 32 characters in remote mode", () => {
    process.env.PASSWORD_PEPPER = "too-short";
    const mockDevVarsReader = vi.fn();
    const pepper = getPepper(true, mockDevVarsReader);

    expect(pepper).toBe("");
    expect(mockDevVarsReader).not.toHaveBeenCalled();
  });

  it("reads .dev.vars in local development mode (isRemote = false) if env var is unset", () => {
    const testDevPepper = "a-local-dev-test-pepper-minimum-32-chars-long";
    const mockDevVarsReader = vi.fn().mockReturnValue(
      `PASSWORD_PEPPER=${testDevPepper}\n`
    );

    const pepper = getPepper(false, mockDevVarsReader);
    expect(mockDevVarsReader).toHaveBeenCalledTimes(1);
    expect(pepper).toBe(testDevPepper);
  });

  it("prefers process.env.PASSWORD_PEPPER over .dev.vars in local development mode", () => {
    const customPepper = "custom-override-pepper-for-local-testing-32";
    process.env.PASSWORD_PEPPER = customPepper;

    const mockDevVarsReader = vi.fn();
    const pepper = getPepper(false, mockDevVarsReader);

    expect(pepper).toBe(customPepper);
    // When process.env is present, it shouldn't invoke the devVarsReader
    expect(mockDevVarsReader).not.toHaveBeenCalled();
  });
});
