const test = require("node:test");
const assert = require("node:assert");
const { mergeSelected, mdFilename, estTokens, estSaved, detectType, fmtBytes, taggedName } = require("../web/lib.js");

test("taggedName appends sanitized model when enabled", () => {
  assert.strictEqual(taggedName("report.pdf", "google/gemma-4-e4b", true), "report-google-gemma-4-e4b.md");
});
test("taggedName omits tag when disabled or no model", () => {
  assert.strictEqual(taggedName("report.pdf", "google/gemma-4-e4b", false), "report.md");
  assert.strictEqual(taggedName("report.pdf", "", true), "report.md");
});

test("mdFilename swaps extension to .md", () => {
  assert.strictEqual(mdFilename("report.pdf"), "report.md");
  assert.strictEqual(mdFilename("deck.pptx"), "deck.md");
});

test("mergeSelected combines in order with source headers", () => {
  const results = [
    { name: "a.md", markdown: "Alpha", status: "done" },
    { name: "b.md", markdown: "Beta", status: "done" },
  ];
  const merged = mergeSelected(results);
  assert.match(merged, /# a\.md[\s\S]*Alpha[\s\S]*# b\.md[\s\S]*Beta/);
});

test("mergeSelected skips error rows", () => {
  const results = [
    { name: "a.md", markdown: "Alpha", status: "done" },
    { name: "bad", markdown: "", status: "error" },
  ];
  const merged = mergeSelected(results);
  assert.doesNotMatch(merged, /# bad/);
});

test("estTokens approximates chars/4", () => {
  assert.strictEqual(estTokens(400), 100);
  assert.strictEqual(estTokens(10), 3);
});

test("estSaved uses per-format factor", () => {
  // pdf factor 4.0 → saved = tokens * 3
  assert.strictEqual(estSaved("pdf", 100), 300);
  // unknown kind → 3.5 factor → tokens * 2.5
  assert.strictEqual(estSaved("zzz", 100), 250);
});

test("detectType maps extensions to kind/label", () => {
  assert.strictEqual(detectType("a.pdf").kind, "pdf");
  assert.strictEqual(detectType("b.xlsx").type, "Excel");
  assert.strictEqual(detectType("c.PPTX").kind, "ppt");
  assert.strictEqual(detectType("d.unknownext").kind, "gen");
});

test("fmtBytes is human readable", () => {
  assert.strictEqual(fmtBytes(512), "512 B");
  assert.strictEqual(fmtBytes(2048), "2 KB");
  assert.strictEqual(fmtBytes(null), "");
});
