// UI controller: queue, conversion calls, preview, merge, export, settings.
// XSS-safe: builds DOM with createElement/textContent; renders Markdown through
// DOMPurify as a sanitized fragment. No raw innerHTML assignment anywhere.
const state = { items: [], selectedId: null, rawMode: false, nextId: 1, ocrEndpoint: null };

const $ = (id) => document.getElementById(id);
const queueList = $("queueList");

function addItem(label) {
  const item = { id: state.nextId++, label, status: "converting",
                 result: null, checked: true };
  state.items.push(item);
  render();
  return item;
}

function btn(label, fn) {
  const b = document.createElement("button");
  b.className = "ghost"; b.textContent = label; b.style.marginLeft = "6px";
  b.addEventListener("click", fn); return b;
}

function render() {
  queueList.replaceChildren();
  for (const it of state.items) {
    const li = document.createElement("li");
    li.className = "qitem";
    const status = it.result ? it.result.status : it.status;

    const chk = document.createElement("input");
    chk.type = "checkbox"; chk.checked = it.checked; chk.className = "chk";
    chk.addEventListener("change", () => { it.checked = chk.checked; });

    const name = document.createElement("span");
    name.className = "name"; name.textContent = it.label; name.title = it.label;

    const badge = document.createElement("span");
    badge.className = `status ${status}`; badge.textContent = status;

    const actions = document.createElement("span");
    if (it.result && it.result.status === "done") {
      actions.append(
        btn("Preview", () => selectItem(it.id)),
        btn("Copy", () => copyText(it.result.markdown)),
        btn("⬇ .md", () => downloadMd(it.result)),
      );
    }
    li.append(chk, name, badge, actions);
    queueList.append(li);
  }
}

function ocrForm() {
  return { ocr_enabled: $("ocrEnabled").checked,
           endpoint: state.ocrEndpoint || null,
           model: $("ocrModel").value || "" };
}

async function convertFile(file) {
  const item = addItem(file.name);
  const fd = new FormData();
  fd.append("file", file);
  const o = ocrForm();
  fd.append("ocr_enabled", o.ocr_enabled);
  if (o.endpoint) fd.append("endpoint", o.endpoint);
  fd.append("model", o.model);
  try {
    const resp = await fetch("/api/convert", { method: "POST", body: fd });
    const data = await resp.json();
    attachResults(item, data.results);
  } catch (e) {
    item.status = "error"; item.result = { status: "error", error: String(e) }; render();
  }
}

async function convertUrl(url) {
  const item = addItem(url);
  const o = ocrForm();
  try {
    const resp = await fetch("/api/convert-url", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, ...o }) });
    const data = await resp.json();
    attachResults(item, data.results);
  } catch (e) {
    item.status = "error"; item.result = { status: "error", error: String(e) }; render();
  }
}

function attachResults(item, results) {
  if (!results || !results.length) { item.status = "error"; render(); return; }
  item.result = results[0];
  item.status = results[0].status;
  // Extra entries (from a zip) become their own queue items.
  for (let i = 1; i < results.length; i++) {
    state.items.push({ id: state.nextId++, label: results[i].name,
                       status: results[i].status, result: results[i], checked: true });
  }
  render();
}

function selectItem(id) {
  state.selectedId = id;
  const it = state.items.find((x) => x.id === id);
  renderPreview(it && it.result ? it.result.markdown : "");
}

function renderPreview(md) {
  const body = $("previewBody");
  body.classList.remove("muted");
  if (state.rawMode) {
    const pre = document.createElement("pre");
    pre.textContent = md || "";
    body.replaceChildren(pre);
  } else {
    const html = window.marked ? window.marked.parse(md || "") : (md || "");
    const node = window.DOMPurify
      ? window.DOMPurify.sanitize(html, { RETURN_DOM_FRAGMENT: true })
      : document.createTextNode(html);
    body.replaceChildren(node);
  }
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); } catch (_) {}
}

function downloadMd(result) {
  const name = window.MDLib.mdFilename(result.name);
  downloadBlob(new Blob([result.markdown], { type: "text/markdown" }), name);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadZip() {
  const done = state.items.filter((x) => x.result && x.result.status === "done");
  if (!done.length) return;
  const zip = new JSZip();
  const used = {};
  for (const it of done) {
    let fn = window.MDLib.mdFilename(it.result.name);
    if (used[fn]) fn = fn.replace(/\.md$/, `-${used[fn]++}.md`); else used[fn] = 1;
    zip.file(fn, it.result.markdown);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(blob, "markdown-export.zip");
}

function mergeSelected() {
  const chosen = state.items.filter((x) => x.checked && x.result).map((x) => x.result);
  const merged = window.MDLib.mergeSelected(chosen);
  if (!merged) return;
  downloadBlob(new Blob([merged], { type: "text/markdown" }), "merged.md");
}

async function loadOcrStatus() {
  try {
    const data = await (await fetch("/api/ocr-status")).json();
    state.ocrEndpoint = data.endpoint;
    $("ocrModel").value = data.default_model;
    $("ocrStatus").textContent = data.available
      ? `OCR engine detected: ${data.provider} (${data.endpoint})`
      : "No local model found. Start Ollama or LM Studio to enable OCR.";
  } catch (_) {
    $("ocrStatus").textContent = "Could not check OCR status.";
  }
}

function clearAll() {
  state.items = []; state.selectedId = null;
  render();
  $("previewBody").textContent = "Select a converted item to preview.";
}

function wire() {
  const dz = $("dropzone");
  ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => {
    e.preventDefault(); dz.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => {
    e.preventDefault(); dz.classList.remove("drag"); }));
  dz.addEventListener("drop", (e) => { [...e.dataTransfer.files].forEach(convertFile); });
  $("fileInput").addEventListener("change", (e) => [...e.target.files].forEach(convertFile));
  $("urlBtn").addEventListener("click", () => {
    const u = $("urlInput").value.trim(); if (u) { convertUrl(u); $("urlInput").value = ""; } });
  $("mergeBtn").addEventListener("click", mergeSelected);
  $("zipBtn").addEventListener("click", downloadZip);
  $("clearBtn").addEventListener("click", clearAll);
  $("toggleRaw").addEventListener("click", () => {
    state.rawMode = !state.rawMode;
    const it = state.items.find((x) => x.id === state.selectedId);
    renderPreview(it && it.result ? it.result.markdown : ""); });
  $("copyBtn").addEventListener("click", () => {
    const it = state.items.find((x) => x.id === state.selectedId);
    if (it && it.result) copyText(it.result.markdown); });
  $("settingsBtn").addEventListener("click", () => $("settingsPanel").classList.toggle("hidden"));
  loadOcrStatus();
}

document.addEventListener("DOMContentLoaded", wire);
