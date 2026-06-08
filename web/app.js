// Markitdown by CAIO Group — vanilla app (ported from the React design).
// XSS-safe DOM building (createElement/textContent); Markdown via marked + DOMPurify.
(function () {
  const L = window.MDLib;
  const ic = (name, cls) => { const s = window.svgIcon(name); if (cls) s.setAttribute("class", cls); return s; };
  const sizedIc = (name, px) => { const s = window.svgIcon(name); s.setAttribute("width", px); s.setAttribute("height", px); s.style.flex = "none"; s.style.opacity = "0.6"; return s; };

  // ---------- tiny DOM builder ----------
  function h(tag, attrs, children) {
    const e = document.createElement(tag);
    attrs = attrs || {};
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k === "style" && typeof v === "object") Object.assign(e.style, v);
      else if (k.slice(0, 2) === "on" && typeof v === "function") e.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k in e && k !== "list") { try { e[k] = v; } catch (_) { e.setAttribute(k, v); } }
      else e.setAttribute(k, v);
    }
    const kids = children == null ? [] : (Array.isArray(children) ? children : [children]);
    for (const c of kids) {
      if (c == null || c === false) continue;
      e.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return e;
  }

  // ---------- state ----------
  let nextId = 1;
  const uid = () => "i" + (nextId++);
  const state = {
    view: "convert",
    theme: (() => { try { return localStorage.getItem("mid-theme") || "light"; } catch (_) { return "light"; } })(),
    queue: [], history: [], previewId: null, previewMode: "rendered",
    linkValue: "", dnd: null, historyRows: null, historyStats: null,
    settings: {
      outputFolder: "~/Documents/Markitdown Output", autoSave: false,
      ocrEnabled: false, provider: "LM Studio", endpoint: "http://localhost:1234/v1",
      model: "", models: [], connection: "idle", pdfMode: "fast",
      historyRetentionDays: 7, tagSavedWithModel: true,
    },
  };

  // ---------- derived ----------
  const doneItems = () => state.queue.filter((it) => it.status === "done");
  const selectedDone = () => state.queue.filter((it) => it.selected && it.status === "done");
  const sessionTokens = () => state.history.reduce((s, hh) => s + (hh.tokens || 0), 0);

  // ---------- API ----------
  async function api(path, opts) {
    const r = await fetch(path, opts);
    if (!r.ok && r.status >= 500) throw new Error("server " + r.status);
    return r.json();
  }
  function ocrFields() {
    const s = state.settings;
    return { ocr_enabled: !!s.ocrEnabled, endpoint: s.endpoint || "", model: s.model || "" };
  }

  // ---------- toasts ----------
  function toast(kind, msg, sub) {
    const box = h("div", { class: "toast toast--" + kind }, [
      ic(kind === "ok" ? "check" : "info"),
      h("div", {}, [msg, sub && h("div", { class: "toast__sub", text: sub })]),
    ]);
    document.querySelector(".toasts").append(box);
    setTimeout(() => box.remove(), 3200);
  }

  // ---------- conversion ----------
  function addHistory(it) {
    state.history.unshift({ id: uid(), name: it.name, kind: it.kind, iconLabel: it.iconLabel,
      typeLabel: it.typeLabel, ocr: !!it.ocr, tokens: it.tokens, status: "done", when: "just now", markdown: it.markdown });
  }
  function applyResult(item, res) {
    item.status = res.status;
    item.markdown = res.markdown || "";
    item.model = res.model || "";
    item.error = res.error || "";
    if (res.status === "done") {
      item.chars = res.chars || item.markdown.length;
      item.tokens = res.tokens != null ? res.tokens : L.estTokens(item.markdown.length);
      addHistory(item);
      if (state.settings.autoSave) autoSave(item);
    } else if (res.status === "error") {
      item.errorShort = res.error || "Conversion failed";
      item.errorDetail = res.error || "";
    } else if (res.status === "unsupported") {
      // image-only PDFs surface as the scanned note when OCR is off
      if (item.kind === "pdf") { item.status = "unsupported"; item.reason = "scanned"; }
    }
  }

  function attachStreamResults(item, results) {
    results = results || [];
    if (!results.length) { item.status = "error"; item.errorShort = "No result"; return; }
    applyResult(item, results[0]);
    for (let i = 1; i < results.length; i++) {
      const r = results[i]; const dd = L.detectType(r.name);
      const sub = { id: uid(), name: r.name, kind: dd.kind, iconLabel: dd.label, typeLabel: dd.type,
        size: null, status: r.status, markdown: r.markdown || "", model: r.model || "", selected: false };
      if (r.status === "done") { sub.chars = r.chars || sub.markdown.length; sub.tokens = r.tokens != null ? r.tokens : L.estTokens(sub.markdown.length); addHistory(sub); }
      state.queue.splice(state.queue.indexOf(item) + i, 0, sub);
    }
    if (item.status === "done") toast("ok", "Conversion complete", "Markdown is ready to preview.");
  }

  async function convertFile(file) {
    const d = L.detectType(file.name);
    const item = { id: uid(), name: file.name, kind: d.kind, iconLabel: d.label, typeLabel: d.type,
      size: file.size, status: "converting", ocr: state.settings.ocrEnabled, markdown: "", selected: false, file: file };
    state.queue.unshift(item);
    renderView();
    const fd = new FormData();
    fd.append("file", file);
    const o = ocrFields();
    fd.append("ocr_enabled", o.ocr_enabled);
    if (o.endpoint) fd.append("endpoint", o.endpoint);
    fd.append("model", o.model);
    fd.append("pdf_mode", state.settings.pdfMode || "fast");
    try {
      const resp = await fetch("/api/convert-stream", { method: "POST", body: fd });
      if (!resp.body) {  // streaming unsupported → non-streaming fallback
        const data = await (await fetch("/api/convert", { method: "POST", body: fd })).json();
        attachStreamResults(item, data.results); renderView(); return;
      }
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line) continue;
          let ev; try { ev = JSON.parse(line); } catch (_) { continue; }
          if (ev.type === "progress") { item.ocr = true; item.ocrPage = ev.page; item.ocrTotal = ev.total; renderView(); }
          else if (ev.type === "result") { attachStreamResults(item, ev.results); }
        }
      }
    } catch (e) { item.status = "error"; item.errorShort = String(e); }
    renderView();
  }

  async function convertLink(forceUrl) {
    const url = (forceUrl || state.linkValue).trim(); if (!url) return;
    const clean = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const isYt = /youtube\.com|youtu\.be/i.test(url);
    const item = { id: uid(), name: clean.length > 42 ? clean.slice(0, 42) + "…" : clean, kind: "web",
      iconLabel: "WEB", typeLabel: isYt ? "YouTube" : "Web link", size: null, status: "converting", ocr: false, markdown: "", selected: false, url: url };
    state.queue.unshift(item);
    if (!forceUrl) state.linkValue = "";
    renderView();
    try {
      const o = ocrFields();
      const data = await api("/api/convert-url", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, ...o }) });
      const r = (data.results || [])[0];
      if (!r) { item.status = "error"; item.errorShort = "No result"; }
      else applyResult(item, r);
      if (item.status === "done") toast("ok", "Conversion complete", "Markdown is ready to preview.");
    } catch (e) { item.status = "error"; item.errorShort = String(e); }
    renderView();
  }

  function reconvert(item) {
    if (item.file) { convertFile(item.file); }
    else if (item.kind === "web" && item.url) { convertLink(item.url); }
    else return;
    toast("ok", "Reconverting", "New version added with your current model.");
  }

  async function autoSave(item) {
    try {
      await api("/api/save", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder: state.settings.outputFolder, files: [{ name: L.taggedName(item.name, item.model, state.settings.tagSavedWithModel), markdown: item.markdown }] }) });
    } catch (_) {}
  }

  // ---------- item / batch actions ----------
  function findItem(id) { return state.queue.find((x) => x.id === id) || state.history.find((x) => x.id === id); }

  async function onAction(id, action) {
    if (action === "goto-settings") { state.view = "settings"; renderAll(); return; }
    if (action === "remove") { state.queue = state.queue.filter((it) => it.id !== id); if (state.previewId === id) state.previewId = null; renderView(); return; }
    const it = findItem(id); if (!it) return;
    if (action === "copy") { try { await navigator.clipboard.writeText(it.markdown); } catch (_) {} toast("ok", "Copied to clipboard", L.fmtNum(it.markdown.length) + " chars"); }
    if (action === "download") { const fn = L.taggedName(it.name, it.model, state.settings.tagSavedWithModel); downloadBlob(new Blob([it.markdown], { type: "text/markdown" }), fn); toast("ok", "Saved .md file", fn); }
    if (action === "save") { await saveToFolder([it]); }
    if (action === "preview") {
      state.view = "convert";
      if (!state.queue.find((x) => x.id === id)) state.queue.unshift({ ...it, status: "done", chars: it.markdown.length, tokens: it.tokens, selected: false });
      state.previewId = id; state.previewMode = "rendered"; renderAll();
    }
  }

  async function saveToFolder(items) {
    const files = items.filter((x) => x.status === "done").map((x) => ({ name: L.taggedName(x.name, x.model, state.settings.tagSavedWithModel), markdown: x.markdown }));
    if (!files.length) return;
    try {
      const data = await api("/api/save", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder: state.settings.outputFolder, files }) });
      if (data.error) toast("info", "Could not save", data.error);
      else toast("ok", `Saved ${data.saved.length} file${data.saved.length !== 1 ? "s" : ""}`, data.folder);
    } catch (e) { toast("info", "Could not save", String(e)); }
  }

  function onBatch(action) {
    const sel = selectedDone();
    if (action === "clear") { state.queue.forEach((it) => (it.selected = false)); renderView(); return; }
    if (!sel.length) return;
    if (action === "merge") {
      const merged = L.mergeSelected(sel);
      downloadBlob(new Blob([merged], { type: "text/markdown" }), "merged.md");
      toast("ok", `Merged ${sel.length} files`, "merged.md");
    }
    if (action === "zip") downloadZip(sel);
    if (action === "save") saveToFolder(sel);
  }

  async function downloadZip(items) {
    const zip = new JSZip(); const used = {};
    for (const it of items) {
      let fn = L.taggedName(it.name, it.model, state.settings.tagSavedWithModel);
      if (used[fn]) fn = fn.replace(/\.md$/, `-${used[fn]++}.md`); else used[fn] = 1;
      zip.file(fn, it.markdown);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(blob, "markitdown-export.zip");
    toast("ok", `Downloaded ${items.length} files`, "markitdown-export.zip");
  }
  function downloadBlob(blob, name) {
    const u = URL.createObjectURL(blob);
    const a = h("a", { href: u, download: name }); a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  }

  function onSelectAll() {
    const dones = doneItems();
    const allSel = dones.length > 0 && dones.every((it) => it.selected);
    state.queue.forEach((it) => { if (it.status === "done") it.selected = !allSel; });
    renderView();
  }
  function onReorder(from, to) {
    if (from === to || from == null || to == null) return;
    const a = state.queue; const [m] = a.splice(from, 1); a.splice(to, 0, m); renderView();
  }

  // ---------- settings ----------
  async function loadSettings() {
    try { const s = await api("/api/settings"); Object.assign(state.settings, s); } catch (_) {}
  }
  function persistSettings() {
    const { models, connection, ...persist } = state.settings;
    fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(persist) }).catch(() => {});
  }
  function setSetting(patch) { Object.assign(state.settings, patch); persistSettings(); renderView(); }

  async function testConnection() {
    state.settings.connection = "testing"; renderView();
    try {
      const data = await api("/api/models?endpoint=" + encodeURIComponent(state.settings.endpoint));
      if (data.available && data.models.length) {
        state.settings.models = data.models; state.settings.connection = "ok";
        if (!state.settings.model) state.settings.model = data.models[0];
        persistSettings();
      } else { state.settings.models = []; state.settings.connection = "err"; }
    } catch (_) { state.settings.models = []; state.settings.connection = "err"; }
    renderView();
  }

  async function loadHistory() {
    try {
      const [hh, st] = await Promise.all([api("/api/history"), api("/api/history/stats")]);
      state.historyRows = hh.entries || [];
      state.historyStats = st || { totals: {}, by_model: [] };
    } catch (_) { state.historyRows = []; state.historyStats = { totals: {}, by_model: [] }; }
  }

  function fmtMs(ms) { return ms >= 1000 ? (ms / 1000).toFixed(1) + "s" : Math.round(ms) + "ms"; }

  async function checkYtCookies() {
    state.ytCookies = { checking: true }; renderView();
    try { state.ytCookies = await api("/api/youtube-cookies-status"); }
    catch (_) { state.ytCookies = { error: "Couldn't check cookies." }; }
    renderView();
  }

  // ===================================================================
  // RENDER
  // ===================================================================
  const TITLES = {
    convert: ["Convert", "Drop a document, get clean Markdown."],
    history: ["History", "Your conversions and per-model performance."],
    settings: ["Settings", "Output, OCR, and about."],
    about: ["About", "What Markitdown does and why."],
  };

  function fileTile(kind, label) {
    return h("div", { class: "qicon qicon--" + kind }, kind === "web" && !label ? [ic("globe")] : [label || ic("file")]);
  }
  function statusPill(status) {
    const map = { queued: ["spill--queued", "Queued"], converting: ["spill--conv", "Converting"],
      done: ["spill--done", "Done"], error: ["spill--err", "Error"], unsupported: ["spill--unsup", "Unsupported"] };
    const [cls, label] = map[status] || map.queued;
    return h("span", { class: "spill " + cls, text: label });
  }
  function renderMarkdownInto(node, md) {
    const html = window.marked ? window.marked.parse(md || "") : (md || "");
    const frag = window.DOMPurify ? window.DOMPurify.sanitize(html, { RETURN_DOM_FRAGMENT: true }) : document.createTextNode(html);
    node.replaceChildren(frag);
  }

  function openMdModal(name, md) {
    let mode = "rendered";
    const back = h("div", { class: "md-modal__back", onClick: (e) => { if (e.target === back) back.remove(); } });
    const body = h("div", { class: "md-modal__body" });
    const draw = () => {
      if (mode === "raw") body.replaceChildren(h("pre", { class: "md-modal__raw", text: md || "" }));
      else renderMarkdownInto(body, md);
    };
    const tabs = h("div", { class: "md-modal__tabs" });
    const renderToggle = () => tabs.replaceChildren(
      h("button", { class: mode === "rendered" ? "on" : "", onClick: () => { mode = "rendered"; renderToggle(); draw(); }, text: "Rendered" }),
      h("button", { class: mode === "raw" ? "on" : "", onClick: () => { mode = "raw"; renderToggle(); draw(); }, text: "Raw" }));
    renderToggle(); draw();
    const head = h("div", { class: "md-modal__head" }, [
      h("span", { class: "md-modal__name", text: name }), tabs,
      h("button", { class: "btn btn--quiet btn--sm btn--icon", title: "Close", onClick: () => back.remove() }, [ic("x")])]);
    back.append(h("div", { class: "md-modal" }, [head, body]));
    document.body.append(back);
  }

  async function renameHistory(r) {
    const next = window.prompt("Rename this entry", r.name);
    if (next == null) return;
    const name = next.trim(); if (!name || name === r.name) return;
    try {
      await fetch("/api/history/" + r.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      await loadHistory(); renderView();
      toast("ok", "Renamed", name);
    } catch (e) { toast("info", "Could not rename", String(e)); }
  }

  // ---- sidebar ----
  function renderSidebar() {
    const s = state.settings;
    const nav = [["convert", "Convert", "convert"], ["history", "History", "clock"], ["settings", "Settings", "settings"], ["about", "About", "info"]]
      .map(([id, label, icon]) => {
        const converting = state.queue.filter((q) => q.status === "converting").length;
        return h("button", { class: "nav__item" + (state.view === id ? " is-active" : ""), onClick: async () => { state.view = id; if (id === "history") await loadHistory(); renderAll(); } },
          [ic(icon), h("span", { text: label }), id === "convert" && converting > 0 ? h("span", { class: "nav__badge", text: String(converting) }) : null]);
      });
    return h("aside", { class: "sidebar" }, [
      h("div", { class: "brand" }, [
        h("div", { class: "brand__app" }, ["Markitdown", h("span", { class: "brand__dot", text: "." })]),
        h("div", { class: "brand__tag", text: "Anything to Markdown" }),
        h("div", { class: "brand__by", text: "by CAIO Group" }),
      ]),
      h("nav", { class: "nav" }, nav),
      h("div", { class: "side-foot" }, [
        h("div", { class: "side-status" }, [
          h("div", { class: "side-status__row" }, [h("span", { class: "led led--ok" }), "Engine ready"]),
          h("div", { class: "side-status__row" }, [
            h("span", { class: "led " + (s.ocrEnabled ? "led--ok" : "led--off") }),
            s.ocrEnabled ? h("span", {}, ["OCR ", h("span", { class: "mono", text: "· " + s.provider })]) : h("span", { text: "OCR off" }),
          ]),
        ]),
        h("span", { class: "chip" }, [ic("lock"), h("span", { text: "Local & private · nothing uploaded" })]),
        h("div", { class: "theme-toggle", role: "group", "aria-label": "Theme" }, [
          h("button", { class: state.theme === "light" ? "on" : "", onClick: () => setTheme("light") }, [ic("sun"), h("span", { text: "Light" })]),
          h("button", { class: state.theme === "dark" ? "on" : "", onClick: () => setTheme("dark") }, [ic("moon"), h("span", { text: "Dark" })]),
        ]),
        h("div", { class: "made-by" }, ["Made by ", h("strong", { text: "CAIO Group" }),
          h("a", { href: "https://wearecaio.com", target: "_blank", rel: "noopener" }, ["wearecaio.com ", ic("arrowUR")])]),
      ]),
    ]);
  }

  function setTheme(t) { state.theme = t; try { localStorage.setItem("mid-theme", t); } catch (_) {} document.documentElement.dataset.theme = t; renderAll(); }

  // ---- convert view ----
  function savingsStrip() {
    const total = sessionTokens(), count = state.history.length;
    if (count === 0) {
      return h("div", { class: "savings-strip savings-strip--empty" }, [
        h("span", { class: "ss-ic" }, [ic("coins")]),
        h("div", { class: "ss-main" }, [
          h("div", { class: "ss-num-empty", text: "Track the tokens you save" }),
          h("div", { class: "ss-sub", text: "Convert a file or link to start counting the tokens you save vs. sending raw files to your AI." }),
        ]),
      ]);
    }
    const saved = state.history.reduce((s, hh) => s + L.estSaved(hh.kind, hh.tokens || 0), 0);
    const rawTotal = total + saved;
    const savedPct = rawTotal > 0 ? Math.round(saved / rawTotal * 100) : 0;
    return h("div", { class: "savings-strip" }, [
      h("span", { class: "ss-ic" }, [ic("coins")]),
      h("div", { class: "ss-main" }, [
        h("div", { class: "ss-num" }, [h("b", { style: { color: "var(--ok)" }, text: "≈ " + L.fmtNum(saved) }), " tokens saved this session ",
          h("b", { style: { color: "var(--ok)" }, text: "(≈ " + savedPct + "%)" })]),
        h("div", { class: "ss-sub", text: `across ${count} file${count !== 1 ? "s" : ""} · estimated savings vs. sending the raw files to your AI` }),
      ]),
      h("span", { class: "ss-hint", title: "Tokens counted with the GPT-4o tokenizer (o200k). “Saved” is a per-format estimate vs. raw uploads.", text: "estimate" }),
    ]);
  }

  function dropzone() {
    let depth = 0;
    const linkInput = h("input", { class: "input", type: "url", value: state.linkValue,
      placeholder: "Paste a web link — webpage or YouTube",
      onInput: (e) => { state.linkValue = e.target.value; },
      onKeydown: (e) => { if (e.key === "Enter") convertLink(); } });
    const dz = h("div", { class: "dropzone", role: "button", tabIndex: 0, "aria-label": "Drag files here or click to browse",
      onClick: () => document.getElementById("fileInput").click(),
      onKeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); document.getElementById("fileInput").click(); } },
      onDragenter: (e) => { e.preventDefault(); depth++; dz.classList.add("is-drag"); },
      onDragover: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; },
      onDragleave: (e) => { e.preventDefault(); depth--; if (depth <= 0) { depth = 0; dz.classList.remove("is-drag"); } },
      onDrop: (e) => { e.preventDefault(); depth = 0; dz.classList.remove("is-drag"); if (e.dataTransfer.files && e.dataTransfer.files.length) [...e.dataTransfer.files].forEach(convertFile); },
    }, [
      h("div", { class: "dropzone__icon" }, [ic("upload")]),
      h("div", { class: "dropzone__title" }, [h("span", { text: "Drag files or a folder here" })]),
      h("div", { class: "dropzone__sub", text: "…or click to browse. Everything stays on your machine — nothing is uploaded." }),
      h("div", { class: "linkrow", onClick: (e) => e.stopPropagation() }, [
        h("div", { class: "input-wrap" }, [ic("link"), linkInput]),
        h("button", { class: "btn btn--primary", onClick: convertLink }, [ic("convert"), " Convert link"]),
      ]),
      h("div", { class: "linkrow__hint", text: "Webpage or YouTube → Markdown" }),
      h("div", { class: "chips", onClick: (e) => e.stopPropagation() },
        ["PDF", "Word", "Excel", "PowerPoint", "CSV", "HTML", "JSON", "XML", "EPUB", "Images", "ZIP"].map((f) => h("span", { class: "fmt", text: f }))),
    ]);
    return dz;
  }

  function queueCard(item, realIdx) {
    if (item.status === "unsupported" && item.reason === "scanned") {
      return h("div", { class: "note" }, [
        h("span", { class: "note__ic" }, [ic("alert")]),
        h("div", { class: "note__body" }, [
          "No text layer found in ", h("b", { text: item.name }), " — this looks like a scanned PDF. Turn on OCR in Settings to extract it.",
          h("div", {}, [
            h("button", { class: "btn btn--primary btn--sm", onClick: () => onAction(item.id, "goto-settings") }, [ic("settings"), " Open Settings"]),
            h("button", { class: "btn btn--quiet btn--sm", style: { marginLeft: "6px" }, onClick: () => onAction(item.id, "remove"), text: "Dismiss" }),
          ]),
        ]),
      ]);
    }
    const cls = ["qcard"];
    if (item.selected) cls.push("is-selected");
    if (state.previewId === item.id) cls.push("is-active-preview");
    if (state.dnd && state.dnd.from === realIdx) cls.push("is-dragging");
    if (state.dnd && state.dnd.over === realIdx && state.dnd.from !== realIdx) cls.push("is-dragover");

    const meta = h("div", { class: "qmeta" });
    if (item.status === "converting") meta.append(h("span", { style: { color: "var(--warn)", fontWeight: "500" }, text: (item.ocr && item.ocrTotal) ? `OCR page ${item.ocrPage} / ${item.ocrTotal}` : (item.ocr ? "Converting (OCR)…" : "Converting…") }));
    else if (item.status === "error") meta.append(h("span", { style: { color: "var(--err)" }, text: item.errorShort || "Error" }));
    else if (item.status === "queued") meta.append(h("span", { text: item.typeLabel + " · waiting…" }));
    else meta.append(h("span", { text: item.typeLabel }), h("span", { class: "sep", text: "·" }),
      h("span", { class: "mono", text: L.fmtNum(item.chars || 0) + " chars" }), h("span", { class: "sep", text: "·" }),
      h("span", { class: "mono", text: "~" + L.fmtNum(item.tokens || 0) + " tok" }));

    const nameRow = h("div", { class: "qname-row" }, [
      h("span", { class: "qname", text: item.name }),
      item.model && item.status === "done" ? h("span", { class: "ocr-badge", text: "OCR" }) : null,
      item.model && item.status === "done" ? h("span", { class: "model-chip", text: item.model }) : null]);
    const body = h("div", { class: "qbody", style: { cursor: item.status === "done" ? "pointer" : "default" },
      onClick: () => { if (item.status === "done") { state.previewId = item.id; renderView(); } } }, [nameRow, meta]);
    if (item.status === "converting") body.append(h("div", { class: "progress" + ((item.ocr && item.ocrTotal) ? "" : " indet") },
      [h("i", (item.ocr && item.ocrTotal) ? { style: { width: Math.round((item.ocrPage / item.ocrTotal) * 100) + "%" } } : {})]));
    if (item.status === "error" && item._expanded) body.append(h("div", { class: "errdetail", text: item.errorDetail || "" }));

    const actions = h("div", { class: "qactions" });
    if (item.status === "done") {
      actions.append(
        h("button", { class: "btn btn--quiet btn--sm btn--icon", title: "Preview", onClick: () => { state.previewId = item.id; renderView(); } }, [ic("eye")]),
        h("button", { class: "btn btn--quiet btn--sm btn--icon", title: "Copy Markdown", onClick: () => onAction(item.id, "copy") }, [ic("copy")]),
        h("button", { class: "btn btn--quiet btn--sm btn--icon", title: "Download .md", onClick: () => onAction(item.id, "download") }, [ic("download")]),
        h("button", { class: "btn btn--quiet btn--sm btn--icon", title: "Rename", onClick: () => startRename(item) }, [ic("pencil")]),
        h("button", { class: "btn btn--quiet btn--sm btn--icon", title: "Reconvert with current model", onClick: () => reconvert(item) }, [ic("refresh")]));
    }
    if (item.status === "error") actions.append(h("button", { class: "btn btn--danger btn--sm", onClick: () => { item._expanded = !item._expanded; renderView(); }, text: item._expanded ? "Hide details" : "Show details" }));
    actions.append(h("button", { class: "btn btn--quiet btn--sm btn--icon del-act", title: item.status === "converting" ? "Cancel" : "Remove", onClick: () => onAction(item.id, "remove") }, [ic("trash")]));

    const dnd = {
      onDragstart: () => { state.dnd = { from: realIdx, over: realIdx }; },
      onDragover: (e) => { e.preventDefault(); if (state.dnd && state.dnd.over !== realIdx) { state.dnd.over = realIdx; } },
      onDrop: (e) => { e.preventDefault(); if (state.dnd) onReorder(state.dnd.from, realIdx); state.dnd = null; },
      onDragend: () => { state.dnd = null; },
    };
    return h("div", Object.assign({ class: cls.join(" "), draggable: !item._renaming }, dnd), [
      h("span", { class: "grip", title: "Drag to reorder" }, [ic("grip")]),
      h("button", { class: "qcheck" + (item.selected ? " is-on" : ""), "aria-label": "Select", onClick: () => { item.selected = !item.selected; renderView(); } }, [ic("check")]),
      fileTile(item.kind, item.typeLabel === "Web link" ? null : item.iconLabel),
      body, actions, h("div", { class: "qstatus" }, [statusPill(item.status)]),
    ]);
  }

  function startRename(item) {
    item._renaming = true; renderView();
    const card = document.querySelector(".qcard.is-renaming-target");
    // fallback: focus the rename input we mark below
    const input = document.getElementById("rename-" + item.id);
    if (input) { input.focus(); input.select(); }
  }

  function convertView() {
    const sel = selectedDone().length;
    const dones = doneItems().length;
    const isNote = (it) => it.status === "unsupported" && it.reason === "scanned";
    const display = [...state.queue.filter(isNote), ...state.queue.filter((it) => !isNote(it))];

    const queueBody = state.queue.length === 0
      ? h("div", { class: "queue-empty" }, [ic("inbox"), h("p", {}, ["Drop a file or paste a link to get started.", h("br"), "Everything stays on your machine."])])
      : h("div", { class: "queue" }, display.map((item) => {
          if (item._renaming) return renameCard(item);
          return queueCard(item, state.queue.indexOf(item));
        }));

    const left = h("div", {}, [
      dropzone(),
      h("div", { class: "panel" }, [
        h("div", { class: "panel__head" }, [
          h("button", { class: "qcheck" + (dones > 0 && sel === dones ? " is-on" : ""), disabled: dones === 0, "aria-label": "Select all converted", onClick: onSelectAll }, [ic("check")]),
          h("span", { class: "eyebrow", text: "Conversion queue" }),
          h("span", { class: "count-badge", text: state.queue.filter((q) => !isNote(q)).length + " items" }),
        ]),
        sel > 0 ? h("div", { class: "batchbar" }, [
          h("span", { class: "batchbar__count" }, [h("span", { class: "mono", text: String(sel) }), " selected"]),
          h("button", { class: "btn btn--primary btn--sm", onClick: () => onBatch("merge") }, [ic("merge"), " Merge → one .md"]),
          h("button", { class: "btn btn--ghost btn--sm", onClick: () => onBatch("zip") }, [ic("zip"), " Download .zip"]),
          h("button", { class: "btn btn--ghost btn--sm", onClick: () => onBatch("save") }, [ic("save"), " Save to folder"]),
          h("button", { class: "btn btn--quiet btn--sm", onClick: () => onBatch("clear") }, [ic("x"), " Clear"]),
        ]) : null,
        h("div", { class: "panel__body" }, [queueBody]),
      ]),
    ]);

    return h("div", { class: "view-enter" }, [savingsStrip(), h("div", { class: "convert-grid" }, [left, previewPanel()])]);
  }

  function renameCard(item) {
    const input = h("input", { class: "rename-input", id: "rename-" + item.id, value: item.name,
      onKeydown: (e) => { if (e.key === "Enter") commitRename(item, input.value); if (e.key === "Escape") { item._renaming = false; renderView(); } },
      onBlur: () => commitRename(item, input.value) });
    const card = h("div", { class: "qcard is-renaming" }, [
      h("span", { class: "grip" }, [ic("grip")]),
      h("span", { class: "qcheck" }, [ic("check")]),
      fileTile(item.kind, item.iconLabel),
      h("div", { class: "qbody" }, [input]),
      h("div", { class: "qstatus" }, [statusPill(item.status)]),
    ]);
    setTimeout(() => { input.focus(); input.select(); }, 0);
    return card;
  }
  function commitRename(item, name) { item.name = (name || "").trim() || item.name; item._renaming = false; renderView(); toast("ok", "Renamed", item.name); }

  function previewPanel() {
    const item = state.queue.find((it) => it.id === state.previewId && it.status === "done");
    const tb1 = h("div", { class: "preview__toolbar" }, [h("span", { class: "eyebrow", text: "Preview" })]);
    if (item) {
      tb1.append(
        h("div", { class: "seg" }, [
          h("button", { class: state.previewMode === "rendered" ? "on" : "", onClick: () => { state.previewMode = "rendered"; renderView(); }, text: "Rendered" }),
          h("button", { class: state.previewMode === "raw" ? "on" : "", onClick: () => { state.previewMode = "raw"; renderView(); }, text: "Raw" }),
          h("button", { class: state.previewMode === "edit" ? "on" : "", onClick: () => { state.previewMode = "edit"; renderView(); }, text: "Edit" }),
        ]),
        h("span", { class: "saved-badge", title: "Token count of this Markdown (GPT-4o tokenizer)" }, [ic("coins"), " ≈ " + L.fmtNum(item.tokens || 0) + " tokens"]));
    }
    const body = h("div", { class: "preview__body" });
    if (!item) {
      body.append(h("div", { class: "preview__empty" }, [h("div", { class: "dropzone__icon" }, [ic("eye")]),
        h("h3", { text: "Nothing to preview yet" }), h("p", { text: "Select a converted item to see its clean Markdown." })]));
    } else if (state.previewMode === "edit") {
      body.append(h("textarea", { class: "input",
        style: { width: "100%", minHeight: "46vh", resize: "vertical", fontFamily: "var(--font-mono)", fontSize: "13px" },
        value: item.markdown,
        onInput: (e) => { item.markdown = e.target.value; item.chars = e.target.value.length; item.tokens = L.estTokens(item.chars); } }));
    } else if (state.previewMode === "rendered") {
      const md = h("div", { class: "md" }); renderMarkdownInto(md, item.markdown); body.append(md);
    } else {
      body.append(h("pre", { class: "raw", text: item.markdown }));
    }
    const panel = h("div", { class: "panel preview" }, [tb1]);
    if (item) panel.append(h("div", { class: "preview__toolbar", style: { borderBottom: "1px solid var(--line)" } }, [
      h("button", { class: "btn btn--ghost btn--sm", onClick: () => onAction(item.id, "copy") }, [ic("copy"), " Copy"]),
      h("button", { class: "btn btn--ghost btn--sm", onClick: () => onAction(item.id, "save") }, [ic("save"), " Save .md"]),
      h("span", { style: { marginLeft: "auto", fontSize: "12.5px", color: "var(--muted)", display: "flex", alignItems: "center", gap: "6px", minWidth: "0" } },
        [sizedIc("file", 14), h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, text: item.name })]),
    ]));
    panel.append(body);
    return panel;
  }

  // ---- history view ----
  function statCard(label, value, sub) {
    return h("div", { class: "why-card" }, [
      h("div", { class: "ss-num", style: { fontSize: "20px" }, text: value }),
      h("b", { text: label }),
      sub ? h("p", { text: sub }) : null,
    ]);
  }

  function historyView() {
    const rows = state.historyRows || [];
    const st = state.historyStats || { totals: {}, by_model: [] };
    const t = st.totals || {};
    if (!state.settings.historyRetentionDays) {
      return h("div", { class: "view-enter", style: { maxWidth: "760px" } }, [
        h("div", { class: "table-wrap" }, [h("div", { class: "queue-empty", style: { padding: "56px 20px" } },
          [ic("clock"), h("p", {}, ["History is off (session-only). ", h("b", { text: "Turn it on in Settings → History" }), " to keep and analyze your conversions."])])]),
      ]);
    }
    const selected = rows.filter((r) => r._sel);
    const asItems = (rs) => rs.map((r) => ({ name: r.name, markdown: r.markdown, model: r.model, status: "done" }));

    const rawTotal = (t.tokens || 0) + (t.saved_tokens_est || 0);
    const savedPct = rawTotal > 0 ? Math.round((t.saved_tokens_est || 0) / rawTotal * 100) : 0;
    const totalsCards = h("div", { class: "why-grid" }, [
      statCard("Files", L.fmtNum(t.files || 0)),
      statCard("Tokens of Markdown", L.fmtNum(t.tokens || 0)),
      statCard("OCR pages", L.fmtNum(t.ocr_pages || 0)),
      statCard("Total time", fmtMs(t.duration_ms || 0)),
      statCard("Est. tokens saved", "≈ " + L.fmtNum(t.saved_tokens_est || 0), "estimate vs raw uploads"),
      statCard("Saved vs raw", "≈ " + savedPct + "%", "estimated savings vs raw uploads"),
    ]);

    const modelTable = (st.by_model || []).length ? h("div", { class: "table-wrap", style: { marginTop: "16px" } }, [
      h("table", { class: "hist" }, [
        h("thead", {}, [h("tr", {}, ["Vision model", "Conversions", "Avg time", "Time / page", "Tokens"].map((c) => h("th", { text: c })))]),
        h("tbody", {}, st.by_model.map((m) => h("tr", {}, [
          h("td", {}, [h("span", { class: "mono", text: m.model })]),
          h("td", { text: String(m.conversions) }),
          h("td", { text: fmtMs(m.avg_ms) }),
          h("td", { text: m.ms_per_page ? fmtMs(m.ms_per_page) : "—" }),
          h("td", { text: "~" + L.fmtNum(m.tokens) }),
        ]))),
      ])]) : null;

    const fileRows = rows.map((r) => h("tr", {}, [
      h("td", {}, [h("button", { class: "qcheck" + (r._sel ? " is-on" : ""), "aria-label": "Select", onClick: () => { r._sel = !r._sel; renderView(); } }, [ic("check")])]),
      h("td", {}, [h("div", { class: "hist__name" }, [fileTile(r.kind, r.kind === "web" ? null : (r.source_type || "").replace(".", "").toUpperCase().slice(0, 4)), h("span", { text: r.name })])]),
      h("td", {}, [h("span", { class: "mono", text: r.model || "—" })]),
      h("td", { text: fmtMs(r.duration_ms) }),
      h("td", { text: "~" + L.fmtNum(r.tokens) }),
      h("td", { text: r.pages_total ? `${r.pages_ocr}/${r.pages_total}` : "—" }),
      h("td", {}, [h("div", { class: "hist__act" }, [
        h("button", { class: "btn btn--quiet btn--sm btn--icon", title: "Preview", onClick: () => openMdModal(r.name, r.markdown) }, [ic("eye")]),
        h("button", { class: "btn btn--quiet btn--sm btn--icon", title: "Copy Markdown", onClick: async () => { try { await navigator.clipboard.writeText(r.markdown || ""); } catch (_) {} toast("ok", "Copied to clipboard", L.fmtNum((r.markdown || "").length) + " chars"); } }, [ic("copy")]),
        h("button", { class: "btn btn--quiet btn--sm btn--icon", title: "Download .md", onClick: () => downloadBlob(new Blob([r.markdown], { type: "text/markdown" }), L.taggedName(r.name, r.model, state.settings.tagSavedWithModel)) }, [ic("download")]),
        h("button", { class: "btn btn--quiet btn--sm btn--icon", title: "Rename", onClick: () => renameHistory(r) }, [ic("pencil")]),
        h("button", { class: "btn btn--quiet btn--sm btn--icon", title: "Delete", onClick: async () => { await fetch("/api/history/" + r.id, { method: "DELETE" }); await loadHistory(); renderView(); } }, [ic("trash")]),
      ])]),
    ]));

    const batch = selected.length ? h("div", { class: "batchbar" }, [
      h("span", { class: "batchbar__count" }, [h("span", { class: "mono", text: String(selected.length) }), " selected"]),
      h("button", { class: "btn btn--primary btn--sm", onClick: () => { const md = L.mergeSelected(asItems(selected)); if (md) downloadBlob(new Blob([md], { type: "text/markdown" }), "merged.md"); } }, [ic("merge"), " Merge → one .md"]),
      h("button", { class: "btn btn--ghost btn--sm", onClick: () => downloadZip(asItems(selected)) }, [ic("zip"), " Download .zip"]),
      h("button", { class: "btn btn--ghost btn--sm", onClick: () => saveToFolder(asItems(selected)) }, [ic("save"), " Save to folder"]),
    ]) : null;

    return h("div", { class: "about view-enter" }, [
      h("div", { class: "hist-bar" }, [
        h("span", { class: "eyebrow", text: `${rows.length} conversion${rows.length !== 1 ? "s" : ""} kept (last ${state.settings.historyRetentionDays} day${state.settings.historyRetentionDays !== 1 ? "s" : ""})` }),
        h("button", { class: "btn btn--danger btn--sm", onClick: async () => { await fetch("/api/history", { method: "DELETE" }); await loadHistory(); renderView(); toast("ok", "History cleared", ""); } }, [ic("trash"), " Clear history"]),
      ]),
      totalsCards,
      modelTable,
      batch,
      rows.length ? h("div", { class: "table-wrap", style: { marginTop: "16px" } }, [
        h("table", { class: "hist" }, [
          h("thead", {}, [h("tr", {}, ["", "Name", "Model", "Time", "Tokens", "Pages (OCR/total)", ""].map((c) => h("th", { text: c })))]),
          h("tbody", {}, fileRows),
        ])]) : h("div", { class: "table-wrap" }, [h("div", { class: "queue-empty", style: { padding: "48px 20px" } }, [ic("clock"), h("p", { text: "No conversions yet in this window." })])]),
      h("div", { class: "hist-note" }, [ic("lock"), " Stored locally for the retention window you chose, then auto-deleted. Nothing leaves your machine."]),
    ]);
  }

  // ---- settings view ----
  function settingsView() {
    const s = state.settings;
    const dim = (on) => ({ opacity: on ? "1" : "0.5", pointerEvents: on ? "auto" : "none" });
    const sw = (on, fn) => h("button", { class: "switch" + (on ? " on" : ""), role: "switch", "aria-checked": String(on), onClick: fn }, [h("i")]);

    const modelSelect = h("select", { class: "select", disabled: s.models.length === 0, onChange: (e) => setSetting({ model: e.target.value }) },
      s.models.length === 0 ? [h("option", { text: "— test connection to load models —" })] : s.models.map((m) => h("option", { value: m, text: m, selected: m === s.model })));

    let conn;
    if (s.connection === "ok") conn = h("span", { class: "conn conn--ok" }, [h("span", { class: "dot dot--ok" }), " Connected — ", h("span", { class: "mono", text: s.models.length + " models" }), " available"]);
    else if (s.connection === "err") conn = h("span", { class: "conn conn--err" }, [h("span", { class: "dot dot--err" }), " Not reachable — is " + s.provider + " running?"]);
    else if (s.connection === "testing") conn = h("span", { class: "conn conn--idle" }, [h("span", { class: "dot dot--accent dot--pulse" }), " Testing…"]);
    else conn = h("span", { class: "conn conn--idle" }, [h("span", { class: "dot dot--off" }), " Not tested yet"]);

    let ytStatus = null;
    const y = state.ytCookies;
    if (y) {
      if (y.checking) ytStatus = h("span", { class: "conn conn--idle" }, [h("span", { class: "dot dot--accent dot--pulse" }), " Checking…"]);
      else if (y.error) ytStatus = h("span", { class: "conn conn--err" }, [h("span", { class: "dot dot--err" }), " " + y.error]);
      else if (!y.configured) ytStatus = h("span", { class: "conn conn--idle" }, [h("span", { class: "dot dot--off" }), " No cookies set yet"]);
      else if (y.loggedIn) ytStatus = h("span", { class: "conn conn--ok" }, [h("span", { class: "dot dot--ok" }), ` ${y.count} cookies — looks logged in ✓`]);
      else ytStatus = h("span", { class: "conn conn--err" }, [h("span", { class: "dot dot--err" }), ` ${y.count} cookie(s), but no login session detected — re-export while logged in (the file option is more reliable than paste).`]);
    }

    return h("div", { class: "settings view-enter" }, [
      h("div", { class: "setcard" }, [
        h("div", { class: "setcard__head" }, [h("h2", {}, [ic("folder"), " Output"]), h("p", { text: "Where converted Markdown files are saved when you choose “Save to folder”." })]),
        h("div", { class: "setcard__body" }, [
          h("div", { class: "field" }, [
            h("label", { text: "Output folder" }),
            h("div", { class: "row" }, [
              h("input", { class: "input", type: "text", value: s.outputFolder, onChange: (e) => setSetting({ outputFolder: e.target.value }) }),
              h("button", { class: "btn btn--ghost", onClick: async () => {
                  try {
                    const r = await api("/api/pick-folder", { method: "POST" });
                    if (r.folder) { setSetting({ outputFolder: r.folder }); toast("ok", "Folder selected", r.folder); }
                  } catch (e) { toast("info", "Picker unavailable", "Type the path instead."); }
                } }, [ic("folder"), " Browse…"]),
              h("button", { class: "btn btn--ghost", onClick: async () => { try { await api("/api/open-folder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folder: s.outputFolder }) }); toast("ok", "Folder opened", s.outputFolder); } catch (e) { toast("info", "Could not open", String(e)); } } }, [ic("folderOpen"), " Open"]),
            ]),
            h("div", { class: "field__hint" }, ["Default suggestion: ", h("code", { text: "~/Documents/Markitdown Output" })]),
          ]),
          h("div", { class: "toggle-row" }, [sw(s.autoSave, () => setSetting({ autoSave: !s.autoSave })),
            h("div", { class: "toggle-text" }, [h("b", { text: "Auto-save converted files" }), h("span", { text: "Every converted file is written to the output folder automatically." })])]),
          h("div", { class: "toggle-row" }, [sw(s.tagSavedWithModel, () => setSetting({ tagSavedWithModel: !s.tagSavedWithModel })),
            h("div", { class: "toggle-text" }, [h("b", { text: "Tag saved files with the model" }), h("span", { text: "Append the vision model to OCR/AI filenames, e.g. report__qwen2.5-vl-7b.md. Files are never overwritten — a new version is saved." })])]),
        ]),
      ]),
      h("div", { class: "setcard" }, [
        h("div", { class: "setcard__head" }, [h("h2", {}, [ic("sparkle"), " OCR — image & scanned-PDF text"]), h("p", { text: "Uses a local vision model (Ollama or LM Studio). Nothing leaves your machine." })]),
        h("div", { class: "setcard__body" }, [
          h("div", { class: "toggle-row" }, [sw(s.ocrEnabled, () => setSetting(s.ocrEnabled ? { ocrEnabled: false, pdfMode: "fast" } : { ocrEnabled: true })),
            h("div", { class: "toggle-text" }, [h("b", { text: "Enable OCR" }), h("span", { text: "Extract text from scanned PDFs and images." })])]),
          h("div", { class: "field", style: dim(s.ocrEnabled) }, [
            h("label", {}, ["Provider endpoint ", h("span", { class: "opt", text: "(auto-detected)" })]),
            h("div", { class: "row" }, [
              h("select", { class: "select", onChange: (e) => setSetting({ provider: e.target.value, endpoint: e.target.value === "LM Studio" ? "http://localhost:1234/v1" : "http://localhost:11434/v1" }) },
                ["LM Studio", "Ollama"].map((p) => h("option", { value: p, text: p, selected: p === s.provider }))),
              h("input", { class: "input", type: "text", value: s.endpoint, onChange: (e) => setSetting({ endpoint: e.target.value }) }),
            ]),
          ]),
          h("div", { class: "field", style: dim(s.ocrEnabled) }, [
            h("label", { text: "Vision model" }),
            h("div", { class: "row" }, [modelSelect, h("button", { class: "btn btn--ghost", onClick: testConnection }, [ic("plug"), " Test connection"])]),
            h("div", { class: "row", style: { marginTop: "2px" } }, [conn]),
            h("div", { class: "field__hint" }, ["Start LM Studio or run ", h("code", { text: "ollama serve" }), ". Suggested model: ", h("code", { text: "qwen2.5vl:7b" }), "."]),
            h("div", { class: "field__hint", style: { color: "var(--accent-d)" }, text: "Tip: a vision model without “thinking” (e.g. qwen2.5-vl or a Gemma vision model) is faster and cleaner for OCR than a reasoning model." }),
          ]),
        ]),
      ]),
      h("div", { class: "setcard" }, [
        h("div", { class: "setcard__head" }, [h("h2", {}, [ic("file"), " PDF conversion"]),
          h("p", { text: "How PDF files are turned into Markdown." })]),
        h("div", { class: "setcard__body" }, [
          h("div", { class: "field" }, [
            h("label", { text: "Mode" }),
            h("div", { class: "seg" }, [
              h("button", { class: s.pdfMode !== "ai" ? "on" : "", onClick: () => setSetting({ pdfMode: "fast" }), text: "Fast — structured" }),
              h("button", { class: s.pdfMode === "ai" ? "on" : "", disabled: !s.ocrEnabled,
                style: !s.ocrEnabled ? { opacity: "0.5", cursor: "not-allowed" } : {},
                onClick: () => { if (s.ocrEnabled) setSetting({ pdfMode: "ai" }); }, text: "AI — vision model" }),
            ]),
            h("div", { class: "field__hint" }, [
              "Fast: instant, offline — structured headings + columns. AI: best layout, tables and reading order via the vision model — slower (one pass per page). ",
              !s.ocrEnabled ? h("b", { text: "Enable OCR above to use AI mode." }) : null]),
          ]),
        ]),
      ]),
      h("div", { class: "setcard" }, [
        h("div", { class: "setcard__head" }, [h("h2", {}, [ic("globe"), " YouTube transcripts"]),
          h("p", { text: "Optional. YouTube often blocks anonymous transcript requests; using your own cookies makes them look logged-in." })]),
        h("div", { class: "setcard__body" }, [
          h("div", { class: "field" }, [
            h("label", { text: "Paste cookies" }),
            h("textarea", { class: "input", rows: 4,
              placeholder: "Paste your cookies.txt content, or a “name=value; name2=value2” cookie string",
              style: { minHeight: "92px", resize: "vertical", fontFamily: "var(--font-mono)", fontSize: "12px" },
              value: s.youtubeCookiesText || "",
              onChange: (e) => setSetting({ youtubeCookiesText: e.target.value }) }),
          ]),
          h("div", { class: "field" }, [
            h("label", { text: "…or a cookies file" }),
            h("div", { class: "row" }, [
              h("input", { class: "input", type: "text", placeholder: "Path to a cookies.txt (optional)", value: s.youtubeCookies || "",
                onChange: (e) => setSetting({ youtubeCookies: e.target.value }) }),
              h("button", { class: "btn btn--ghost", onClick: async () => {
                  try { const r = await api("/api/pick-file", { method: "POST" });
                    if (r.path) { setSetting({ youtubeCookies: r.path }); toast("ok", "Cookies file set", r.path); } }
                  catch (e) { toast("info", "Picker unavailable", "Type the path instead."); }
                } }, [ic("folder"), " Browse…"]),
            ]),
          ]),
          h("div", { class: "field" }, [
            h("div", { class: "row" }, [
              h("button", { class: "btn btn--ghost", onClick: checkYtCookies }, [ic("check"), " Check cookies"]),
            ]),
            ytStatus ? h("div", { class: "row", style: { marginTop: "2px" } }, [ytStatus]) : null,
          ]),
          h("div", { class: "field__hint" }, [
            "Export with the free “Get cookies.txt LOCALLY” browser extension on youtube.com, then paste it above (or pick the file). ",
            h("b", { text: "Cookies are your logged-in session — keep them private." }),
            " They stay on your machine (pasted text is saved in your local settings) and are used only for YouTube. Pasted text takes priority over the file; re-export if it stops working.",
          ]),
        ]),
      ]),
      h("div", { class: "setcard" }, [
        h("div", { class: "setcard__head" }, [h("h2", {}, [ic("clock"), " History"]),
          h("p", { text: "Keep converted files (incl. the Markdown) so you can re-download them later." })]),
        h("div", { class: "setcard__body" }, [
          h("div", { class: "field" }, [
            h("label", { text: "Keep history for" }),
            h("select", { class: "select", onChange: (e) => setSetting({ historyRetentionDays: parseInt(e.target.value, 10) }) },
              [["0", "Off (session only)"], ["1", "1 day"], ["3", "3 days"], ["7", "7 days"], ["30", "30 days"]]
                .map(([v, t]) => h("option", { value: v, text: t, selected: String(s.historyRetentionDays) === v }))),
            h("div", { class: "field__hint", text: "Off stores nothing on disk (today's behavior). Otherwise converted Markdown is kept locally for the chosen window, then auto-deleted." }),
          ]),
        ]),
      ]),
    ]);
  }

  // ---- about view ----
  const SAVINGS = [
    { label: "20-page PDF report", note: "scanned + tables", raw: 38000, md: 9500 },
    { label: "Excel workbook", note: "40 rows × 8 cols", raw: 12000, md: 3200 },
    { label: "30-slide deck", note: "PowerPoint", raw: 22000, md: 5500 },
    { label: "Long web article", note: "blog / docs page", raw: 14000, md: 4200 },
  ];
  function aboutView() {
    const maxRaw = Math.max(...SAVINGS.map((s) => s.raw));
    const fmt = (n) => "≈" + n.toLocaleString("en-US");
    const why = (icon, title, text) => h("div", { class: "why-card" }, [h("div", { class: "why-card__ic" }, [ic(icon)]), h("b", { text: title }), h("p", { text })]);
    const rows = SAVINGS.map((s) => {
      const pct = Math.round((s.raw - s.md) / s.raw * 100);
      return h("div", { class: "srow" }, [
        h("div", { class: "srow__label" }, [h("b", { text: s.label }), h("span", { text: s.note })]),
        h("div", { class: "bars" }, [
          h("div", { class: "bar" }, [h("div", { class: "bar__track" }, [h("div", { class: "bar__fill bar__fill--raw", style: { width: (s.raw / maxRaw * 100) + "%" } })]), h("span", { class: "bar__val", text: fmt(s.raw) })]),
          h("div", { class: "bar" }, [h("div", { class: "bar__track" }, [h("div", { class: "bar__fill bar__fill--md", style: { width: (s.md / maxRaw * 100) + "%" } })]), h("span", { class: "bar__val" }, [h("b", { text: fmt(s.md) })])]),
        ]),
        h("div", { class: "srow__save", text: "−" + pct + "%" }),
      ]);
    });
    return h("div", { class: "about view-enter" }, [
      h("div", { class: "about-hero" }, [
        h("span", { class: "eyebrow", text: "About Markitdown" }),
        h("h1", {}, ["Turn any document into clean, token-efficient Markdown", h("span", { class: "reddot", text: "." })]),
        h("p", { class: "lead", text: "Markitdown converts your files and web links into clean Markdown, so you can paste high-quality context into AI assistants instead of uploading raw PDFs, spreadsheets and slide decks. Less noise, fewer tokens, sharper answers — and it all runs on your own machine." }),
      ]),
      h("div", { class: "about-sec-title", text: "Why Markdown for AI?" }),
      h("div", { class: "why-grid" }, [
        why("file", "Models read text, not files", "An AI can't open a PDF or spreadsheet directly — something has to turn it into text first. How that's done decides what the model actually sees."),
        why("coins", "Structure, minus the overhead", "Markdown keeps headings, tables and lists intact while dropping layout, encoding and repetition. Same meaning, a fraction of the characters."),
        why("sparkle", "You control the context", "Paste exactly the clean Markdown you need into ChatGPT, Claude or Gemini — no bloated uploads, fewer tokens spent, room left to reason."),
      ]),
      h("div", { class: "savings" }, [
        h("div", { class: "savings__head" }, [h("span", { class: "savings__ic" }, [ic("coins")]), h("div", {}, [h("h2", { text: "How many tokens you save" }), h("p", { text: "AI tools bill by the token — roughly four characters each. A raw document carries formatting and repetition the model never needs. Converting to Markdown keeps the meaning in far fewer tokens, so every prompt costs less." })])]),
        h("div", { class: "bar__legend" }, [
          h("span", {}, [h("i", { class: "legdot", style: { background: "var(--line-strong)" } }), " Sent raw to the AI"]),
          h("span", {}, [h("i", { class: "legdot", style: { background: "var(--accent)" } }), " Converted to Markdown"]),
        ]),
        h("div", { class: "savings__rows" }, rows),
        h("div", { class: "savings__note" }, [ic("info"), " Illustrative estimates (≈ 4 characters per token). Actual savings depend on the document and how it's extracted."]),
      ]),
      h("div", { class: "about-formats" }, [
        h("h2", { text: "Works with the formats you already use" }),
        h("p", { text: "One tool for documents, data, slides, pages and more:" }),
        h("div", { class: "chips" }, ["PDF", "Word", "Excel", "PowerPoint", "CSV", "HTML", "JSON", "XML", "EPUB", "Images", "ZIP", "Web link", "YouTube"].map((f) => h("span", { class: "fmt", text: f }))),
      ]),
      h("div", { class: "about-privacy" }, [h("span", { class: "ap-ic" }, [ic("lock")]), h("div", {}, [h("h2", { text: "Nothing leaves your machine" }), h("p", { text: "Markitdown runs as a small local server on your own computer. Files are converted on-device and never uploaded. History is kept locally for the retention window you choose in Settings (default 7 days), then auto-deleted — or set it to Off for session-only." })])]),
      h("div", { class: "about-foot" }, [
        h("span", { class: "mono", text: "Version 2.0.0" }), h("span", { class: "sep" }), "Powered by Microsoft MarkItDown",
        h("span", { class: "sep" }), h("span", {}, ["Made by ", h("strong", { text: "CAIO Group" })]),
        h("a", { href: "https://wearecaio.com", target: "_blank", rel: "noopener", text: "wearecaio.com →" }),
      ]),
    ]);
  }

  // ---------- render orchestration ----------
  function viewNode() {
    if (state.view === "history") return historyView();
    if (state.view === "settings") return settingsView();
    if (state.view === "about") return aboutView();
    return convertView();
  }
  function renderView() {
    const content = document.querySelector(".content");
    if (content) content.replaceChildren(viewNode());
    // refresh sidebar (nav active state, converting badge, status LEDs)
    const shell = document.querySelector(".app");
    const oldSide = shell.querySelector(".sidebar");
    oldSide.replaceWith(renderSidebar());
    // topbar title
    const t = TITLES[state.view];
    document.querySelector(".topbar__title").textContent = t[0];
    document.querySelector(".topbar__sub").textContent = t[1];
  }
  function renderAll() {
    document.documentElement.dataset.theme = state.theme;
    const root = document.getElementById("root");
    const t = TITLES[state.view];
    root.replaceChildren(
      h("div", { class: "app" }, [
        h("input", { id: "fileInput", type: "file", multiple: true, style: { display: "none" },
          onChange: (e) => { if (e.target.files.length) [...e.target.files].forEach(convertFile); e.target.value = ""; } }),
        renderSidebar(),
        h("div", { class: "main" }, [
          h("header", { class: "topbar" }, [h("div", {}, [h("h1", { class: "topbar__title", text: t[0] }), h("div", { class: "topbar__sub", text: t[1] })])]),
          h("div", { class: "scroll" }, [
            h("div", { class: "content" }, [viewNode()]),
            h("div", { class: "footer" }, [
              h("span", {}, ["Powered by ", h("strong", { text: "Microsoft MarkItDown" }), " · runs entirely on your machine"]),
              h("span", { style: { marginLeft: "auto" } }, ["Made by ", h("strong", { text: "CAIO Group" }), " ", h("span", { class: "reddot", text: "·" }), " ", h("a", { href: "https://wearecaio.com", target: "_blank", rel: "noopener", text: "wearecaio.com" })]),
            ]),
          ]),
        ]),
      ]),
    );
    if (!document.querySelector(".toasts")) document.body.append(h("div", { class: "toasts" }));
  }

  // ---------- boot ----------
  async function boot() {
    // optional deep-link: ?view=convert|history|settings|about & ?theme=light|dark
    const qp = new URLSearchParams(location.search);
    const qpView = qp.get("view");
    if (["convert", "history", "settings", "about"].includes(qpView)) state.view = qpView;
    const qpTheme = qp.get("theme");
    if (qpTheme === "light" || qpTheme === "dark") state.theme = qpTheme;
    document.documentElement.dataset.theme = state.theme;
    await loadSettings();
    // reflect detected OCR engine in the sidebar without forcing OCR on
    try {
      const st = await api("/api/ocr-status");
      if (st.provider) state.settings.provider = st.provider === "ollama" ? "Ollama" : "LM Studio";
      if (st.endpoint && !state.settings.endpoint) state.settings.endpoint = st.endpoint;
    } catch (_) {}
    renderAll();
  }
  document.addEventListener("DOMContentLoaded", boot);
})();
