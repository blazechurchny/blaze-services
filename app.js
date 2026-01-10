const LIST_FN_URL = "https://us-central1-blaze-service-archives.cloudfunctions.net/listDropbox";
const LINK_FN_URL = "https://us-central1-blaze-service-archives.cloudfunctions.net/getDropboxSharedRaw";

const $grid = document.getElementById("grid");
const $meta = document.getElementById("meta");
const $q = document.getElementById("q");
const $reload = document.getElementById("reload");

const ROOT_PATH = "/Livestream Recordings";

let currentPath = ROOT_PATH;
let currentData = { folders: [], videos: [] };

// simple cache so we don’t hammer the function
const rawCache = new Map(); // path_lower -> raw url

const fmtDate = (iso) => {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso || "";
  }
};

const fmtSizeMB = (bytes) => `${Math.round((bytes || 0) / 1024 / 1024)} MB`;

function escapeHtml(s = "") {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function ext(name = "") {
  const i = String(name).lastIndexOf(".");
  return i >= 0 ? String(name).slice(i + 1).toLowerCase() : "";
}

function canPreviewThumb(name = "") {
  // Best-effort thumbnail formats browsers usually decode
  return ["mp4", "mov", "m4v", "webm"].includes(ext(name));
}

/* ---------------------------
   Modal Player (in-page)
---------------------------- */
function ensureModal() {
  let m = document.getElementById("playerModal");
  if (m) return m;

  m = document.createElement("div");
  m.id = "playerModal";
  m.style.cssText = `
    position:fixed; inset:0; display:none;
    align-items:center; justify-content:center;
    background: rgba(0,0,0,.72);
    padding: 18px; z-index: 9999;
  `;

  m.innerHTML = `
    <div id="playerBox" style="
      width: min(980px, 100%);
      background: rgba(15, 18, 28, .98);
      border: 1px solid rgba(255,255,255,.14);
      border-radius: 16px;
      overflow:hidden;
      box-shadow: 0 30px 120px rgba(0,0,0,.65);
    ">
      <div style="
        display:flex; align-items:center; justify-content:space-between;
        gap: 10px;
        padding: 12px 14px;
        border-bottom: 1px solid rgba(255,255,255,.10);
      ">
        <div id="playerTitle" style="
          font-weight: 800; font-size: 14px; opacity:.95;
          overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
        ">Video</div>
        <div style="display:flex; gap: 8px;">
          <button id="playerNewTab" class="btn" style="padding:10px 12px;">Open</button>
          <button id="playerClose" class="btn" style="padding:10px 12px;">Close</button>
        </div>
      </div>

      <div style="background:#000;">
        <video id="playerVideo" controls playsinline autoplay style="width:100%; display:block; background:#000"></video>
      </div>

      <div id="playerNote" style="
        padding: 10px 14px; font-size: 12px; opacity:.75;
        border-top: 1px solid rgba(255,255,255,.08);
        display:none;
      "></div>
    </div>
  `;

  document.body.appendChild(m);

  m.addEventListener("click", (e) => {
    if (e.target === m) closeModal();
  });

  document.getElementById("playerClose").addEventListener("click", closeModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  return m;
}

function openModal(title, url) {
  ensureModal();
  const m = document.getElementById("playerModal");
  const t = document.getElementById("playerTitle");
  const v = document.getElementById("playerVideo");
  const note = document.getElementById("playerNote");
  const openBtn = document.getElementById("playerNewTab");

  t.textContent = title || "Video";
  note.style.display = "none";
  note.textContent = "";

  openBtn.onclick = () => window.open(url, "_blank", "noopener");

  try { v.pause(); } catch {}
  v.removeAttribute("src");
  v.load();

  v.src = url;
  v.load();

  m.style.display = "flex";

  // If it fails to play (codec, MKV, etc), show note
  v.onerror = () => {
    note.style.display = "block";
    note.textContent = "If this won’t play here, hit Open (browser codec support varies — MKV is the usual culprit).";
  };
}

function closeModal() {
  const m = document.getElementById("playerModal");
  if (!m) return;
  const v = document.getElementById("playerVideo");

  if (v) {
    try { v.pause(); } catch {}
    v.removeAttribute("src");
    v.load();
  }

  m.style.display = "none";
}

/* ---------------------------
   Data loading
---------------------------- */
async function loadList() {
  $grid.innerHTML = `<div class="notice">Loading…</div>`;

  const url = `${LIST_FN_URL}?path=${encodeURIComponent(currentPath)}`;
  const res = await fetch(url);
  const data = await res.json();

  if (!data.ok) throw new Error(data.error || "Failed to load list");

  currentData = data;
  render();
  hydrateThumbs(); // best-effort; doesn’t block
}

async function getRawUrl(path) {
  if (rawCache.has(path)) return rawCache.get(path);

  const res = await fetch(LINK_FN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });

  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(data.error || "Failed to get shared link");

  rawCache.set(path, data.url);
  return data.url;
}

/* ---------------------------
   Rendering
---------------------------- */
function render() {
  const search = ($q?.value || "").toLowerCase().trim();

  const folders = (currentData.folders || []).filter((f) => {
    if (!search) return true;
    return (f.name || "").toLowerCase().includes(search);
  });

  const videos = (currentData.videos || []).filter((v) => {
    if (!search) return true;
    return (v.name || "").toLowerCase().includes(search);
  });

  $meta.textContent = `${currentPath} • ${folders.length} folders • ${videos.length} videos`;

  const backBtn =
    currentPath !== ROOT_PATH
      ? `<button class="btn" data-back style="margin-bottom:14px">⬅ Back</button>`
      : "";

  const folderHtml = folders
    .map(
      (f) => `
      <div class="card">
        <div class="title">📁 ${escapeHtml(f.name)}</div>
        <button class="btn" data-folder="${escapeHtml(f.path_lower)}">Open Folder</button>
      </div>
    `
    )
    .join("");

  const videoHtml = videos
    .map((v) => {
      const e = ext(v.name).toUpperCase();
      const canThumb = canPreviewThumb(v.name);

      return `
      <div class="card">
        <div class="thumbWrap" data-thumb="${escapeHtml(v.path_lower)}" data-name="${escapeHtml(v.name)}">
          ${
            canThumb
              ? `<div class="thumbPlaceholder">Loading…</div>`
              : `<div class="thumbPlaceholder">${escapeHtml(e || "VIDEO")}</div>`
          }
          <div class="thumbOverlay">▶</div>
        </div>

        <div class="title">🎬 ${escapeHtml(v.name)}</div>
        <div class="sub">
          <span>${fmtDate(v.server_modified)}</span>
          <span>${fmtSizeMB(v.size)}</span>
        </div>

        <button class="btn" data-open="${escapeHtml(v.path_lower)}" data-title="${escapeHtml(v.name)}">Open</button>
      </div>
    `;
    })
    .join("");

  $grid.innerHTML =
    backBtn + folderHtml + videoHtml || `<div class="notice">Nothing here.</div>`;
}

async function hydrateThumbs() {
  // Only hydrate preview-able ones; MKVs get placeholders
  const nodes = Array.from(document.querySelectorAll(".thumbWrap[data-thumb]"));

  const MAX = 6;
  let i = 0;

  async function worker() {
    while (i < nodes.length) {
      const n = nodes[i++];
      const path = n.getAttribute("data-thumb") || "";
      const name = n.getAttribute("data-name") || "";

      if (!canPreviewThumb(name)) continue;
      if (n.querySelector("video.thumb")) continue;

      try {
        const url = await getRawUrl(path);
        n.innerHTML = `
          <video class="thumb" muted playsinline preload="metadata" src="${escapeHtml(url)}#t=0.2"></video>
          <div class="thumbOverlay">▶</div>
        `;
      } catch {
        n.innerHTML = `
          <div class="thumbPlaceholder">No preview</div>
          <div class="thumbOverlay">▶</div>
        `;
      }
    }
  }

  await Promise.all(Array.from({ length: MAX }, worker));
}

/* ---------------------------
   Click handling
---------------------------- */
document.addEventListener("click", async (e) => {
  const folderBtn = e.target.closest("button[data-folder]");
  if (folderBtn) {
    currentPath = folderBtn.dataset.folder;
    await loadList().catch((err) => alert(err.message));
    return;
  }

  const backBtn = e.target.closest("button[data-back]");
  if (backBtn) {
    const parts = currentPath.split("/").filter(Boolean);
    parts.pop();
    currentPath = "/" + parts.join("/");
    if (currentPath === "/" || currentPath === "") currentPath = ROOT_PATH;
    await loadList().catch((err) => alert(err.message));
    return;
  }

  // Click thumbnail -> open in-page modal
  const thumb = e.target.closest(".thumbWrap[data-thumb]");
  if (thumb) {
    const path = thumb.getAttribute("data-thumb");
    const name = thumb.getAttribute("data-name") || "Video";
    try {
      const url = await getRawUrl(path);
      openModal(name, url);
    } catch (err) {
      alert(err.message);
    }
    return;
  }

  // Open button -> new tab
  const openBtn = e.target.closest("button[data-open]");
  if (openBtn) {
    const path = openBtn.dataset.open;
    const title = openBtn.dataset.title || "Video";
    try {
      openBtn.disabled = true;
      const old = openBtn.textContent;
      openBtn.textContent = "Loading…";

      const url = await getRawUrl(path);
      window.open(url, "_blank", "noopener");

      openBtn.textContent = old;
    } catch (err) {
      alert(err.message);
    } finally {
      openBtn.disabled = false;
    }
  }
});

$q?.addEventListener("input", () => render());
$reload?.addEventListener("click", () => loadList().catch((err) => alert(err.message)));

loadList().catch((e) => {
  $meta.textContent = "Error";
  $grid.innerHTML = `<div class="notice">Error: ${escapeHtml(e.message)}</div>`;
});
