// Pure helpers shared by the browser UI and Node tests.
(function (root) {
  function mdFilename(name) {
    const base = String(name).split(/[\\/]/).pop();
    const dot = base.lastIndexOf(".");
    const stem = dot > 0 ? base.slice(0, dot) : base;
    return stem + ".md";
  }

  function mergeSelected(results) {
    return results
      .filter((r) => r.status === "done")
      .map((r) => `# ${r.name}\n\n${r.markdown}`)
      .join("\n\n---\n\n");
  }

  const api = { mdFilename, mergeSelected };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MDLib = api;
})(typeof window !== "undefined" ? window : globalThis);
