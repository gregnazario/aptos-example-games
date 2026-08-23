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
  try {
    return AccountAddress.from(value).toString();
  } catch {
    return null;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

export function addressesEqual(left?: string | null, right?: string | null): boolean {
  if (!left || !right) return false;
  try {
    return AccountAddress.from(left).equals(AccountAddress.from(right));
  } catch {
    return left.toLowerCase() === right.toLowerCase();
  }
}
