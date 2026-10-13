import { test } from "node:test";
import assert from "node:assert/strict";
import { decideDirection } from "../src/sync.js";

test("decideDirection: змінився лише локальний файл -> upload", () => {
  const base = "hash-common";
  const local = { hash: "hash-new-local", mtimeMs: Date.now() };
  const remote = { content_hash: base, modified_at: new Date(Date.now() - 60000).toISOString() };
  assert.equal(decideDirection(base, local, remote), "upload");
});

test("decideDirection: конфлікт вирішується на користь новішої версії", () => {
  const local = { hash: "hash-A", mtimeMs: Date.now() - 60000 };
  const remote = { content_hash: "hash-B", modified_at: new Date().toISOString() };
  assert.equal(decideDirection(undefined, local, remote), "download");
});