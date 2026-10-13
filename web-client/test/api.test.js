import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, stopTestServer } from "../../server/test/helpers.js";
import {
  register, login, uploadFile, listFiles, listSpaces, addMember, removeShare, listMembers, getCurrentUserId
} from "../src/api.js";

globalThis.localStorage = {
  _data: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null; },
  setItem(k, v) { this._data[k] = String(v); },
  removeItem(k) { delete this._data[k]; }
};

let ctx;

before(async () => {
  ctx = await startTestServer();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, options) =>
    realFetch(url.toString().replace("http://localhost:3000", ctx.baseUrl), options);
});
after(async () => { await stopTestServer(ctx); });

test("спільний доступ: власник надає read, гість бачить файл, після зняття - ні", async () => {
  await register("web_owner", "secret1");
  await register("web_guest", "secret1");

  await login("web_owner", "secret1");
  const ownerId = getCurrentUserId();
  await uploadFile(new File(["дані"], "report.py"), ownerId);
  await addMember("web_guest", "read");

  await login("web_guest", "secret1");
  const spaces = await listSpaces();
  assert.ok(spaces.some((s) => s.owner_id === ownerId && s.role === "read"));
  const visible = await listFiles({ filterType: "py" });
  assert.ok(visible.some((f) => f.name === "report.py"));

  await login("web_owner", "secret1");
  const members = await listMembers();
  await removeShare(members.find((m) => m.username === "web_guest").id);

  await login("web_guest", "secret1");
  const afterRevoke = await listFiles({ filterType: "py" });
  assert.ok(!afterRevoke.some((f) => f.name === "report.py"));
});