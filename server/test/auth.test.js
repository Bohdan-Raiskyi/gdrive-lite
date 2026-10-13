const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer, stopTestServer } = require("./helpers");

let ctx;
before(async () => { ctx = await startTestServer(); });
after(async () => { await stopTestServer(ctx); });

function api(path, options = {}) {
  return fetch(`${ctx.baseUrl}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
}

test("реєстрація створює користувача", async () => {
  const res = await api("/auth/register", {
    method: "POST", body: JSON.stringify({ username: "alice", password: "secret1" })
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.username, "alice");
  assert.ok(body.id);
});

test("повторна реєстрація того самого логіну -> 409", async () => {
  const res = await api("/auth/register", {
    method: "POST", body: JSON.stringify({ username: "alice", password: "secret1" })
  });
  assert.equal(res.status, 409);
});

test("вхід з правильним паролем дає робочий JWT", async () => {
  const res = await api("/auth/login", {
    method: "POST", body: JSON.stringify({ username: "alice", password: "secret1" })
  });
  assert.equal(res.status, 200);
  const { token } = await res.json();
  assert.ok(token);

  const me = await api("/whoami", { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(me.status, 200);
});

test("вхід з неправильним паролем -> 401", async () => {
  const res = await api("/auth/login", {
    method: "POST", body: JSON.stringify({ username: "alice", password: "wrong" })
  });
  assert.equal(res.status, 401);
});

test("захищений маршрут без токена -> 401", async () => {
  const res = await api("/files");
  assert.equal(res.status, 401);
});