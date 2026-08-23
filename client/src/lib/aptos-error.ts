import { errorMessage } from "./address";

export function aptosErrorPayload(error: unknown): {
  errorCode?: string;
  vmErrorCode?: number;
  message: string;
} {
  if (!error || typeof error !== "object") {
    return { message: errorMessage(error) };
  }
  const err = error as {
    data?: {
      error_code?: string;
      message?: string;
      vm_error_code?: number;
    };
    message?: string;
  };
  return {
    errorCode: err.data?.error_code,
    vmErrorCode: err.data?.vm_error_code,
    message: `${err.data?.message ?? ""} ${err.message ?? ""}`,
  };
}

/** Move abort codes from tic-tac-toe.move: EGAME_NOT_FOUND=8, ESTORE_NOT_FOUND=13. */
const MISSING_GAME_ABORT_CODES = new Set([8, 13]);

export function isMissingGameError(error: unknown): boolean {
  const { errorCode, vmErrorCode, message } = aptosErrorPayload(error);
  if (vmErrorCode != null && MISSING_GAME_ABORT_CODES.has(Number(vmErrorCode))) {
    return true;
  }
  if (
    errorCode === "resource_not_found" ||
    errorCode === "table_item_not_found"
  ) {
    return true;
  }
  const text = message.toLowerCase();
  if (
    text.includes("egame_not_found") ||
    text.includes("estore_not_found") ||
    text.includes("game not found") ||
    text.includes("store not found")
  ) {
    return true;
  }
  return (
    /\babort code[:\s]+(?:0x)?(?:8|13|d)\b/.test(text) ||
    /tic_tac_toe[:\s]+(?:0x)?(?:8|13|d)\b/.test(text)
  );
}
