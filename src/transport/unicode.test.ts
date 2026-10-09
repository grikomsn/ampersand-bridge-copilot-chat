import assert from "node:assert/strict";
import test from "node:test";
import { joinTextParts, stringifyWellFormedJson } from "./unicode";

test("preserves split emoji and ordinary newlines between text parts", () => {
  assert.equal(joinTextParts(["status \uD83D", "\uDFE2", "ready"]), "status 🟢\nready");
  assert.equal(joinTextParts(["first\nline", "second"]), "first\nline\nsecond");
  assert.equal(joinTextParts(["\uD800", "broken\uDC00"]), "�\nbroken�");
});

test("normalizes nested JSON strings and schema keys without altering valid emoji", () => {
  const encoded = stringifyWellFormedJson({ "\uD800": { values: ["🟢", "\uDC00"] } });
  assert.deepEqual(JSON.parse(encoded), { "�": { values: ["🟢", "�"] } });
});
