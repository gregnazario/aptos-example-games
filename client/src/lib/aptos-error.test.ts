import { describe, expect, test } from "vitest";
import { isMissingGameError } from "./aptos-error";

function apiError(data: Record<string, unknown>, message = "request failed") {
  return Object.assign(new Error(message), { data, status: 400 });
}

describe("isMissingGameError", () => {
  test("treats EGAME_NOT_FOUND vm abort 8 as missing", () => {
    expect(
      isMissingGameError(apiError({ vm_error_code: 8, message: "Move abort" })),
    ).toBe(true);
  });

  test("treats ESTORE_NOT_FOUND vm abort 13 as missing", () => {
    expect(
      isMissingGameError(apiError({ vm_error_code: 13, message: "Move abort" })),
    ).toBe(true);
  });

  test("treats named abort strings as missing", () => {
    expect(
      isMissingGameError(
        apiError({ message: "Move abort EGAME_NOT_FOUND in tic_tac_toe" }),
      ),
    ).toBe(true);
    expect(
      isMissingGameError(apiError({ message: "ESTORE_NOT_FOUND" })),
    ).toBe(true);
  });

  test("treats abort code text for 8 and 13 as missing", () => {
    expect(
      isMissingGameError(
        apiError({
          error_code: "invalid_input",
          message: "Move abort. Location: 0xabc::tic_tac_toe, Abort code: 8",
        }),
      ),
    ).toBe(true);
    expect(
      isMissingGameError(
        apiError({ message: "Move abort in 0xabc::tic_tac_toe: 13" }),
      ),
    ).toBe(true);
  });

  test("treats resource and table misses as missing", () => {
    expect(
      isMissingGameError(apiError({ error_code: "resource_not_found" })),
    ).toBe(true);
    expect(
      isMissingGameError(apiError({ error_code: "table_item_not_found" })),
    ).toBe(true);
  });

  test("does not treat a missing published module as a missing game", () => {
    expect(
      isMissingGameError(
        apiError({
          error_code: "module_not_found",
          message: "Module tic_tac_toe not found",
        }),
      ),
    ).toBe(false);
  });

  test("does not treat account_not_found as a missing game", () => {
    expect(
      isMissingGameError(apiError({ error_code: "account_not_found" })),
    ).toBe(false);
  });

  test("does not treat transport failures as missing", () => {
    expect(isMissingGameError(new Error("fetch failed"))).toBe(false);
    expect(isMissingGameError(apiError({ error_code: "internal_error" }))).toBe(
      false,
    );
    expect(isMissingGameError({ status: 429, message: "rate limited" })).toBe(
      false,
    );
    expect(isMissingGameError({ status: 404, message: "not found" })).toBe(
      false,
    );
  });

  test("does not treat abort code 18 as missing", () => {
    expect(
      isMissingGameError(
        apiError({ message: "Move abort. Abort code: 18" }),
      ),
    ).toBe(false);
  });
});
