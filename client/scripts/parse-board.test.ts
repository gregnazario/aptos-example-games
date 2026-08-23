import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBoard } from "../src/lib/game";

const XO_EMPTY = ["X", "O", "", "", "", "", "", "", ""] as const;

test("Uint8Array is not a JS array (the original parseBoard miss)", () => {
  assert.equal(Array.isArray(new Uint8Array([1, 2])), false);
});

test("parseBoard reads ts-sdk vector<u8> as Uint8Array", () => {
  assert.deepEqual(parseBoard(new Uint8Array([1, 2, 0, 0, 0, 0, 0, 0, 0])), [
    ...XO_EMPTY,
  ]);
});

test("parseBoard reads a Uint8Array view with a nonzero byteOffset", () => {
  const packed = new Uint8Array([9, 9, 1, 2, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(parseBoard(packed.subarray(2)), [...XO_EMPTY]);
});

test("parseBoard reads ArrayBuffer, number[], and hex strings", () => {
  assert.deepEqual(
    parseBoard(new Uint8Array([1, 2, 0, 0, 0, 0, 0, 0, 0]).buffer),
    [...XO_EMPTY],
  );
  assert.deepEqual(parseBoard([1, 2, 0, 0, 0, 0, 0, 0, 0]), [...XO_EMPTY]);
  assert.deepEqual(parseBoard("0x010200000000000000"), [...XO_EMPTY]);
  assert.deepEqual(parseBoard("010200000000000000"), [...XO_EMPTY]);
});

test("parseBoard returns nine empty cells for unknown input", () => {
  assert.deepEqual(parseBoard(null), Array.from({ length: 9 }, () => ""));
  assert.deepEqual(parseBoard({}), Array.from({ length: 9 }, () => ""));
});
