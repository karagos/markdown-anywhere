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
    linkValue: "", dnd: null,
    settings: {
      outputFolder: "~/Documents/Markitdown Output", autoSave: false,
      ocrEnabled: false, provider: "LM Studio", endpoint: "http://localhost:1234/v1",
      model: "", models: [], connection: "idle",
    },
  };

  // ---------- derived ----------
  const doneItems = () => state.queue.filter((it) => it.status === "done");
  const selectedDone = () => state.queue.filter((it) => it.selected && it.status === "done");
  const sessionSaved = () => state.history.reduce((s, hh) => s + L.estSaved(hh.kind, hh.tokens), 0);

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
    item.error = res.error || "";
    if (res.status === "done") {
      item.chars = item.markdown.length;
      item.tokens = L.estTokens(item.chars);
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

  async function convertFile(file) {
    const d = L.detectType(file.name);
    const item = { id: uid(), name: file.name, kind: d.kind, iconLabel: d.label, typeLabel: d.type,
      size: file.size, status: "converting", ocr: state.settings.ocrEnabled, markdown: "", selected: false };
    state.queue.unshift(item);
    renderView();
    try {
      const fd = new FormData();
      fd.append("file", file);
      const o = ocrFields();
      fd.append("ocr_enabled", o.ocr_enabled);
      if (o.endpoint) fd.append("endpoint", o.endpoint);
      fd.append("model", o.model);
      const data = await api("/api/convert", { method: "POST", body: fd });
      const results = data.results || [];
      if (!results.length) { item.status = "error"; item.errorShort = "No result"; }
      else {
        applyResult(item, results[0]);
        for (let i = 1; i < results.length; i++) {
          const r = results[i]; const dd = L.detectType(r.name);
          const sub = { id: uid(), name: r.name, kind: dd.kind, iconLabel: dd.label, typeLabel: dd.type,
            size: null, status: r.status, markdown: r.markdown || "", selected: false };
          if (r.status === "done") { sub.chars = sub.markdown.length; sub.tokens = L.estTokens(sub.chars); addHistory(sub); }
          state.queue.splice(state.queue.indexOf(item) + i, 0, sub);
        }
      }
      if (item.status === "done") toast("ok", "Conversion complete", "Markdown is ready to preview.");
    } catch (e) { item.status = "error"; item.errorShort = String(e); }
    renderView();
  }

  async function convertLink() {
    const url = state.linkValue.trim(); if (!url) return;
    const clean = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const isYt = /youtube\.com|youtu\.be/i.test(url);
    const item = { id: uid(), name: clean.length > 42 ? clean.slice(0, 42) + "…" : clean, kind: "web",
      iconLabel: "WEB", typeLabel: isYt ? "YouTube" : "Web link", size: null, status: "converting", ocr: false, markdown: "", selected: false };
    state.queue.unshift(item);
    state.linkValue = ""; renderView();
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

  async function autoSave(item) {
    try {
      await api("/api/save", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder: state.settings.outputFolder, files: [{ name: L.mdFilename(item.name), markdown: item.markdown }] }) });
    } catch (_) {}
  }

  // ---------- item / batch actions ----------
  function findItem(id) { return state.queue.find((x) => x.id === id) || state.history.find((x) => x.id === id); }

  async function onAction(id, action) {
    if (action === "goto-settings") { state.view = "settings"; renderAll(); return; }
    if (action === "remove") { state.queue = state.queue.filter((it) => it.id !== id); if (state.previewId === id) state.previewId = null; renderView(); return; }
    const it = findItem(id); if (!it) return;
    if (action === "copy") { try { await navigator.clipboard.writeText(it.markdown); } catch (_) {} toast("ok", "Copied to clipboard", L.fmtNum(it.markdown.length) + " chars"); }
    if (action === "download") { downloadBlob(new Blob([it.markdown], { type: "text/markdown" }), L.mdFilename(it.name)); toast("ok", "Saved .md file", L.mdFilename(it.name)); }
    if (action === "save") { await saveToFolder([it]); }
    if (action === "preview") {
      state.view = "convert";
      if (!state.queue.find((x) => x.id === id)) state.queue.unshift({ ...it, status: "done", chars: it.markdown.length, tokens: it.tokens, selected: false });
      state.previewId = id; state.previewMode = "rendered"; renderAll();
    }
  }

  async function saveToFolder(items) {
    const files = items.filter((x) => x.status === "done").map((x) => ({ name: L.mdFilename(x.name), markdown: x.markdown }));
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
      let fn = L.mdFilename(it.name);
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

  // ===================================================================
  // RENDER
  // ===================================================================
  const TITLES = {
    convert: ["Convert", "Drop a document, get clean Markdown."],
    history: ["History", "Conversions from this session."],
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

  // ---- sidebar ----
  function renderSidebar() {
    const s = state.settings;
    const nav = [["convert", "Convert", "convert"], ["history", "History", "clock"], ["settings", "Settings", "settings"], ["about", "About", "info"]]
      .map(([id, label, icon]) => {
        const converting = state.queue.filter((q) => q.status === "converting").length;
        return h("button", { class: "nav__item" + (state.view === id ? " is-active" : ""), onClick: () => { state.view = id; renderAll(); } },
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
          h("a", { href: "#", onClick: (e) => e.preventDefault() }, ["wearecaio.com ", ic("arrowUR")])]),
      ]),
    ]);
  }

  function setTheme(t) { state.theme = t; try { localStorage.setItem("mid-theme", t); } catch (_) {} document.documentElement.dataset.theme = t; renderAll(); }

  // ---- convert view ----
  function savingsStrip() {
    const saved = sessionSaved(), count = state.history.length;
    if (count === 0) {
      return h("div", { class: "savings-strip savings-strip--empty" }, [
        h("span", { class: "ss-ic" }, [ic("coins")]),
        h("div", { class: "ss-main" }, [
          h("div", { class: "ss-num-empty", text: "Track the tokens you save" }),
          h("div", { class: "ss-sub", text: "Convert a file or link to start counting — clean Markdown costs far fewer tokens than raw uploads." }),
        ]),
      ]);
    }
    return h("div", { class: "savings-strip" }, [
      h("span", { class: "ss-ic" }, [ic("coins")]),
      h("div", { class: "ss-main" }, [
        h("div", { class: "ss-num" }, [h("b", { text: "≈ " + L.fmtNum(saved) }), " tokens saved this session"]),
        h("div", { class: "ss-sub", text: `across ${count} conversion${count !== 1 ? "s" : ""} — vs. sending the raw files to your AI` }),
      ]),
      h("span", { class: "ss-hint", title: "Rough estimate (≈ 4 characters per token)", text: "estimate" }),
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
    if (item.status === "converting") meta.append(h("span", { style: { color: "var(--warn)", fontWeight: "500" }, text: item.ocr ? "Converting (OCR)…" : "Converting…" }));
    else if (item.status === "error") meta.append(h("span", { style: { color: "var(--err)" }, text: item.errorShort || "Error" }));
    else if (item.status === "queued") meta.append(h("span", { text: item.typeLabel + " · waiting…" }));
    else meta.append(h("span", { text: item.typeLabel }), h("span", { class: "sep", text: "·" }),
      h("span", { class: "mono", text: L.fmtNum(item.chars || 0) + " chars" }), h("span", { class: "sep", text: "·" }),
      h("span", { class: "mono", text: "~" + L.fmtNum(item.tokens || 0) + " tok" }));

    const nameRow = h("div", { class: "qname-row" }, [h("span", { class: "qname", text: item.name }), item.ocr && item.status === "done" ? h("span", { class: "ocr-badge", text: "OCR" }) : null]);
    const body = h("div", { class: "qbody", style: { cursor: item.status === "done" ? "pointer" : "default" },
      onClick: () => { if (item.status === "done") { state.previewId = item.id; renderView(); } } }, [nameRow, meta]);
    if (item.status === "converting") body.append(h("div", { class: "progress indet" }, [h("i")]));
    if (item.status === "error" && item._expanded) body.append(h("div", { class: "errdetail", text: item.errorDetail || "" }));

    const actions = h("div", { class: "qactions" });
    if (item.status === "done") {
      actions.append(
        h("button", { class: "btn btn--quiet btn--sm btn--icon", title: "Preview", onClick: () => { state.previewId = item.id; renderView(); } }, [ic("eye")]),
        h("button", { class: "btn btn--quiet btn--sm btn--icon", title: "Copy Markdown", onClick: () => onAction(item.id, "copy") }, [ic("copy")]),
        h("button", { class: "btn btn--quiet btn--sm btn--icon", title: "Download .md", onClick: () => onAction(item.id, "download") }, [ic("download")]),
        h("button", { class: "btn btn--quiet btn--sm btn--icon", title: "Rename", onClick: () => startRename(item) }, [ic("pencil")]));
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
        ]),
        h("span", { class: "saved-badge", title: "Estimated tokens saved vs. the raw file" }, [ic("coins"), " saves ~" + L.fmtNum(L.estSaved(item.kind, item.tokens)) + " tok"]));
    }
    const body = h("div", { class: "preview__body" });
    if (!item) {
      body.append(h("div", { class: "preview__empty" }, [h("div", { class: "dropzone__icon" }, [ic("eye")]),
        h("h3", { text: "Nothing to preview yet" }), h("p", { text: "Select a converted item to see its clean Markdown." })]));
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
  function historyView() {
    if (state.history.length === 0) {
      return h("div", { class: "view-enter", style: { maxWidth: "760px" } }, [
        h("div", { class: "table-wrap" }, [h("div", { class: "queue-empty", style: { padding: "56px 20px" } }, [ic("clock"), h("p", { text: "Your conversions this session will appear here." })])]),
      ]);
    }
    const rows = state.history.map((hh) => h("tr", {}, [
      h("td", {}, [h("div", { class: "hist__name" }, [fileTile(hh.kind, hh.kind === "web" ? null : hh.iconLabel), h("span", { text: hh.name })])]),
      h("td", {}, [h("span", { class: "hist__type", text: hh.typeLabel + (hh.ocr ? " (OCR)" : "") })]),
      h("td", {}, [h("span", { class: "hist__when", text: hh.when })]),
      h("td", {}, [h("span", { class: "hist__tok", text: "~" + L.fmtNum(hh.tokens) + " tok" })]),
      h("td", {}, [statusPill(hh.status)]),
      h("td", {}, [h("div", { class: "hist__act" }, [
        h("button", { class: "btn btn--quiet btn--sm btn--icon", title: "Preview", onClick: () => onAction(hh.id, "preview") }, [ic("eye")]),
        h("button", { class: "btn btn--quiet btn--sm btn--icon", title: "Re-download .md", onClick: () => onAction(hh.id, "download") }, [ic("download")]),
        h("button", { class: "btn btn--quiet btn--sm btn--icon", title: "Save to folder", onClick: () => onAction(hh.id, "save") }, [ic("save")]),
      ])]),
    ]));
    return h("div", { class: "view-enter", style: { maxWidth: "920px" } }, [
      h("div", { class: "hist-bar" }, [
        h("span", { class: "eyebrow", text: state.history.length + " conversion" + (state.history.length !== 1 ? "s" : "") + " this session" }),
        h("button", { class: "btn btn--danger btn--sm", onClick: () => { state.history = []; renderView(); toast("ok", "History cleared", "This session's record was removed."); } }, [ic("trash"), " Clear history"]),
      ]),
      h("div", { class: "table-wrap" }, [h("table", { class: "hist" }, [
        h("thead", {}, [h("tr", {}, ["Name", "Type", "When", "Size", "Status", ""].map((c) => h("th", { text: c })))]),
        h("tbody", {}, rows),
      ])]),
      h("div", { class: "hist-note" }, [ic("lock"), " History is kept only for this session — it clears when the app restarts. Nothing is stored on disk unless you save it."]),
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
        ]),
      ]),
      h("div", { class: "setcard" }, [
        h("div", { class: "setcard__head" }, [h("h2", {}, [ic("sparkle"), " OCR — image & scanned-PDF text"]), h("p", { text: "Uses a local vision model (Ollama or LM Studio). Nothing leaves your machine." })]),
        h("div", { class: "setcard__body" }, [
          h("div", { class: "toggle-row" }, [sw(s.ocrEnabled, () => setSetting({ ocrEnabled: !s.ocrEnabled })),
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
      h("div", { class: "about-privacy" }, [h("span", { class: "ap-ic" }, [ic("lock")]), h("div", {}, [h("h2", { text: "Nothing leaves your machine" }), h("p", { text: "Markitdown runs as a small local server on your own computer. Files are converted on-device and never uploaded. History is kept only for the current session and cleared when you restart." })])]),
      h("div", { class: "about-foot" }, [
        h("span", { class: "mono", text: "Version 2.0.0" }), h("span", { class: "sep" }), "Powered by Microsoft MarkItDown",
        h("span", { class: "sep" }), h("span", {}, ["Made by ", h("strong", { text: "CAIO Group" })]),
        h("a", { href: "#", onClick: (e) => e.preventDefault(), text: "wearecaio.com →" }),
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
              h("span", { style: { marginLeft: "auto" } }, ["Made by ", h("strong", { text: "CAIO Group" }), " ", h("span", { class: "reddot", text: "·" }), " ", h("a", { href: "#", onClick: (e) => e.preventDefault(), text: "wearecaio.com" })]),
            ]),
          ]),
        ]),
      ]),
    );
    if (!document.querySelector(".toasts")) document.body.append(h("div", { class: "toasts" }));
  }

  // ---------- boot ----------
  async function boot() {
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
