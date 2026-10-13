import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, stopTestServer } from "../../server/test/helpers.js";
import { register, login, listFiles, uploadFile, uploadOrReplace, addMember, getCurrentUserId } from "../src/api.js";

// У Node немає глобального localStorage - підміняємо простим сховищем лише для тестів
globalThis.localStorage = {
  _data: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null; },
  setItem(k, v) { this._data[k] = String(v); },
  removeItem(k) { delete this._data[k]; }
};

let ctx;

before(async () => {
  ctx = await startTestServer();
  // api.js звертається на жорстко заданий http://localhost:3000 - переадресовуємо
  // на реальний тестовий сервер, не змінюючи сам api.js
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, options) =>
    realFetch(url.toString().replace("http://localhost:3000", ctx.baseUrl), options);
});
after(async () => { await stopTestServer(ctx); });

test("сортування за іменем того, хто завантажив (індивідуальна операція за варіантом)", async () => {
  await register("desk_a", "secret1");
  await register("desk_b", "secret1");

  await login("desk_a", "secret1");
  const spaceId = getCurrentUserId();
  await uploadFile(new File(["x"], "a-file.py"), spaceId);
  await addMember("desk_b", "edit");

  await login("desk_b", "secret1");
  await uploadFile(new File(["y"], "b-file.py"), spaceId);

  await login("desk_a", "secret1");
  const asc = await listFiles({ sortDir: "asc", filterType: "py" });
  const desc = await listFiles({ sortDir: "desc", filterType: "py" });

  assert.deepEqual(asc.map((f) => f.uploaded_by_name), ["desk_a", "desk_b"]);
  assert.deepEqual(desc.map((f) => f.uploaded_by_name), ["desk_b", "desk_a"]);
});

test("uploadOrReplace: підтвердження заміни оновлює той самий файл, а не створює новий", async () => {
  await register("desk_dup", "secret1");
  await login("desk_dup", "secret1");

  const first = await uploadFile(new File(["старий"], "note.py"), getCurrentUserId());
  const replaced = await uploadOrReplace(new File(["новий"], "note.py"), () => true, getCurrentUserId());

  assert.equal(replaced.id, first.id);
  const files = await listFiles({ filterType: "py" });
  assert.equal(files.filter((f) => f.name === "note.py").length, 1);
});