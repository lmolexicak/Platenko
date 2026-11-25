/**
 * Platenko Admin CMS (/admin)
 * Real D1 + PBKDF2 Session Auth, Mobile Camera Capture,
 * 4-Point Perspective Homography, Live 220cm Sofa Scale Preview & Inventory Reordering.
 */
(function () {
  "use strict";

  let artworks = [];
  let editingId = null;

  // Pending image buffers when user captures/uploads or re-warps a cover
  let pendingHiresDataUrl = null;
  let pendingThumbDataUrl = null;
  let pendingRawDataUrl = null;
  let currentCoverUrl = "";
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

  function showStatusMsg(text, isError = false) {
    if (!dom.statusMsg) return;
    dom.statusMsg.textContent = text;
    dom.statusMsg.className = isError ? "settings-error" : "settings-success";
    dom.statusMsg.style.display = "block";
    if (!isError) {
      setTimeout(() => {
        if (dom.statusMsg.textContent === text) dom.statusMsg.style.display = "none";
      }, 4000);
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

  // ---- Form Reset / Populate ----
  function resetForm() {
    editingId = null;
    pendingHiresDataUrl = null;
    pendingThumbDataUrl = null;
    pendingRawDataUrl = null;
    currentCoverUrl = "";
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
    if (dom.previewRow) dom.previewRow.style.display = "none";
    if (dom.statusMsg) dom.statusMsg.style.display = "none";

    updateSofaPreview();
  }

  function loadArtworkIntoForm(art) {
    if (!art) return;
    editingId = art.id;
    pendingHiresDataUrl = null;
    pendingThumbDataUrl = null;
    pendingRawDataUrl = null;
    currentCoverUrl = art.coverImage || "";
    currentRawUrl = art.rawImage || "";

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

    if (currentCoverUrl && dom.previewRow) {
      dom.coverPreview.src = toThumbUrl(currentCoverUrl);
      dom.coverSourceTag.textContent = currentRawUrl ? "✓ Zachovaný pôvodný originál pre re-orez" : "Aktuálna titulná fotka";
      dom.previewRow.style.display = "flex";
    } else if (dom.previewRow) {
      dom.previewRow.style.display = "none";
    }

    updateSofaPreview();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ---- Image Capture / Upload -> Auto Open 4-Point Perspective Tool ----
  function openWarpForSource(src, isNewUpload) {
    if (!window.PlatenkoPerspectiveWarp) return;
    const w = Math.max(10, parseFloat(dom.width.value) || 50);
    const h = Math.max(10, parseFloat(dom.height.value) || 70);

    window.PlatenkoPerspectiveWarp.open({
      imageSrc: src,
      widthCm: w,
      heightCm: h,
      isNewUpload,
      onApply: ({ hiresDataUrl, thumbDataUrl, rawDataUrl }) => {
        pendingHiresDataUrl = hiresDataUrl;
        pendingThumbDataUrl = thumbDataUrl;
        if (rawDataUrl) pendingRawDataUrl = rawDataUrl;

        if (dom.coverPreview && dom.previewRow) {
          dom.coverPreview.src = thumbDataUrl || hiresDataUrl;
          dom.coverSourceTag.textContent = "✨ Vyrovnané (pripravené na uloženie do cloudu)";
          dom.previewRow.style.display = "flex";
        }
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
      const thumbSrc = toThumbUrl(art.coverImage);
      const dimsLabel = `${art.widthCm || 50} × ${art.heightCm || 70} × ${art.depthCm || 4} cm`;
      const isSearching = Boolean(q);

      tr.innerHTML = `
        <td>
          <img src="${thumbSrc}" alt="${art.title}" class="adm-row-thumb" loading="lazy" decoding="async">
        </td>
        <td>
          <strong style="display:block;font-size:0.92rem;">${art.title}</strong>
          <span style="font-size:0.78rem;color:var(--text-muted);">${dimsLabel} · ${art.date || art.year || ""}</span>
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
          <button type="button" class="adm-icon-btn adm-crop-btn" title="Vyrovnať / Orezať">📐</button>
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
      if (editingId) {
        const existing = artworks.find((a) => a.id === editingId);
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
        };

        if (pendingHiresDataUrl) {
          const restImgs = existing && Array.isArray(existing.detailImages)
            ? existing.detailImages.slice(1)
            : [];
          payload.detailImages = [pendingHiresDataUrl, ...restImgs];
          if (pendingThumbDataUrl) {
            payload.thumbMap = { [pendingHiresDataUrl]: pendingThumbDataUrl };
          }
        }
        if (pendingRawDataUrl) {
          payload.rawImageDataUrl = pendingRawDataUrl;
        }

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
        showStatusMsg("✓ Zmeny uložené do D1 a R2!");
      } else {
        if (!pendingHiresDataUrl) {
          showStatusMsg("Pre novú maľbu najprv odfotografuj alebo nahraj obrázok.", true);
          return;
        }
        const slug = slugify(title);
        const folder = `${dateVal}_${slug}-${Date.now().toString(36).slice(-4)}`;
        const newId = `art-${folder}`;
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
          detailImages: [pendingHiresDataUrl],
          thumbMap: pendingThumbDataUrl ? { [pendingHiresDataUrl]: pendingThumbDataUrl } : {},
          rawImageDataUrl: pendingRawDataUrl || "",
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
        showStatusMsg("✓ Nová maľba pridaná do galérie!");
      }

      resetForm();
      await loadArtworks();
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

    // Theme toggle
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

    // Login
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

    // Form interactions
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
        const src = pendingRawDataUrl || currentRawUrl || pendingHiresDataUrl || currentCoverUrl;
        if (src) openWarpForSource(src, false);
      });
    }

    // Auth Session Check
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
