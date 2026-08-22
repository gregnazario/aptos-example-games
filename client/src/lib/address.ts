import { AccountAddress } from "@aptos-labs/ts-sdk";

export function asAddressString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && "toString" in value) {
    return String(value.toString());
  }
  return String(value);
}

export function addressesEqual(left?: string | null, right?: string | null): boolean {
  if (!left || !right) return false;
  try {
    return AccountAddress.from(left).equals(AccountAddress.from(right));
  } catch {
    return left.toLowerCase() === right.toLowerCase();
  }
}
