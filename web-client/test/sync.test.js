import { test } from "node:test";
import assert from "node:assert/strict";
import { safeLocalName } from "../src/sync.js";

test("safeLocalName: замінює символи, заборонені у Windows", () => {
  assert.equal(safeLocalName('a:b?c"d<e>f|g.py'), "a_b_c_d_e_f_g.py");
});

test("safeLocalName: не чіпає кирилицю", () => {
  assert.equal(safeLocalName("Привіт, світ.py"), "Привіт, світ.py");
});