// Inline line-style icon set (ported from the design's icons.jsx).
// svgIcon(name) returns a fresh <svg> element built from trusted static markup.
(function () {
  const VB = 24, SW = 1.6;
  const P = {
    convert: '<path d="M4 8h13M4 8l3-3M4 8l3 3"/><path d="M20 16H7M20 16l-3-3M20 16l-3 3"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5l1.2 2.3 2.5-.6.3 2.6 2.3 1.2-1 2.4 1 2.4-2.3 1.2-.3 2.6-2.5-.6L12 21.5l-1.2-2.3-2.5.6-.3-2.6L5.7 16l1-2.4-1-2.4 2.3-1.2.3-2.6 2.5.6z"/>',
    upload: '<path d="M12 16V4m0 0l-4 4m4-4l4 4"/><path d="M4 14v3a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-3"/>',
    link: '<path d="M9.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1.2 1.2"/><path d="M14.5 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1.2-1.2"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    download: '<path d="M12 4v11m0 0l-4-4m4 4l4-4"/><path d="M4 18h16"/>',
    eye: '<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/>',
    pencil: '<path d="M14.5 5.5l4 4M4 20l1-4L16 5a2 2 0 0 1 3 0 2 2 0 0 1 0 3L8 19z"/>',
    check: '<path d="M4 12.5l5 5L20 6.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    alert: '<path d="M12 3.5l9.5 16.5H2.5L12 3.5z"/><path d="M12 10v4.5M12 17.4v.1"/>',
    grip: '<circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h6a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    folderOpen: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h6a2 2 0 0 1 2 2"/><path d="M3.5 9h17.2a1 1 0 0 1 .97 1.24l-1.6 6.5A1.5 1.5 0 0 1 18.6 18H5a2 2 0 0 1-2-2z"/>',
    file: '<path d="M6 3h8l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M13 3v5h5"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.5 2.5 14.5 0 17M12 3.5c-2.5 2.5-2.5 14.5 0 17"/>',
    merge: '<path d="M6 4v5a4 4 0 0 0 4 4h8m0 0l-3-3m3 3l-3 3"/><path d="M6 20v-5"/>',
    zip: '<path d="M6 3h8l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M10 3v2m0 1v2m0 1v2"/>',
    trash: '<path d="M4 6.5h16M9 6.5V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v1.5M6.5 6.5l.8 12a2 2 0 0 0 2 1.8h5.4a2 2 0 0 0 2-1.8l.8-12"/>',
    save: '<path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>',
    plug: '<path d="M9 3v5M15 3v5M7 8h10v2a5 5 0 0 1-10 0z"/><path d="M12 15v6"/>',
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
    inbox: '<path d="M3 13l3-8a2 2 0 0 1 1.9-1.4h8.2A2 2 0 0 1 18 5l3 8v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 13h5l1.5 2.5h5L16 13h5"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.1"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14-4.5L4 8M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14 4.5L20 16M20 20v-4h-4"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"/>',
    moon: '<path d="M20 13.5A8 8 0 0 1 10.5 4a7 7 0 1 0 9.5 9.5z"/>',
    arrowUR: '<path d="M7 17L17 7M8 7h9v9"/>',
    coins: '<ellipse cx="9" cy="7" rx="6" ry="3"/><path d="M3 7v5c0 1.66 2.7 3 6 3s6-1.34 6-3V7"/><path d="M15 11.5c2.5.3 6 1.4 6 3.5 0 1.66-2.7 3-6 3-1.2 0-2.3-.18-3.2-.48"/>',
  };

  function svgIcon(name) {
    const special = name === "grip"; // grip is filled, no stroke
    const fill = special ? "currentColor" : "none";
    const stroke = special ? "none" : "currentColor";
    const sw = special ? 0 : SW;
    const markup =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VB} ${VB}" fill="${fill}" ` +
      `stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">` +
      (P[name] || "") + `</svg>`;
    const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
    return doc.documentElement;
  }

  window.svgIcon = svgIcon;
})();
