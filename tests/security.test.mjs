import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { TeletextTerminal } from "../js/core/teletext.js";

function makeInputTarget() {
  const term = Object.create(TeletextTerminal.prototype);
  term._keyQueue = [];
  term._keyWaiters = [];
  term._maxKeyQueue = 64;
  term._fastForward = false;
  term._fastForwardAnyKey = false;
  term._fastForwardMs = 1200;
  term._fastForwardUntil = 0;
  return term;
}

test("keyboard input queue remains bounded", () => {
  const term = makeInputTarget();

  for (let i = 0; i < 1000; i += 1) {
    term._pushKey({ type: "char", ch: String(i % 10) });
  }

  assert.equal(term._keyQueue.length, 64);
});

test("malformed synthetic key events are rejected", () => {
  const term = makeInputTarget();

  term._pushKey(null);
  term._pushKey({ type: "unknown" });
  term._pushKey({ type: "char", ch: "too long" });

  assert.deepEqual(term._keyQueue, []);
});

test("entry point defines restrictive browser policies", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

  assert.match(html, /name="referrer" content="no-referrer"/);
  assert.match(html, /http-equiv="Content-Security-Policy"/);
  assert.match(html, /script-src 'self'/);
  assert.match(html, /object-src 'none'/);
  assert.match(html, /base-uri 'none'/);
});
