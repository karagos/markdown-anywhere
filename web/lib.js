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

  function fmtBytes(b) {
    if (b == null) return "";
    if (b < 1024) return b + " B";
    if (b < 1024 * 1024) return (b / 1024).toFixed(0) + " KB";
    return (b / 1024 / 1024).toFixed(1) + " MB";
  }
  function fmtNum(n) { return Number(n).toLocaleString("en-US"); }
  function estTokens(chars) { return Math.round(chars / 4); }

  // raw-vs-Markdown savings heuristic (per format)
  const RAW_FACTOR = { pdf: 4.0, doc: 3.2, xls: 3.8, ppt: 4.0, web: 3.3, gen: 3.5 };
  function estSaved(kind, tokens) {
    return Math.round(tokens * ((RAW_FACTOR[kind] || 3.5) - 1));
  }

  const EXT_MAP = {
    pdf: { kind: "pdf", label: "PDF", type: "PDF" },
    doc: { kind: "doc", label: "DOC", type: "Word" }, docx: { kind: "doc", label: "DOC", type: "Word" },
    xls: { kind: "xls", label: "XLS", type: "Excel" }, xlsx: { kind: "xls", label: "XLS", type: "Excel" }, csv: { kind: "xls", label: "CSV", type: "CSV" },
    ppt: { kind: "ppt", label: "PPT", type: "PowerPoint" }, pptx: { kind: "ppt", label: "PPT", type: "PowerPoint" },
    html: { kind: "web", label: "HTM", type: "HTML" }, htm: { kind: "web", label: "HTM", type: "HTML" },
    json: { kind: "gen", label: "JSON", type: "JSON" }, xml: { kind: "gen", label: "XML", type: "XML" },
    epub: { kind: "gen", label: "EPUB", type: "EPUB" }, zip: { kind: "gen", label: "ZIP", type: "ZIP" }, msg: { kind: "gen", label: "MSG", type: "Outlook" },
    png: { kind: "gen", label: "IMG", type: "Image" }, jpg: { kind: "gen", label: "IMG", type: "Image" }, jpeg: { kind: "gen", label: "IMG", type: "Image" },
    gif: { kind: "gen", label: "IMG", type: "Image" }, bmp: { kind: "gen", label: "IMG", type: "Image" }, webp: { kind: "gen", label: "IMG", type: "Image" }, tiff: { kind: "gen", label: "IMG", type: "Image" },
    mp3: { kind: "gen", label: "AUD", type: "Audio" }, wav: { kind: "gen", label: "AUD", type: "Audio" }, m4a: { kind: "gen", label: "AUD", type: "Audio" },
  };
  function detectType(name) {
    const ext = (String(name).split(".").pop() || "").toLowerCase();
    return EXT_MAP[ext] || { kind: "gen", label: ext.slice(0, 4).toUpperCase() || "FILE", type: ext.toUpperCase() || "File" };
  }

  function modelSuffix(model) {
    return String(model || "").replace(/[\\/:\s]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  }
  function taggedName(name, model, tagOn) {
    const base = String(name).split(/[\\/]/).pop();
    const dot = base.lastIndexOf(".");
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const suf = tagOn && model ? "-" + modelSuffix(model) : "";
    return stem + suf + ".md";
  }

  const api = { mdFilename, mergeSelected, fmtBytes, fmtNum, estTokens, estSaved, detectType, modelSuffix, taggedName };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MDLib = api;
})(typeof window !== "undefined" ? window : globalThis);
