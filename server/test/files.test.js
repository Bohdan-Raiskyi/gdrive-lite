const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer, stopTestServer } = require("./helpers");

let ctx, token;

async function registerAndLogin(username) {
  await fetch(`${ctx.baseUrl}/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "secret1" })
  });
  const res = await fetch(`${ctx.baseUrl}/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "secret1" })
  });
  return (await res.json()).token;
}

function makeFile(name, content) {
  const form = new FormData();
  form.append("file", new Blob([content], { type: "text/plain" }), name);
  return form;
}

before(async () => {
  ctx = await startTestServer();
  token = await registerAndLogin("bob");
});
after(async () => { await stopTestServer(ctx); });

function authHeaders() { return { Authorization: `Bearer ${token}` }; }

test("завантаження зберігає коректні метадані і вміст", async () => {
  const res = await fetch(`${ctx.baseUrl}/files`, {
    method: "POST", headers: authHeaders(), body: makeFile("a.py", "print(1)")
  });
  assert.equal(res.status, 201);
  const file = await res.json();
  assert.equal(file.extension, "py");
  assert.ok(file.uploaded_by); // POST /files не робить JOIN, тому тут лише id, без імені

  // Читабельне ім'я (uploaded_by_name) повертає лише GET /files, де є JOIN із users
  const list = await (await fetch(`${ctx.baseUrl}/files`, { headers: authHeaders() })).json();
  const sameFile = list.find((f) => f.id === file.id);
  assert.equal(sameFile.uploaded_by_name, "bob");

  const content = await fetch(`${ctx.baseUrl}/files/${file.id}/content`, { headers: authHeaders() });
  assert.equal(await content.text(), "print(1)");
});

test("файл з іменем, що вже існує у просторі, -> 409", async () => {
  const res = await fetch(`${ctx.baseUrl}/files`, {
    method: "POST", headers: authHeaders(), body: makeFile("a.py", "інший вміст")
  });
  assert.equal(res.status, 409);
  assert.ok((await res.json()).existingId);
});

test("фільтр за типом повертає лише файли цього розширення", async () => {
  await fetch(`${ctx.baseUrl}/files`, {
    method: "POST", headers: authHeaders(), body: makeFile("photo.jpg", "img")
  });
  const onlyJpg = await (await fetch(`${ctx.baseUrl}/files?filterType=jpg`, { headers: authHeaders() })).json();
  assert.ok(onlyJpg.length > 0);
  assert.ok(onlyJpg.every((f) => f.extension === "jpg"));
});

test("видалення прибирає файл зі списку і з диска", async () => {
  const uploadRes = await fetch(`${ctx.baseUrl}/files`, {
    method: "POST", headers: authHeaders(), body: makeFile("temp.py", "x")
  });
  const file = await uploadRes.json();
  const del = await fetch(`${ctx.baseUrl}/files/${file.id}`, { method: "DELETE", headers: authHeaders() });
  assert.equal(del.status, 204);

  const after = await fetch(`${ctx.baseUrl}/files/${file.id}/content`, { headers: authHeaders() });
  assert.equal(after.status, 404);
});

test("сортування за іменем того, хто завантажив, враховує напрямок (індивідуальна операція)", async () => {
  const carlToken = await registerAndLogin("carl");
  await fetch(`${ctx.baseUrl}/shares/members`, {
    method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ username: "carl", role: "edit" })
  });
  const bobId = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub;

  await fetch(`${ctx.baseUrl}/files?spaceId=${bobId}`, {
    method: "POST", headers: { Authorization: `Bearer ${carlToken}` }, body: makeFile("carl-file.py", "x")
  });

  const asc = await (await fetch(`${ctx.baseUrl}/files?filterType=py&sortDir=asc`, { headers: authHeaders() })).json();
  const names = asc.map((f) => f.uploaded_by_name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));

  const desc = await (await fetch(`${ctx.baseUrl}/files?filterType=py&sortDir=desc`, { headers: authHeaders() })).json();
  assert.deepEqual(desc.map((f) => f.uploaded_by_name), [...names].sort((a, b) => a.localeCompare(b)).reverse());
});