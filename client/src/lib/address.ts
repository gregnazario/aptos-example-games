import { AccountAddress } from "@aptos-labs/ts-sdk";

export function asAddressString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && "toString" in value) {
    return String(value.toString());
  }
  return String(value);
}

export function parseAccountAddress(value: string): string | null {
  const trimmed = value.trim();
  if (!looksLikeHexAddress(trimmed)) return null;
  try {
    return AccountAddress.from(trimmed, { maxMissingChars: 63 }).toString();
  } catch {
    return null;
  }
}

function looksLikeHexAddress(value: string): boolean {
  if (value.startsWith("0x") || value.startsWith("0X")) {
    return /^0x[0-9a-fA-F]+$/i.test(value);
  }
  return /^[0-9a-fA-F]{64}$/.test(value);
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

export function addressesEqual(left?: string | null, right?: string | null): boolean {
  if (!left || !right) return false;
  try {
    return AccountAddress.from(left, { maxMissingChars: 63 }).equals(
      AccountAddress.from(right, { maxMissingChars: 63 }),
    );
  } catch {
    return left.toLowerCase() === right.toLowerCase();
  }
}
