const test = require("node:test");
const assert = require("node:assert");
const { mergeSelected, mdFilename } = require("../web/lib.js");

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
