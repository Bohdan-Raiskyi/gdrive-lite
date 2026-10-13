const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer, stopTestServer } = require("./helpers");

let ctx, ownerToken, ownerId, readerToken, fileId;

async function register(username) {
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

before(async () => {
  ctx = await startTestServer();
  ownerToken = await register("owner1");
  readerToken = await register("reader1");
  ownerId = JSON.parse(Buffer.from(ownerToken.split(".")[1], "base64url").toString()).sub;

  const form = new FormData();
  form.append("file", new Blob(["x"]), "secret.py");
  const res = await fetch(`${ctx.baseUrl}/files`, {
    method: "POST", headers: { Authorization: `Bearer ${ownerToken}` }, body: form
  });
  fileId = (await res.json()).id;
});
after(async () => { await stopTestServer(ctx); });

test("без доступу — файл не видно, 404", async () => {
  const res = await fetch(`${ctx.baseUrl}/files/${fileId}/content`, {
    headers: { Authorization: `Bearer ${readerToken}` }
  });
  assert.equal(res.status, 404);
});

test("роль read: файл видно, видалити й завантажити не можна", async () => {
  await fetch(`${ctx.baseUrl}/shares/members`, {
    method: "POST", headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ username: "reader1", role: "read" })
  });

  const content = await fetch(`${ctx.baseUrl}/files/${fileId}/content`, {
    headers: { Authorization: `Bearer ${readerToken}` }
  });
  assert.equal(content.status, 200);

  const del = await fetch(`${ctx.baseUrl}/files/${fileId}`, {
    method: "DELETE", headers: { Authorization: `Bearer ${readerToken}` }
  });
  assert.equal(del.status, 403);

  const form = new FormData();
  form.append("file", new Blob(["новий"]), "secret.py");
  const upload = await fetch(`${ctx.baseUrl}/files?spaceId=${ownerId}`, {
    method: "POST", headers: { Authorization: `Bearer ${readerToken}` }, body: form
  });
  assert.equal(upload.status, 403);
});

test("після зняття доступу файл знову невидимий", async () => {
  const members = await (await fetch(`${ctx.baseUrl}/shares/members`, {
    headers: { Authorization: `Bearer ${ownerToken}` }
  })).json();
  const shareId = members.find((m) => m.username === "reader1").id;

  await fetch(`${ctx.baseUrl}/shares/${shareId}`, {
    method: "DELETE", headers: { Authorization: `Bearer ${ownerToken}` }
  });

  const res = await fetch(`${ctx.baseUrl}/files/${fileId}/content`, {
    headers: { Authorization: `Bearer ${readerToken}` }
  });
  assert.equal(res.status, 404);
});