/**
 * Platenko Unified Admin CMS (/admin)
 * - D1 + PBKDF2 Session Auth
 * - Non-destructive 4-Point Perspective Crop (always preserves original & creates a copy)
 * - Album Photo Manager (set cover, crop-to-copy, 3D Cover Studio copy, add/remove photos)
 * - Live 220 cm Sofa Scale Preview, Dimensions, Metadata & Inventory Reordering
 */
(function () {
  "use strict";

  let artworks = [];
  let editingId = null;

  // Album photos for currently edited/new artwork (existing relative URLs or new data:image/*)
  let albumPhotos = [];
  let pendingThumbMap = {}; // hiresDataUrl -> 600px thumbDataUrl
  let pendingRawDataUrl = null;
  let currentRawUrl = "";

  const dom = {};
  function cacheDom() {
    dom.authOverlay = document.getElementById("adminAuthOverlay");
    dom.loginForm = document.getElementById("adminLoginForm");
    dom.loginUser = document.getElementById("adminLoginUsername");
    dom.loginPass = document.getElementById("adminLoginPassword");
    dom.authError = document.getElementById("adminAuthError");
    dom.loginSubmit = document.getElementById("adminLoginSubmit");

    dom.main = document.getElementById("adminMain");
    dom.logoutBtn = document.getElementById("adminLogoutBtn");
    dom.sorterLink = document.getElementById("adminSorterLink");

    dom.formHeading = document.getElementById("admFormHeading");
    dom.resetFormBtn = document.getElementById("admResetFormBtn");
    dom.form = document.getElementById("admArtworkForm");
    dom.dropzone = document.getElementById("admDropzone");
    dom.cameraBtn = document.getElementById("admCameraBtn");
    dom.fileBtn = document.getElementById("admFileBtn");
    dom.cameraInput = document.getElementById("cameraCaptureInput");
    dom.fileInput = document.getElementById("fileUploadInput");
    dom.previewRow = document.getElementById("admPreviewRow");
    dom.coverPreview = document.getElementById("admCoverPreview");
    dom.coverSourceTag = document.getElementById("admCoverSourceTag");
    dom.rewarpBtn = document.getElementById("admRewarpBtn");
    dom.open3DCoverBtn = document.getElementById("admOpen3DCoverBtn");

    dom.albumSection = document.getElementById("admAlbumPhotosSection");
    dom.photoCount = document.getElementById("admPhotoCount");
    dom.photoGrid = document.getElementById("admPhotoGrid");
    dom.addPhotosBtn = document.getElementById("admAddPhotosBtn");
    dom.addPhotosInput = document.getElementById("admAddPhotosInput");

    dom.width = document.getElementById("admWidth");
    dom.height = document.getElementById("admHeight");
    dom.depth = document.getElementById("admDepth");
    dom.presets = Array.from(document.querySelectorAll("#admPresets .preset-chip"));
    dom.sofaPreview = document.getElementById("admSofaPreview");
    dom.previewPaint = document.getElementById("admPreviewPaint");
    dom.previewPaintDims = document.getElementById("admPreviewPaintDims");
    dom.previewSofa = document.getElementById("admPreviewSofa");
    dom.previewLabel = document.getElementById("admPreviewLabel");

    dom.title = document.getElementById("admTitle");
    dom.date = document.getElementById("admDate");
    dom.technique = document.getElementById("admTechnique");
    dom.status = document.getElementById("admStatus");
    dom.medium = document.getElementById("admMedium");
    dom.instagramUrl = document.getElementById("admInstagramUrl");
    dom.instaTestLink = document.getElementById("admInstaTestLink");
    dom.description = document.getElementById("admDescription");
    dom.statusMsg = document.getElementById("admStatusMsg");
    dom.saveBtn = document.getElementById("admSaveBtn");

    dom.totalCount = document.getElementById("admTotalCount");
    dom.searchInput = document.getElementById("admSearchInput");
    dom.inventoryBody = document.getElementById("admInventoryBody");
    dom.themeBtn = document.getElementById("themeToggle");
  }

  function toThumbUrl(url) {
    if (!url || typeof url !== "string") return "";
    if (url.startsWith("data:") || url.startsWith("blob:")) return url;
    return url + (url.includes("?") ? "&" : "?") + "size=thumb";
  }

  function createThumbDataUrlFromImg(img, maxDim = 600, quality = 0.8) {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const maxSide = Math.max(w, h);
    if (!maxSide) return null;
    const scale = maxSide > maxDim ? maxDim / maxSide : 1;
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));
    const c = document.createElement("canvas");
    c.width = tw;
    c.height = th;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, tw, th);
    return c.toDataURL("image/jpeg", quality);
  }

  function fileToPreparedDataUrls(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        const srcUrl = reader.result;
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          const maxHires = 2000;
          const maxSide = Math.max(img.naturalWidth, img.naturalHeight);
          const sc = maxSide > maxHires ? maxHires / maxSide : 1;
          const w = Math.max(1, Math.round(img.naturalWidth * sc));
          const h = Math.max(1, Math.round(img.naturalHeight * sc));
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          const ctx = c.getContext("2d");
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, 0, 0, w, h);
          const hiresDataUrl = c.toDataURL("image/jpeg", 0.9);
          const thumbDataUrl = createThumbDataUrlFromImg(img, 600, 0.8);
          resolve({ hiresDataUrl, thumbDataUrl });
        };
        img.src = srcUrl;
      };
      reader.readAsDataURL(file);
    });
  }

  function showStatusMsg(text, isError = false) {
    if (!dom.statusMsg) return;
    dom.statusMsg.textContent = text;
    dom.statusMsg.className = isError ? "settings-error" : "settings-success";
    dom.statusMsg.style.display = "block";
    if (!isError) {
      setTimeout(() => {
        if (dom.statusMsg.textContent === text) dom.statusMsg.style.display = "none";
      }, 4500);
    }
  }

  function showAuthGate(errorText = "") {
    if (dom.main) dom.main.style.display = "none";
    if (dom.logoutBtn) dom.logoutBtn.style.display = "none";
    if (dom.sorterLink) dom.sorterLink.style.display = "none";
    if (dom.authOverlay) dom.authOverlay.style.display = "flex";
    if (dom.authError) {
      if (errorText) {
        dom.authError.textContent = errorText;
        dom.authError.style.display = "block";
      } else {
        dom.authError.style.display = "none";
      }
    }
    setTimeout(() => {
      if (dom.loginPass) dom.loginPass.focus();
    }, 60);
  }

  function hideAuthGate() {
    if (dom.authOverlay) dom.authOverlay.style.display = "none";
    if (dom.main) dom.main.style.display = "block";
    if (dom.logoutBtn) dom.logoutBtn.style.display = "inline-flex";
    if (dom.sorterLink) dom.sorterLink.style.display = "inline-flex";
  }

  // ---- Miniature 220 cm Sofa Scale Preview ----
  function updateSofaPreview() {
    if (!dom.sofaPreview || !dom.previewPaint || !dom.previewSofa) return;
    const w = Math.max(10, parseFloat(dom.width.value) || 50);
    const h = Math.max(10, parseFloat(dom.height.value) || 70);
    const d = Math.max(1, parseFloat(dom.depth.value) || 4);

    const sofaW = 220;
    const sofaH = 75;
    const stageW = Math.max(240, dom.sofaPreview.clientWidth || 360);
    const stageH = 190;
    const wallW = Math.max(280, w + 100);
    const ceilH = 240;

    const pxPerCm = Math.min((stageW - 24) / wallW, (stageH - 28) / ceilH);
    const pW = Math.max(14, Math.round(w * pxPerCm));
    const pH = Math.max(14, Math.round(h * pxPerCm));
    const sW = Math.max(60, Math.round(sofaW * pxPerCm));
    const sH = Math.max(26, Math.round(sofaH * pxPerCm));

    dom.previewSofa.style.width = `${sW}px`;
    dom.previewSofa.style.height = `${sH}px`;
    dom.previewPaint.style.width = `${pW}px`;
    dom.previewPaint.style.height = `${pH}px`;
    dom.previewPaint.style.bottom = `${20 + sH + 10}px`;

    if (dom.previewPaintDims) dom.previewPaintDims.textContent = `${w}×${h}`;
    if (dom.previewLabel) {
      dom.previewLabel.textContent = `Mierka ${w} × ${h} × ${d} cm nad ${sofaW} cm pohovkou`;
    }
  }

  // ---- Album Photo Grid & Preview Refresh ----
  function refreshCoverAndAlbumUI(statusHint) {
    const coverSrc = albumPhotos[0] || "";
    if (coverSrc && dom.previewRow) {
      dom.coverPreview.src = coverSrc.startsWith("data:")
        ? (pendingThumbMap[coverSrc] || coverSrc)
        : toThumbUrl(coverSrc);
      if (statusHint) {
        dom.coverSourceTag.textContent = statusHint;
      } else if (coverSrc.startsWith("data:")) {
        dom.coverSourceTag.textContent = "✨ Upravená kópia ako titulná (pôvodná fotka ostáva v albume)";
      } else {
        dom.coverSourceTag.textContent = currentRawUrl ? "✓ Zachovaný pôvodný originál" : "Aktuálna titulná fotka";
      }
      dom.previewRow.style.display = "flex";
    } else if (dom.previewRow) {
      dom.previewRow.style.display = "none";
    }

    if (!dom.albumSection || !dom.photoGrid) return;
    if (albumPhotos.length === 0) {
      dom.albumSection.style.display = "none";
      dom.photoGrid.innerHTML = "";
      return;
    }

    dom.albumSection.style.display = "block";
    if (dom.photoCount) dom.photoCount.textContent = `(${albumPhotos.length})`;
    dom.photoGrid.innerHTML = "";

    albumPhotos.forEach((url, idx) => {
      const card = document.createElement("div");
      card.className = `adm-photo-item${idx === 0 ? " is-cover" : ""}`;
      const thumbSrc = url.startsWith("data:") ? (pendingThumbMap[url] || url) : toThumbUrl(url);
      card.innerHTML = `
        <img src="${thumbSrc}" alt="Foto ${idx + 1}" loading="lazy" decoding="async" title="Kliknutím nastavíš ako Titulnú">
        ${idx === 0 ? '<span class="adm-photo-badge">Titulná</span>' : ""}
        <div class="adm-photo-tools">
          <button type="button" class="adm-photo-tool" data-action="crop" title="4-bodový orez (vytvorí kópiu)">📐</button>
          <button type="button" class="adm-photo-tool" data-action="cover3d" title="3D Cover Studio (vytvorí kópiu)">✨</button>
          <button type="button" class="adm-photo-tool danger" data-action="remove" title="Odstrániť z albumu">✕</button>
        </div>
      `;

      card.querySelector("img").addEventListener("click", () => {
        if (idx === 0) return;
        const picked = albumPhotos.splice(idx, 1)[0];
        albumPhotos.unshift(picked);
        refreshCoverAndAlbumUI("✓ Zvolená nová titulná fotka (klikni na Uložiť)");
      });

      card.querySelector('[data-action="crop"]').addEventListener("click", (e) => {
        e.stopPropagation();
        openWarpForSource(url, false);
      });

      card.querySelector('[data-action="cover3d"]').addEventListener("click", (e) => {
        e.stopPropagation();
        openCoverStudioForSource(url);
      });

      card.querySelector('[data-action="remove"]').addEventListener("click", (e) => {
        e.stopPropagation();
        if (albumPhotos.length <= 1) {
          alert("V albume musí zostať aspoň jedna fotografia.");
          return;
        }
        albumPhotos.splice(idx, 1);
        refreshCoverAndAlbumUI("Fotka odstránená z albumu (potvrď tlačidlom Uložiť)");
      });

      dom.photoGrid.appendChild(card);
    });
  }

  // ---- Form Reset / Populate ----
  function resetForm() {
    editingId = null;
    albumPhotos = [];
    pendingThumbMap = {};
    pendingRawDataUrl = null;
    currentRawUrl = "";

    if (dom.formHeading) dom.formHeading.textContent = "➕ Pridať novú maľbu";
    if (dom.form) dom.form.reset();
    if (dom.width) dom.width.value = "50";
    if (dom.height) dom.height.value = "70";
    if (dom.depth) dom.depth.value = "4";
    if (dom.medium) dom.medium.value = "Akryl na plátne";
    if (dom.technique) dom.technique.value = "Mixed";
    if (dom.status) dom.status.value = "Available";
    if (dom.date) dom.date.value = new Date().toISOString().slice(0, 10);
    if (dom.instaTestLink) dom.instaTestLink.href = "https://www.instagram.com/platenko.akryl";
    if (dom.statusMsg) dom.statusMsg.style.display = "none";

    refreshCoverAndAlbumUI();
    updateSofaPreview();
    renderInventory();
  }

  function loadArtworkIntoForm(art, opts) {
    if (!art) return;
    const options = opts || {};
    editingId = art.id;
    pendingThumbMap = {};
    pendingRawDataUrl = null;
    currentRawUrl = art.rawImage || "";
    albumPhotos = (art.detailImages && art.detailImages.length > 0)
      ? [...art.detailImages]
      : (art.coverImage ? [art.coverImage] : []);

    if (dom.formHeading) dom.formHeading.textContent = `✏️ Upraviť: ${art.title}`;
    dom.title.value = art.title || "";
    dom.date.value = art.date || "";
    dom.technique.value = art.technique || "Mixed";
    dom.status.value = art.status || "Available";
    dom.medium.value = art.medium || "Akryl na plátne";
    dom.width.value = art.widthCm || 50;
    dom.height.value = art.heightCm || 70;
    dom.depth.value = art.depthCm || 4;
    dom.instagramUrl.value = art.instagramUrl || "";
    dom.description.value = art.description || "";
    if (dom.instaTestLink) {
      dom.instaTestLink.href = (art.instagramUrl && art.instagramUrl.trim()) || "https://www.instagram.com/platenko.akryl";
    }

    refreshCoverAndAlbumUI();
    updateSofaPreview();
    renderInventory();
    if (options.scrollTop !== false) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  // ---- Non-Destructive 4-Point Perspective Warp (Always creates a copy) ----
  function openWarpForSource(src, isNewUpload) {
    if (!window.PlatenkoPerspectiveWarp || !src) return;
    const w = Math.max(10, parseFloat(dom.width.value) || 50);
    const h = Math.max(10, parseFloat(dom.height.value) || 70);

    window.PlatenkoPerspectiveWarp.open({
      imageSrc: src,
      widthCm: w,
      heightCm: h,
      isNewUpload,
      onSwapDims: (nw, nh) => {
        if (dom.width) dom.width.value = nw;
        if (dom.height) dom.height.value = nh;
        updateSofaPreview();
      },
      onApply: ({ hiresDataUrl, thumbDataUrl, rawDataUrl, rawThumbDataUrl }) => {
        if (thumbDataUrl) pendingThumbMap[hiresDataUrl] = thumbDataUrl;

        if (isNewUpload) {
          if (!editingId) {
            // Brand-new artwork: cropped copy becomes cover (index 0); original raw will be saved + appended by worker
            albumPhotos = [hiresDataUrl];
            pendingRawDataUrl = rawDataUrl || null;
            if (rawDataUrl && rawThumbDataUrl) pendingThumbMap[rawDataUrl] = rawThumbDataUrl;
          } else {
            // Adding a newly photographed/uploaded image into existing album: keep original raw + prepend crop copy!
            if (rawDataUrl && !albumPhotos.includes(rawDataUrl)) {
              if (rawThumbDataUrl) pendingThumbMap[rawDataUrl] = rawThumbDataUrl;
              albumPhotos.unshift(rawDataUrl);
            }
            albumPhotos.unshift(hiresDataUrl);
            if (!currentRawUrl && !pendingRawDataUrl && rawDataUrl) {
              pendingRawDataUrl = rawDataUrl;
            }
          }
        } else {
          // Non-destructive crop of existing photo in album: ALWAYS prepend new copy, keeping original photo intact!
          if (!currentRawUrl && typeof src === "string" && !src.startsWith("data:")) {
            currentRawUrl = src;
          }
          albumPhotos.unshift(hiresDataUrl);
        }

        refreshCoverAndAlbumUI("✨ Vytvorená orezaná kópia ako titulná — pôvodná fotka ostala v albume (klikni na Uložiť)");
      },
    });
  }

  // ---- Non-Destructive 3D Cover Studio ----
  function openCoverStudioForSource(src) {
    if (!window.PlatenkoCoverStudio || !src) return;
    window.PlatenkoCoverStudio.open({
      imageSrc: src,
      onApply: ({ hiresDataUrl, thumbDataUrl, setAsCover }) => {
        if (thumbDataUrl) pendingThumbMap[hiresDataUrl] = thumbDataUrl;
        if (setAsCover) {
          albumPhotos.unshift(hiresDataUrl);
        } else {
          albumPhotos.push(hiresDataUrl);
        }
        refreshCoverAndAlbumUI(
          setAsCover
            ? "✨ Vytvorená 3D Cover kópia ako titulná — pôvodná fotka ostala v albume (klikni na Uložiť)"
            : "✨ Vytvorená 3D Cover kópia na koniec albumu (klikni na Uložiť)"
        );
      },
    });
  }

  function handleSelectedFile(file) {
    if (!file || !file.type.startsWith("image/")) {
      showStatusMsg("Vyber prosím platný obrázok (JPG, PNG, WebP).", true);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        openWarpForSource(reader.result, true);
      }
    };
    reader.readAsDataURL(file);
  }

  // ---- Inventory Table ----
  function renderInventory() {
    if (!dom.inventoryBody) return;
    const q = (dom.searchInput ? dom.searchInput.value : "").trim().toLowerCase();
    const filtered = artworks.filter((a) => {
      if (!q) return true;
      return (a.title || "").toLowerCase().includes(q)
        || (a.date || "").toLowerCase().includes(q)
        || (a.dimensions || "").toLowerCase().includes(q);
    });

    if (dom.totalCount) dom.totalCount.textContent = artworks.length;
    dom.inventoryBody.innerHTML = "";

    if (filtered.length === 0) {
      dom.inventoryBody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:28px;color:var(--text-muted);">Žiadne diela.</td></tr>`;
      return;
    }

    filtered.forEach((art) => {
      const tr = document.createElement("tr");
      if (editingId && art.id === editingId) {
        tr.classList.add("is-active");
      }
      const thumbSrc = toThumbUrl(art.coverImage);
      const dimsLabel = `${art.widthCm || 50} × ${art.heightCm || 70} × ${art.depthCm || 4} cm`;
      const isSearching = Boolean(q);

      tr.innerHTML = `
        <td>
          <img src="${thumbSrc}" alt="${art.title}" class="adm-row-thumb" loading="lazy" decoding="async">
        </td>
        <td>
          <strong style="display:block;font-size:0.92rem;">${art.title}</strong>
          <span style="font-size:0.78rem;color:var(--text-muted);">${dimsLabel} · ${art.date || art.year || ""} · ${art.photoCount || (art.detailImages ? art.detailImages.length : 1)} fotiek</span>
        </td>
        <td>
          <select class="status-select adm-row-status">
            <option value="Available" ${art.status === "Available" ? "selected" : ""}>Dostupné</option>
            <option value="Reserved" ${art.status === "Reserved" ? "selected" : ""}>Rezervované</option>
            <option value="Sold" ${art.status === "Sold" ? "selected" : ""}>Predané</option>
          </select>
        </td>
        <td style="text-align:right;white-space:nowrap;">
          <button type="button" class="adm-icon-btn adm-up-btn" title="Posunúť vyššie" ${isSearching ? "disabled" : ""}>↑</button>
          <button type="button" class="adm-icon-btn adm-down-btn" title="Posunúť nižšie" ${isSearching ? "disabled" : ""}>↓</button>
          <button type="button" class="adm-icon-btn adm-crop-btn" title="4-bodový orez (vytvorí kópiu)">📐</button>
          <button type="button" class="adm-icon-btn adm-edit-btn" title="Upraviť">✏️</button>
          <button type="button" class="adm-icon-btn adm-del-btn" title="Vymazať" style="color:#ef4444;">🗑️</button>
        </td>
      `;

      tr.querySelector(".adm-row-status").addEventListener("change", async (e) => {
        const newStatus = e.target.value;
        art.status = newStatus;
        await quickUpdateArtwork(art.id, { status: newStatus });
      });

      tr.querySelector(".adm-up-btn").addEventListener("click", () => moveArtworkOrder(art.id, -1));
      tr.querySelector(".adm-down-btn").addEventListener("click", () => moveArtworkOrder(art.id, 1));
      tr.querySelector(".adm-crop-btn").addEventListener("click", () => {
        loadArtworkIntoForm(art);
        const src = art.rawImage || art.coverImage;
        if (src) openWarpForSource(src, false);
      });
      tr.querySelector(".adm-edit-btn").addEventListener("click", () => loadArtworkIntoForm(art));
      tr.querySelector(".adm-del-btn").addEventListener("click", () => deleteArtwork(art));

      dom.inventoryBody.appendChild(tr);
    });
  }

  async function loadArtworks() {
    try {
      const resp = await fetch("/api/artworks");
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      artworks = await resp.json();
      renderInventory();

      // Deep-link ?edit={id}
      const editParam = new URLSearchParams(window.location.search).get("edit");
      if (editParam && !editingId) {
        const target = artworks.find((a) => a.id === editParam);
        if (target) loadArtworkIntoForm(target);
      }
    } catch (err) {
      showStatusMsg("Nepodarilo sa načítať diela z databázy: " + err.message, true);
    }
  }

  async function quickUpdateArtwork(id, payload) {
    try {
      const resp = await fetch(`/api/artworks/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (resp.status === 401) {
        showAuthGate("Prihlásenie vypršalo. Prihlás sa znova.");
        return;
      }
      if (!resp.ok) throw new Error("HTTP " + resp.status);
    } catch (err) {
      showStatusMsg("Chyba uloženia stavu: " + err.message, true);
    }
  }

  async function moveArtworkOrder(id, delta) {
    const idx = artworks.findIndex((a) => a.id === id);
    const targetIdx = idx + delta;
    if (idx === -1 || targetIdx < 0 || targetIdx >= artworks.length) return;

    const [moved] = artworks.splice(idx, 1);
    artworks.splice(targetIdx, 0, moved);
    renderInventory();

    try {
      const resp = await fetch("/api/artworks/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: artworks.map((a) => a.id) }),
      });
      if (resp.status === 401) {
        showAuthGate("Prihlásenie vypršalo. Prihlás sa znova.");
        return;
      }
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      showStatusMsg("✓ Poradie v galérii uložené.");
    } catch (err) {
      showStatusMsg("Nepodarilo sa uložiť poradie: " + err.message, true);
    }
  }

  async function deleteArtwork(art) {
    if (!confirm(`Naozaj chceš natrvalo vymazať maľbu „${art.title}" vrátane fotiek, náhľadov a originálu v R2?`)) {
      return;
    }
    try {
      const resp = await fetch(`/api/artworks/${encodeURIComponent(art.id)}`, { method: "DELETE" });
      if (resp.status === 401) {
        showAuthGate("Prihlásenie vypršalo. Prihlás sa znova.");
        return;
      }
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      artworks = artworks.filter((a) => a.id !== art.id);
      if (editingId === art.id) resetForm();
      renderInventory();
      showStatusMsg("✓ Maľba a všetky jej súbory v R2 boli vymazané.");
    } catch (err) {
      showStatusMsg("Chyba mazania: " + err.message, true);
    }
  }

  function slugify(str) {
    return (str || "malba")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "malba";
  }

  async function saveArtworkForm(e) {
    e.preventDefault();
    const title = dom.title.value.trim();
    if (!title) {
      showStatusMsg("Zadaj názov maľby.", true);
      return;
    }

    const w = Math.max(10, parseFloat(dom.width.value) || 50);
    const h = Math.max(10, parseFloat(dom.height.value) || 70);
    const d = Math.max(1, parseFloat(dom.depth.value) || 4);
    const dateVal = dom.date.value || new Date().toISOString().slice(0, 10);
    const yearVal = dateVal.slice(0, 4);
    const dimensions = `${w} × ${h} cm`;

    const origBtnText = dom.saveBtn.textContent;
    dom.saveBtn.disabled = true;
    dom.saveBtn.textContent = "⏳ Ukladám do cloudu…";

    try {
      const filteredThumbs = {};
      albumPhotos.forEach((p) => {
        if (pendingThumbMap[p]) filteredThumbs[p] = pendingThumbMap[p];
      });
      if (pendingRawDataUrl && pendingThumbMap[pendingRawDataUrl]) {
        filteredThumbs[pendingRawDataUrl] = pendingThumbMap[pendingRawDataUrl];
      }

      let savedId = editingId;
      let successMsg = "✓ Zmeny uložené do D1 a R2!";

      if (editingId) {
        const payload = {
          title,
          date: dateVal,
          year: yearVal,
          technique: dom.technique.value,
          status: dom.status.value,
          medium: dom.medium.value.trim() || "Akryl na plátne",
          dimensions,
          widthCm: w,
          heightCm: h,
          depthCm: d,
          instagramUrl: dom.instagramUrl.value.trim(),
          description: dom.description.value.trim(),
          detailImages: [...albumPhotos],
          thumbMap: filteredThumbs,
        };
        if (currentRawUrl) payload.rawImage = currentRawUrl;
        if (pendingRawDataUrl) payload.rawImageDataUrl = pendingRawDataUrl;

        const resp = await fetch(`/api/artworks/${encodeURIComponent(editingId)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (resp.status === 401) {
          showAuthGate("Prihlásenie vypršalo. Prihlás sa znova.");
          return;
        }
        if (!resp.ok) throw new Error("HTTP " + resp.status);
      } else {
        if (albumPhotos.length === 0) {
          showStatusMsg("Pre novú maľbu najprv odfotografuj alebo nahraj obrázok.", true);
          return;
        }
        const slug = slugify(title);
        const folder = `${dateVal}_${slug}-${Date.now().toString(36).slice(-4)}`;
        const newId = `art-${folder}`;
        savedId = newId;
        successMsg = "✓ Nová maľba (výrez aj originál) uložená do galérie!";
        const payload = {
          id: newId,
          folder,
          title,
          date: dateVal,
          year: yearVal,
          technique: dom.technique.value,
          status: dom.status.value,
          medium: dom.medium.value.trim() || "Akryl na plátne",
          dimensions,
          widthCm: w,
          heightCm: h,
          depthCm: d,
          instagramUrl: dom.instagramUrl.value.trim(),
          description: dom.description.value.trim(),
          detailImages: [...albumPhotos],
          thumbMap: filteredThumbs,
          rawImageDataUrl: pendingRawDataUrl || "",
          includeRawInAlbum: true,
        };

        const resp = await fetch("/api/artworks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (resp.status === 401) {
          showAuthGate("Prihlásenie vypršalo. Prihlás sa znova.");
          return;
        }
        if (!resp.ok) throw new Error("HTTP " + resp.status);
      }

      await loadArtworks();
      const keptArt = savedId ? artworks.find((a) => a.id === savedId) : null;
      if (keptArt) {
        loadArtworkIntoForm(keptArt, { scrollTop: false });
      }
      showStatusMsg(successMsg);
    } catch (err) {
      showStatusMsg("Chyba uloženia: " + err.message, true);
    } finally {
      dom.saveBtn.disabled = false;
      dom.saveBtn.textContent = origBtnText;
    }
  }

  // ---- Init ----
  document.addEventListener("DOMContentLoaded", async () => {
    cacheDom();

    const savedTheme = localStorage.getItem("platenko_theme") || "light";
    document.documentElement.setAttribute("data-theme", savedTheme);
    if (dom.themeBtn) {
      dom.themeBtn.innerHTML = savedTheme === "dark" ? "☀️ <span>Svetlý</span>" : "🌙 <span>Tmavý</span>";
      dom.themeBtn.addEventListener("click", () => {
        const cur = document.documentElement.getAttribute("data-theme");
        const next = cur === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        localStorage.setItem("platenko_theme", next);
        dom.themeBtn.innerHTML = next === "dark" ? "☀️ <span>Svetlý</span>" : "🌙 <span>Tmavý</span>";
      });
    }

    if (dom.loginForm) {
      dom.loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (dom.authError) dom.authError.style.display = "none";
        if (dom.loginSubmit) dom.loginSubmit.disabled = true;

        try {
          const resp = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              username: dom.loginUser.value.trim(),
              password: dom.loginPass.value,
            }),
          });
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok || !data.authenticated) {
            throw new Error(data.error || "Nesprávne meno alebo heslo.");
          }
          dom.loginPass.value = "";
          hideAuthGate();
          resetForm();
          loadArtworks();
        } catch (err) {
          if (dom.authError) {
            dom.authError.textContent = err.message || "Chyba prihlásenia.";
            dom.authError.style.display = "block";
          }
        } finally {
          if (dom.loginSubmit) dom.loginSubmit.disabled = false;
        }
      });
    }

    if (dom.logoutBtn) {
      dom.logoutBtn.addEventListener("click", async () => {
        try { await fetch("/api/auth/logout", { method: "POST" }); } catch {}
        showAuthGate();
      });
    }

    if (dom.resetFormBtn) dom.resetFormBtn.addEventListener("click", resetForm);
    if (dom.form) dom.form.addEventListener("submit", saveArtworkForm);
    if (dom.searchInput) dom.searchInput.addEventListener("input", renderInventory);

    [dom.width, dom.height, dom.depth].forEach((inp) => {
      if (inp) inp.addEventListener("input", updateSofaPreview);
    });

    dom.presets.forEach((btn) => {
      btn.addEventListener("click", () => {
        dom.width.value = btn.dataset.w;
        dom.height.value = btn.dataset.h;
        updateSofaPreview();
      });
    });

    if (dom.instagramUrl && dom.instaTestLink) {
      dom.instagramUrl.addEventListener("input", () => {
        dom.instaTestLink.href = dom.instagramUrl.value.trim() || "https://www.instagram.com/platenko.akryl";
      });
    }

    if (dom.cameraBtn && dom.cameraInput) {
      dom.cameraBtn.addEventListener("click", () => dom.cameraInput.click());
      dom.cameraInput.addEventListener("change", (e) => {
        if (e.target.files && e.target.files[0]) handleSelectedFile(e.target.files[0]);
        e.target.value = "";
      });
    }

    if (dom.fileBtn && dom.fileInput) {
      dom.fileBtn.addEventListener("click", () => dom.fileInput.click());
      dom.fileInput.addEventListener("change", (e) => {
        if (e.target.files && e.target.files[0]) handleSelectedFile(e.target.files[0]);
        e.target.value = "";
      });
    }

    if (dom.addPhotosBtn && dom.addPhotosInput) {
      dom.addPhotosBtn.addEventListener("click", () => dom.addPhotosInput.click());
      dom.addPhotosInput.addEventListener("change", async (e) => {
        const files = Array.from(e.target.files || []).filter((f) => f.type.startsWith("image/"));
        e.target.value = "";
        if (files.length === 0) return;
        for (const f of files) {
          try {
            const { hiresDataUrl, thumbDataUrl } = await fileToPreparedDataUrls(f);
            if (thumbDataUrl) pendingThumbMap[hiresDataUrl] = thumbDataUrl;
            albumPhotos.push(hiresDataUrl);
          } catch {}
        }
        refreshCoverAndAlbumUI(`＋ Pridané nové fotky (${files.length}) — potvrď tlačidlom Uložiť`);
      });
    }

    if (dom.dropzone) {
      dom.dropzone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dom.dropzone.classList.add("drag-over");
      });
      dom.dropzone.addEventListener("dragleave", () => dom.dropzone.classList.remove("drag-over"));
      dom.dropzone.addEventListener("drop", (e) => {
        e.preventDefault();
        dom.dropzone.classList.remove("drag-over");
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
          handleSelectedFile(e.dataTransfer.files[0]);
        }
      });
    }

    if (dom.rewarpBtn) {
      dom.rewarpBtn.addEventListener("click", () => {
        const src = currentRawUrl || pendingRawDataUrl || albumPhotos[0];
        if (src) openWarpForSource(src, false);
      });
    }
    if (dom.open3DCoverBtn) {
      dom.open3DCoverBtn.addEventListener("click", () => {
        const src = currentRawUrl || pendingRawDataUrl || albumPhotos[0];
        if (src) openCoverStudioForSource(src);
      });
    }

    try {
      const resp = await fetch("/api/auth/me");
      const data = await resp.json();
      if (data && data.authenticated) {
        hideAuthGate();
        resetForm();
        loadArtworks();
      } else {
        showAuthGate();
      }
    } catch {
      showAuthGate("Nepodarilo sa overiť prihlásenie.");
    }
  });
})();
