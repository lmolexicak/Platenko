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

  // Dynamic D1 Lookups (Číselníky)
  let lookups = {
    techniques: [
      { code: "Pouring", label: "Pouring" },
      { code: "Airbrush", label: "Airbrush" },
      { code: "Mixed", label: "Mixed" },
      { code: "Brush", label: "Brush" },
    ],
    statuses: [
      { code: "Available", label: "Dostupné", color: "green", showInFilter: true },
      { code: "Reserved", label: "Rezervované", color: "yellow", showInFilter: true },
      { code: "Sold", label: "Predané", color: "gray", showInFilter: true },
    ],
    mediums: [
      { code: "Akryl na plátne", label: "Akryl na plátne" },
      { code: "Akryl a zlatá fólia na plátne", label: "Akryl a zlatá fólia na plátne" },
    ],
    dimensionPresets: [
      { code: "30x40", label: "30×40", meta: { w: 30, h: 40 } },
      { code: "50x50", label: "50×50", meta: { w: 50, h: 50 } },
      { code: "50x70", label: "50×70", meta: { w: 50, h: 70 } },
      { code: "70x50", label: "70×50", meta: { w: 70, h: 50 } },
      { code: "60x80", label: "60×80", meta: { w: 60, h: 80 } },
      { code: "80x100", label: "80×100", meta: { w: 80, h: 100 } },
      { code: "100x120", label: "100×120", meta: { w: 100, h: 120 } },
    ],
  };
  let activeLookupCategory = "technique";
  let automationChannels = [];
  let automationSummary = { enabledCount: 0, totalChannels: 0, pendingArtworksCount: 0 };
  let editingPublishChannels = {};

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
    dom.automationBtn = document.getElementById("adminAutomationBtn");
    dom.lookupsBtn = document.getElementById("adminLookupsBtn");
    dom.sorterLink = document.getElementById("adminSorterLink");

    dom.automationModal = document.getElementById("automationModal");
    dom.automationCloseBtn = document.getElementById("automationCloseBtn");
    dom.autoSummary = document.getElementById("admAutoSummary");
    dom.autoStatusMsg = document.getElementById("admAutoStatusMsg");
    dom.autoSocialList = document.getElementById("admAutoSocialList");
    dom.autoMarketList = document.getElementById("admAutoMarketList");

    dom.lookupsModal = document.getElementById("lookupsModal");
    dom.lookupsCloseBtn = document.getElementById("lookupsCloseBtn");
    dom.lookupTabBtns = Array.from(document.querySelectorAll(".lookup-tab-btn"));
    dom.lookupAddForm = document.getElementById("lookupAddForm");
    dom.lookupNewLabel = document.getElementById("lookupNewLabel");
    dom.lookupNewDimsWrap = document.getElementById("lookupNewDimsWrap");
    dom.lookupNewW = document.getElementById("lookupNewW");
    dom.lookupNewH = document.getElementById("lookupNewH");
    dom.lookupNewColor = document.getElementById("lookupNewColor");
    dom.lookupNewFilterWrap = document.getElementById("lookupNewFilterWrap");
    dom.lookupNewShowFilter = document.getElementById("lookupNewShowFilter");
    dom.lookupStatusMsg = document.getElementById("lookupStatusMsg");
    dom.lookupsList = document.getElementById("lookupsList");

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
    dom.presetsWrap = document.getElementById("admPresets");
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
    dom.priceEur = document.getElementById("admPriceEur");
    dom.instagramUrl = document.getElementById("admInstagramUrl");
    dom.instaTestLink = document.getElementById("admInstaTestLink");
    dom.description = document.getElementById("admDescription");
    dom.publishPanel = document.getElementById("admPublishPanel");
    dom.openAutoFromPanelBtn = document.getElementById("admOpenAutoFromPanelBtn");
    dom.socialThumbWrap = document.getElementById("admSocialThumbWrap");
    dom.socialThumbImg = document.getElementById("admSocialThumbImg");
    dom.publishStatusList = document.getElementById("admPublishStatusList");
    dom.statusMsg = document.getElementById("admStatusMsg");
    dom.saveBtn = document.getElementById("admSaveBtn");

    dom.totalCount = document.getElementById("admTotalCount");
    dom.searchInput = document.getElementById("admSearchInput");
    dom.inventoryScroll = document.querySelector(".adm-inventory-scroll");
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
    if (dom.automationBtn) dom.automationBtn.style.display = "none";
    if (dom.lookupsBtn) dom.lookupsBtn.style.display = "none";
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
    if (dom.automationBtn) dom.automationBtn.style.display = "inline-flex";
    if (dom.lookupsBtn) dom.lookupsBtn.style.display = "inline-flex";
    if (dom.sorterLink) dom.sorterLink.style.display = "inline-flex";
  }

  // ---- Dynamic Lookups Population & CRUD Modal ----
  function populateSelectOptions(selectEl, items, desiredValue) {
    if (!selectEl) return;
    const prevVal = desiredValue !== undefined ? desiredValue : selectEl.value;
    selectEl.innerHTML = "";
    const seen = new Set();
    (items || []).forEach((item) => {
      const opt = document.createElement("option");
      opt.value = item.code;
      opt.textContent = item.label;
      selectEl.appendChild(opt);
      seen.add(item.code);
    });
    if (prevVal && !seen.has(prevVal)) {
      const fallback = document.createElement("option");
      fallback.value = prevVal;
      fallback.textContent = prevVal;
      selectEl.appendChild(fallback);
    }
    if (prevVal) selectEl.value = prevVal;
  }

  function renderLookupsIntoForm() {
    populateSelectOptions(dom.technique, lookups.techniques);
    populateSelectOptions(dom.status, lookups.statuses);
    populateSelectOptions(dom.medium, lookups.mediums);

    if (dom.presetsWrap) {
      dom.presetsWrap.innerHTML = "";
      (lookups.dimensionPresets || []).forEach((p) => {
        const w = (p.meta && p.meta.w) || 50;
        const h = (p.meta && p.meta.h) || 70;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "preset-chip";
        btn.textContent = p.label || `${w}×${h}`;
        btn.addEventListener("click", () => {
          if (dom.width) dom.width.value = w;
          if (dom.height) dom.height.value = h;
          updateSofaPreview();
        });
        dom.presetsWrap.appendChild(btn);
      });
    }
  }

  async function loadLookups() {
    try {
      const resp = await fetch("/api/lookups");
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const data = await resp.json();
      if (data && Array.isArray(data.techniques)) {
        lookups = {
          techniques: data.techniques || [],
          statuses: data.statuses || [],
          mediums: data.mediums || [],
          dimensionPresets: data.dimensionPresets || [],
        };
        renderLookupsIntoForm();
        if (artworks.length > 0) renderInventory();
        if (dom.lookupsModal && dom.lookupsModal.classList.contains("open")) {
          renderLookupsManager();
        }
      }
    } catch (err) {
      console.warn("Lookups load fallback:", err);
      renderLookupsIntoForm();
    }
  }

  function showLookupMsg(text, isErr = false) {
    if (!dom.lookupStatusMsg) return;
    dom.lookupStatusMsg.textContent = text;
    dom.lookupStatusMsg.className = isErr ? "settings-error" : "settings-success";
    dom.lookupStatusMsg.style.display = "block";
    if (!isErr) {
      setTimeout(() => {
        if (dom.lookupStatusMsg.textContent === text) dom.lookupStatusMsg.style.display = "none";
      }, 3000);
    }
  }

  function getCategoryItems(cat) {
    if (cat === "technique") return lookups.techniques || [];
    if (cat === "status") return lookups.statuses || [];
    if (cat === "medium") return lookups.mediums || [];
    return lookups.dimensionPresets || [];
  }

  function renderLookupsManager() {
    if (!dom.lookupsList) return;
    const isDims = activeLookupCategory === "dimension_preset";
    const isStatus = activeLookupCategory === "status";

    if (dom.lookupNewLabel) dom.lookupNewLabel.style.display = isDims ? "none" : "block";
    if (dom.lookupNewDimsWrap) dom.lookupNewDimsWrap.style.display = isDims ? "inline-flex" : "none";
    if (dom.lookupNewColor) dom.lookupNewColor.style.display = isStatus ? "block" : "none";
    if (dom.lookupNewFilterWrap) dom.lookupNewFilterWrap.style.display = isStatus ? "inline-flex" : "none";

    dom.lookupTabBtns.forEach((b) => b.classList.toggle("active", b.dataset.category === activeLookupCategory));

    const items = getCategoryItems(activeLookupCategory);
    dom.lookupsList.innerHTML = "";
    if (items.length === 0) {
      dom.lookupsList.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:20px;">Žiadne položky.</p>`;
      return;
    }

    items.forEach((item, idx) => {
      const row = document.createElement("div");
      row.className = "lookup-row";

      if (isDims) {
        const wVal = (item.meta && item.meta.w) || 50;
        const hVal = (item.meta && item.meta.h) || 70;
        row.innerHTML = `
          <input type="number" class="edit-input lk-w" value="${wVal}" min="5" max="400" style="width:82px;">
          <span>×</span>
          <input type="number" class="edit-input lk-h" value="${hVal}" min="5" max="400" style="width:82px;">
          <span style="font-size:0.8rem;color:var(--text-muted);flex:1;">cm</span>
        `;
      } else {
        row.innerHTML = `
          <input type="text" class="edit-input lk-label" value="${(item.label || "").replace(/"/g, "&quot;")}" style="flex:1;min-width:130px;">
        `;
        if (isStatus) {
          const colors = [
            ["green", "Zelená"], ["yellow", "Žltá"], ["gray", "Sivá"],
            ["blue", "Modrá"], ["purple", "Fialová"], ["red", "Červená"],
          ];
          const sel = document.createElement("select");
          sel.className = "edit-select lk-color";
          sel.style.width = "auto";
          colors.forEach(([val, lbl]) => {
            const o = document.createElement("option");
            o.value = val;
            o.textContent = lbl;
            if ((item.color || "blue") === val) o.selected = true;
            sel.appendChild(o);
          });
          row.appendChild(sel);

          const chkLbl = document.createElement("label");
          chkLbl.style.cssText = "display:inline-flex;align-items:center;gap:4px;font-size:0.78rem;white-space:nowrap;";
          chkLbl.innerHTML = `<input type="checkbox" class="lk-filter" ${item.showInFilter !== false ? "checked" : ""}> Filter`;
          row.appendChild(chkLbl);
        }
      }

      const actions = document.createElement("div");
      actions.style.cssText = "display:flex;gap:4px;align-items:center;";
      actions.innerHTML = `
        <button type="button" class="adm-icon-btn lk-up" title="Vyššie" ${idx === 0 ? "disabled" : ""}>↑</button>
        <button type="button" class="adm-icon-btn lk-down" title="Nižšie" ${idx === items.length - 1 ? "disabled" : ""}>↓</button>
        <button type="button" class="adm-icon-btn lk-save" title="Uložiť zmenu">💾</button>
        <button type="button" class="adm-icon-btn lk-del" title="Vymazať" style="color:#ef4444;">🗑️</button>
      `;
      row.appendChild(actions);

      actions.querySelector(".lk-up").addEventListener("click", () => reorderLookup(activeLookupCategory, idx, -1));
      actions.querySelector(".lk-down").addEventListener("click", () => reorderLookup(activeLookupCategory, idx, 1));
      actions.querySelector(".lk-save").addEventListener("click", async () => {
        const payload = {};
        if (isDims) {
          payload.w = parseFloat(row.querySelector(".lk-w").value);
          payload.h = parseFloat(row.querySelector(".lk-h").value);
        } else {
          payload.label = row.querySelector(".lk-label").value.trim();
          if (isStatus) {
            payload.color = row.querySelector(".lk-color").value;
            payload.showInFilter = row.querySelector(".lk-filter").checked;
          }
        }
        try {
          const resp = await fetch(`/api/lookups/${item.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || ("HTTP " + resp.status));
          await loadLookups();
          if (activeLookupCategory === "technique" || activeLookupCategory === "medium") {
            await loadArtworks();
          }
          showLookupMsg("✓ Položka aktualizovaná.");
        } catch (err) {
          showLookupMsg("Chyba: " + err.message, true);
        }
      });

      actions.querySelector(".lk-del").addEventListener("click", async () => {
        if (!confirm(`Odstrániť položku „${item.label}“ z číselníka? Existujúcim obrazom hodnota zostane.`)) return;
        try {
          const resp = await fetch(`/api/lookups/${item.id}`, { method: "DELETE" });
          if (!resp.ok) throw new Error("HTTP " + resp.status);
          await loadLookups();
          showLookupMsg("✓ Položka odstránená z číselníka.");
        } catch (err) {
          showLookupMsg("Chyba mazania: " + err.message, true);
        }
      });

      dom.lookupsList.appendChild(row);
    });
  }

  async function reorderLookup(cat, idx, delta) {
    const items = [...getCategoryItems(cat)];
    const target = idx + delta;
    if (target < 0 || target >= items.length) return;
    const [moved] = items.splice(idx, 1);
    items.splice(target, 0, moved);
    try {
      const resp = await fetch("/api/lookups/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: cat, orderedIds: items.map((x) => x.id) }),
      });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      await loadLookups();
    } catch (err) {
      showLookupMsg("Chyba poradia: " + err.message, true);
    }
  }

  function openLookupsModal() {
    if (!dom.lookupsModal) return;
    renderLookupsManager();
    if (dom.lookupStatusMsg) dom.lookupStatusMsg.style.display = "none";
    dom.lookupsModal.classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function closeLookupsModal() {
    if (!dom.lookupsModal) return;
    dom.lookupsModal.classList.remove("open");
    document.body.style.overflow = "";
  }

  // ---- Automation Channels Modal (Per-Network ON/OFF Switches) & Artwork Publish Panel ----
  function showAutoMsg(text, isErr = false) {
    if (!dom.autoStatusMsg) return;
    dom.autoStatusMsg.textContent = text;
    dom.autoStatusMsg.className = isErr ? "settings-error" : "settings-success";
    dom.autoStatusMsg.style.display = "block";
    if (!isErr) {
      setTimeout(() => {
        if (dom.autoStatusMsg.textContent === text) dom.autoStatusMsg.style.display = "none";
      }, 3000);
    }
  }

  async function loadAutomationChannels() {
    try {
      const resp = await fetch("/api/automation/channels");
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const data = await resp.json();
      automationChannels = Array.isArray(data.channels) ? data.channels : [];
      automationSummary = data.summary || { enabledCount: 0, totalChannels: automationChannels.length, pendingArtworksCount: 0 };
      if (dom.automationModal && dom.automationModal.classList.contains("open")) {
        renderAutomationModal();
      }
      if (editingId) {
        const curArt = artworks.find((a) => a.id === editingId);
        if (curArt) renderArtworkPublishPanel(curArt);
      }
    } catch (err) {
      console.warn("Automation channels load failed:", err);
    }
  }

  async function toggleAutomationChannel(key, patch, onRevert) {
    try {
      const resp = await fetch(`/api/automation/channels/${encodeURIComponent(key)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (resp.status === 401) {
        closeAutomationModal();
        showAuthGate("Prihlásenie vypršalo. Prihlás sa znova.");
        return;
      }
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.channel) {
        throw new Error(data.error || ("HTTP " + resp.status));
      }
      const idx = automationChannels.findIndex((c) => c.key === key);
      if (idx !== -1) automationChannels[idx] = data.channel;
      await loadAutomationChannels();
      const stateLabel = data.channel.enabled ? "zapnutá" : "vypnutá";
      showAutoMsg(`✓ ${data.channel.label}: automatizácia ${stateLabel}.`);
    } catch (err) {
      if (typeof onRevert === "function") onRevert();
      showAutoMsg("Chyba uloženia prepínača: " + err.message, true);
    }
  }

  function renderAutomationChannelRow(ch) {
    const row = document.createElement("div");
    row.className = "adm-auto-row";
    row.dataset.channelKey = ch.key;

    const variantText = ch.imageVariant === "clean" ? "Čistá fotka" : "4:5 štylizovaná";
    const statusPillClass = ch.implemented ? "ready" : "stub";
    const statusPillText = ch.implemented ? "Pripravené" : "Predpríprava";

    const draftControl = ch.kind === "marketplace"
      ? `<label class="adm-auto-draft-label" title="Bezpečný režim: uloží iba koncept / neaktívnu ponuku">
           <input type="checkbox" class="adm-auto-draft-chk" ${!ch.autoPublish ? "checked" : ""}>
           Len koncept
         </label>`
      : "";

    row.innerHTML = `
      <div class="adm-auto-row-info">
        <div class="adm-auto-row-title">
          <span>${ch.label}</span>
          <span class="adm-auto-pill ${statusPillClass}">${statusPillText}</span>
          <span class="adm-auto-pill">${variantText}</span>
        </div>
      </div>
      <div class="adm-auto-row-controls">
        ${draftControl}
        <label class="adm-switch" title="Zapnúť / vypnúť ${ch.label}">
          <input type="checkbox" class="adm-auto-toggle-chk" ${ch.enabled ? "checked" : ""} aria-label="Prepínač automatizácie ${ch.label}">
          <span class="adm-switch-track"></span>
          <span class="adm-switch-thumb"></span>
        </label>
      </div>
    `;

    const toggleChk = row.querySelector(".adm-auto-toggle-chk");
    toggleChk.addEventListener("change", () => {
      const nextVal = toggleChk.checked;
      toggleAutomationChannel(ch.key, { enabled: nextVal }, () => {
        toggleChk.checked = !nextVal;
      });
    });

    const draftChk = row.querySelector(".adm-auto-draft-chk");
    if (draftChk) {
      draftChk.addEventListener("change", () => {
        const nextAutoPublish = !draftChk.checked;
        toggleAutomationChannel(ch.key, { autoPublish: nextAutoPublish }, () => {
          draftChk.checked = !draftChk.checked;
        });
      });
    }

    return row;
  }

  function renderAutomationModal() {
    if (dom.autoSummary) {
      const enabledCount = automationChannels.filter((c) => c.enabled).length;
      const pendingCount = automationSummary.pendingArtworksCount || 0;
      dom.autoSummary.textContent = `Aktívnych sietí: ${enabledCount} / ${automationChannels.length} · Čakajúcich diel: ${pendingCount}`;
    }
    if (dom.autoSocialList) {
      dom.autoSocialList.innerHTML = "";
      automationChannels
        .filter((c) => c.kind === "social")
        .forEach((ch) => dom.autoSocialList.appendChild(renderAutomationChannelRow(ch)));
    }
    if (dom.autoMarketList) {
      dom.autoMarketList.innerHTML = "";
      automationChannels
        .filter((c) => c.kind !== "social")
        .forEach((ch) => dom.autoMarketList.appendChild(renderAutomationChannelRow(ch)));
    }
  }

  function openAutomationModal() {
    if (!dom.automationModal) return;
    if (dom.autoStatusMsg) dom.autoStatusMsg.style.display = "none";
    renderAutomationModal();
    dom.automationModal.classList.add("open");
    document.body.style.overflow = "hidden";
    loadAutomationChannels();
  }

  function closeAutomationModal() {
    if (!dom.automationModal) return;
    dom.automationModal.classList.remove("open");
    document.body.style.overflow = "";
  }

  function renderArtworkPublishPanel(art) {
    if (!dom.publishPanel || !dom.publishStatusList) return;
    if (!art || !art.id) {
      dom.publishPanel.style.display = "none";
      return;
    }
    dom.publishPanel.style.display = "flex";

    if (dom.socialThumbWrap && dom.socialThumbImg) {
      if (art.socialImageUrl) {
        dom.socialThumbImg.src = toThumbUrl(art.socialImageUrl);
        dom.socialThumbWrap.style.display = "flex";
      } else {
        dom.socialThumbWrap.style.display = "none";
      }
    }

    dom.publishStatusList.innerHTML = "";
    const statusMap = art.publishStatus || {};
    const channelsToShow = automationChannels.length > 0
      ? automationChannels
      : [
          { key: "instagram", label: "Instagram", enabled: false },
          { key: "facebook", label: "Facebook", enabled: false },
          { key: "aukro", label: "Aukro", enabled: false },
          { key: "sashe", label: "Sashe.sk", enabled: false },
        ];

    channelsToShow.forEach((ch) => {
      const entry = statusMap[ch.key] || {};
      const st = entry.status || "pending";
      if (!ch.enabled && st === "pending" && editingPublishChannels[ch.key] === undefined) {
        return;
      }

      const chip = document.createElement("div");
      chip.className = "adm-pub-chip";
      const isIncluded = editingPublishChannels[ch.key] !== false;
      const stateLabels = {
        published: "Publikované",
        drafted: "Koncept",
        error: "Chyba",
        pending: ch.enabled ? "Čaká" : "Vypnuté",
      };

      chip.innerHTML = `
        <label class="adm-pub-chip-left" title="Zahrnúť toto dielo pre ${ch.label}">
          <input type="checkbox" class="adm-art-ch-chk" ${isIncluded ? "checked" : ""}>
          <span class="adm-pub-chip-name">${ch.label}</span>
        </label>
        <div style="display:inline-flex;align-items:center;gap:4px;">
          <span class="adm-pub-state ${st}" title="${entry.error || entry.url || ""}">${stateLabels[st] || st}</span>
          ${(st === "error" || st === "published" || st === "drafted")
            ? `<button type="button" class="adm-icon-btn adm-pub-reset" style="width:22px;height:22px;font-size:0.7rem;" title="Resetovať na čakajúce">↺</button>`
            : ""}
        </div>
      `;

      const chk = chip.querySelector(".adm-art-ch-chk");
      chk.addEventListener("change", () => {
        editingPublishChannels[ch.key] = chk.checked;
      });

      const resetBtn = chip.querySelector(".adm-pub-reset");
      if (resetBtn) {
        resetBtn.addEventListener("click", async () => {
          try {
            const resp = await fetch(`/api/automation/status/${encodeURIComponent(art.id)}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ channel: ch.key, status: "pending", error: "", url: "", externalId: "" }),
            });
            if (!resp.ok) throw new Error("HTTP " + resp.status);
            const data = await resp.json();
            art.publishStatus = data.publishStatus || {};
            renderArtworkPublishPanel(art);
            loadAutomationChannels();
          } catch (err) {
            showStatusMsg("Chyba resetu stavu publikovania: " + err.message, true);
          }
        });
      }

      dom.publishStatusList.appendChild(chip);
    });

    if (dom.publishStatusList.children.length === 0) {
      dom.publishStatusList.innerHTML = `<span style="font-size:0.76rem;color:var(--text-muted);grid-column:1/-1;">Žiadna sieť nie je zatiaľ zapnutá — zapni požadované kanály cez „⚙️ Nastaviť siete“.</span>`;
    }
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
    editingPublishChannels = {};
    albumPhotos = [];
    pendingThumbMap = {};
    pendingRawDataUrl = null;
    currentRawUrl = "";

    if (dom.formHeading) dom.formHeading.textContent = "➕ Pridať novú maľbu";
    if (dom.form) dom.form.reset();
    if (dom.width) dom.width.value = "50";
    if (dom.height) dom.height.value = "70";
    if (dom.depth) dom.depth.value = "4";
    if (dom.priceEur) dom.priceEur.value = "";
    const pickSafeOption = (sel, preferred) => {
      if (!sel) return;
      if (Array.from(sel.options).some((o) => o.value === preferred)) {
        sel.value = preferred;
      } else if (sel.options.length > 0) {
        sel.selectedIndex = 0;
      }
    };
    pickSafeOption(dom.medium, "Akryl na plátne");
    pickSafeOption(dom.technique, "Mixed");
    pickSafeOption(dom.status, "Available");
    if (dom.date) dom.date.value = new Date().toISOString().slice(0, 10);
    if (dom.instaTestLink) dom.instaTestLink.href = "https://www.instagram.com/platenko.akryl";
    if (dom.statusMsg) dom.statusMsg.style.display = "none";
    if (dom.publishPanel) dom.publishPanel.style.display = "none";

    refreshCoverAndAlbumUI();
    updateSofaPreview();
    renderInventory();
  }

  function loadArtworkIntoForm(art, opts) {
    if (!art) return;
    const options = opts || {};
    editingId = art.id;
    editingPublishChannels = { ...(art.publishChannels || {}) };
    pendingThumbMap = {};
    pendingRawDataUrl = null;
    currentRawUrl = art.rawImage || "";
    albumPhotos = (art.detailImages && art.detailImages.length > 0)
      ? [...art.detailImages]
      : (art.coverImage ? [art.coverImage] : []);

    if (dom.formHeading) dom.formHeading.textContent = `✏️ Upraviť: ${art.title}`;
    dom.title.value = art.title || "";
    dom.date.value = art.date || "";
    populateSelectOptions(dom.technique, lookups.techniques, art.technique || "Mixed");
    populateSelectOptions(dom.status, lookups.statuses, art.status || "Available");
    populateSelectOptions(dom.medium, lookups.mediums, art.medium || "Akryl na plátne");
    dom.width.value = art.widthCm || 50;
    dom.height.value = art.heightCm || 70;
    dom.depth.value = art.depthCm || 4;
    if (dom.priceEur) {
      dom.priceEur.value = (art.priceEur !== null && art.priceEur !== undefined && art.priceEur !== "") ? art.priceEur : "";
    }
    dom.instagramUrl.value = art.instagramUrl || "";
    dom.description.value = art.description || "";
    if (dom.instaTestLink) {
      dom.instaTestLink.href = (art.instagramUrl && art.instagramUrl.trim()) || "https://www.instagram.com/platenko.akryl";
    }

    refreshCoverAndAlbumUI();
    updateSofaPreview();
    renderArtworkPublishPanel(art);
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

  let dragState = null;

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
      dom.inventoryBody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:28px;color:var(--text-muted);">Žiadne diela.</td></tr>`;
      return;
    }

    filtered.forEach((art) => {
      const globalIdx = artworks.indexOf(art);
      const tr = document.createElement("tr");
      tr.dataset.artId = art.id;
      tr.dataset.globalIdx = String(globalIdx);
      if (editingId && art.id === editingId) {
        tr.classList.add("is-active");
      }
      const thumbSrc = toThumbUrl(art.coverImage);
      const dimsLabel = `${art.widthCm || 50} × ${art.heightCm || 70} × ${art.depthCm || 4} cm`;
      const isSearching = Boolean(q);

      tr.innerHTML = `
        <td class="adm-order-cell">
          <div class="adm-order-wrap">
            <button type="button" class="adm-drag-handle" title="${isSearching ? "Zruš vyhľadávanie pre presun ťahaním" : "Chyť a potiahni pre zmenu poradia"}" aria-label="Presunúť dielo ťahaním" ${isSearching ? "disabled" : ""}>⋮⋮</button>
            <button type="button" class="adm-pos-btn" title="Klikni a zadaj cieľovú pozíciu (1–${artworks.length})" aria-label="Zmeniť pozíciu #${globalIdx + 1}">${globalIdx + 1}</button>
          </div>
        </td>
        <td>
          <img src="${thumbSrc}" alt="${art.title}" class="adm-row-thumb" loading="lazy" decoding="async">
        </td>
        <td>
          <strong style="display:block;font-size:0.92rem;">${art.title}</strong>
          <span style="font-size:0.78rem;color:var(--text-muted);">${dimsLabel} · ${art.date || art.year || ""} · ${art.photoCount || (art.detailImages ? art.detailImages.length : 1)} fotiek</span>
        </td>
        <td>
          <select class="status-select adm-row-status"></select>
        </td>
        <td style="text-align:right;white-space:nowrap;">
          <button type="button" class="adm-icon-btn adm-edit-btn" title="Upraviť">✏️</button>
          <button type="button" class="adm-icon-btn adm-del-btn" title="Vymazať" style="color:#ef4444;">🗑️</button>
        </td>
      `;

      const rowStatusSel = tr.querySelector(".adm-row-status");
      populateSelectOptions(rowStatusSel, lookups.statuses, art.status || "Available");
      rowStatusSel.addEventListener("change", async (e) => {
        const newStatus = e.target.value;
        art.status = newStatus;
        await quickUpdateArtwork(art.id, { status: newStatus });
      });

      const dragHandle = tr.querySelector(".adm-drag-handle");
      if (dragHandle && !isSearching) {
        dragHandle.addEventListener("pointerdown", (e) => startRowDrag(e, tr, art, globalIdx));
      }
      const posBtn = tr.querySelector(".adm-pos-btn");
      if (posBtn) {
        posBtn.addEventListener("click", () => openInlinePositionEditor(tr, art, globalIdx));
      }

      tr.querySelector(".adm-edit-btn").addEventListener("click", () => loadArtworkIntoForm(art));
      tr.querySelector(".adm-del-btn").addEventListener("click", () => deleteArtwork(art));

      dom.inventoryBody.appendChild(tr);
    });
  }

  function openInlinePositionEditor(tr, art, globalIdx) {
    const posBtn = tr.querySelector(".adm-pos-btn");
    if (!posBtn || !posBtn.parentNode || artworks.length < 2) return;

    const input = document.createElement("input");
    input.type = "number";
    input.className = "adm-pos-input";
    input.min = "1";
    input.max = String(artworks.length);
    input.value = String(globalIdx + 1);
    input.setAttribute("aria-label", `Cieľová pozícia pre ${art.title || "dielo"}`);

    posBtn.replaceWith(input);
    input.focus();
    input.select();

    let finished = false;
    const restore = () => {
      if (input.parentNode) {
        input.replaceWith(posBtn);
      }
    };
    const commit = () => {
      if (finished) return;
      finished = true;
      const val = parseInt(input.value, 10);
      if (Number.isNaN(val)) {
        restore();
        return;
      }
      const clampedPos = Math.min(artworks.length, Math.max(1, val));
      const targetIdx = clampedPos - 1;
      if (targetIdx !== globalIdx) {
        reorderArtworkToIndex(art.id, targetIdx, { scrollToMoved: true });
      } else {
        restore();
      }
    };
    const cancel = () => {
      if (finished) return;
      finished = true;
      restore();
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    });
    input.addEventListener("blur", commit);
  }

  function startRowDrag(e, sourceRow, art, fromIdx) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if ((dom.searchInput ? dom.searchInput.value : "").trim().length > 0) return;
    if (artworks.length < 2 || dragState) return;
    e.preventDefault();

    const ghostEl = document.createElement("div");
    ghostEl.className = "adm-drag-ghost";
    const ghostImg = document.createElement("img");
    ghostImg.src = toThumbUrl(art.coverImage);
    ghostImg.alt = "";
    const ghostTitle = document.createElement("span");
    ghostTitle.className = "adm-drag-ghost-title";
    ghostTitle.textContent = art.title || "Bez názvu";
    const ghostPosEl = document.createElement("span");
    ghostPosEl.className = "adm-drag-ghost-pos";
    ghostPosEl.textContent = `→ #${fromIdx + 1}`;
    ghostEl.appendChild(ghostImg);
    ghostEl.appendChild(ghostTitle);
    ghostEl.appendChild(ghostPosEl);
    document.body.appendChild(ghostEl);

    sourceRow.classList.add("adm-row-dragging");
    document.body.classList.add("adm-is-dragging");

    dragState = {
      artId: art.id,
      fromIdx,
      toIdx: fromIdx,
      insertSlot: fromIdx,
      sourceRow,
      ghostEl,
      ghostPosEl,
      lastX: e.clientX,
      lastY: e.clientY,
      rafId: null,
    };

    const clearDropIndicators = () => {
      if (!dom.inventoryBody) return;
      dom.inventoryBody.querySelectorAll("tr.adm-drop-before, tr.adm-drop-after").forEach((r) => {
        r.classList.remove("adm-drop-before", "adm-drop-after");
      });
    };

    const updateDropTargetFromPointer = () => {
      if (!dragState || !dom.inventoryBody) return;
      const rows = Array.from(dom.inventoryBody.querySelectorAll("tr[data-art-id]"));
      clearDropIndicators();
      let insertSlot = rows.length;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rect = row.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (dragState.lastY < midY) {
          insertSlot = i;
          row.classList.add("adm-drop-before");
          break;
        }
        if (i === rows.length - 1) {
          insertSlot = rows.length;
          row.classList.add("adm-drop-after");
        }
      }

      const toIdx = insertSlot > dragState.fromIdx ? insertSlot - 1 : insertSlot;
      dragState.insertSlot = insertSlot;
      dragState.toIdx = Math.max(0, Math.min(artworks.length - 1, toIdx));
      dragState.ghostPosEl.textContent = `→ #${dragState.toIdx + 1}`;

      const left = Math.min(Math.max(12, dragState.lastX + 14), Math.max(12, window.innerWidth - 270));
      const top = Math.min(Math.max(12, dragState.lastY - 24), Math.max(12, window.innerHeight - 60));
      dragState.ghostEl.style.left = `${left}px`;
      dragState.ghostEl.style.top = `${top}px`;
    };

    const autoScrollStep = () => {
      if (!dragState) return;
      if (dom.inventoryScroll) {
        const rect = dom.inventoryScroll.getBoundingClientRect();
        const edgeZone = 56;
        if (dragState.lastY < rect.top + edgeZone) {
          const intensity = Math.min(1.5, Math.max(0.15, (rect.top + edgeZone - dragState.lastY) / edgeZone));
          dom.inventoryScroll.scrollTop -= Math.round(intensity * 14);
          updateDropTargetFromPointer();
        } else if (dragState.lastY > rect.bottom - edgeZone) {
          const intensity = Math.min(1.5, Math.max(0.15, (dragState.lastY - (rect.bottom - edgeZone)) / edgeZone));
          dom.inventoryScroll.scrollTop += Math.round(intensity * 14);
          updateDropTargetFromPointer();
        }
      }
      dragState.rafId = requestAnimationFrame(autoScrollStep);
    };

    const onPointerMove = (ev) => {
      if (!dragState) return;
      dragState.lastX = ev.clientX;
      dragState.lastY = ev.clientY;
      updateDropTargetFromPointer();
    };

    const cleanupDrag = () => {
      if (!dragState) return;
      if (dragState.rafId) cancelAnimationFrame(dragState.rafId);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
      window.removeEventListener("keydown", onDragKeyDown);
      clearDropIndicators();
      if (dragState.sourceRow) dragState.sourceRow.classList.remove("adm-row-dragging");
      document.body.classList.remove("adm-is-dragging");
      if (dragState.ghostEl && dragState.ghostEl.parentNode) dragState.ghostEl.remove();
      dragState = null;
    };

    const onDragKeyDown = (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        cleanupDrag();
      }
    };

    const onPointerEnd = (ev) => {
      if (!dragState) return;
      const { artId, fromIdx: origIdx, toIdx: destIdx } = dragState;
      cleanupDrag();
      if (ev.type === "pointerup" && typeof destIdx === "number" && destIdx !== origIdx) {
        reorderArtworkToIndex(artId, destIdx);
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);
    window.addEventListener("keydown", onDragKeyDown);

    updateDropTargetFromPointer();
    dragState.rafId = requestAnimationFrame(autoScrollStep);
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

  async function reorderArtworkToIndex(id, targetIdx, opts = {}) {
    const idx = artworks.findIndex((a) => a.id === id);
    if (idx === -1) return;
    const safeTarget = Math.max(0, Math.min(artworks.length - 1, targetIdx));
    if (idx === safeTarget) return;

    const prevScrollTop = dom.inventoryScroll ? dom.inventoryScroll.scrollTop : 0;
    const [moved] = artworks.splice(idx, 1);
    artworks.splice(safeTarget, 0, moved);
    renderInventory();

    const movedRow = dom.inventoryBody
      ? Array.from(dom.inventoryBody.querySelectorAll("tr[data-art-id]")).find((r) => r.dataset.artId === id)
      : null;

    if (opts.scrollToMoved && movedRow) {
      movedRow.scrollIntoView({ block: "nearest", behavior: "smooth" });
    } else if (dom.inventoryScroll) {
      dom.inventoryScroll.scrollTop = prevScrollTop;
    }
    if (movedRow) {
      movedRow.classList.add("adm-row-just-moved");
      setTimeout(() => movedRow.classList.remove("adm-row-just-moved"), 1200);
    }

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
      showStatusMsg(`✓ Poradie uložené (#${idx + 1} → #${safeTarget + 1}).`);
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

      const rawPriceStr = dom.priceEur ? dom.priceEur.value.trim() : "";
      const parsedPrice = rawPriceStr === "" ? null : Number(rawPriceStr);
      const priceEur = (parsedPrice !== null && Number.isFinite(parsedPrice) && parsedPrice >= 0) ? parsedPrice : null;

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
          priceEur,
          publishChannels: { ...editingPublishChannels },
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
          priceEur,
          publishChannels: {},
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
          loadLookups().then(() => loadArtworks());
          loadAutomationChannels();
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

    if (dom.automationBtn) dom.automationBtn.addEventListener("click", openAutomationModal);
    if (dom.openAutoFromPanelBtn) dom.openAutoFromPanelBtn.addEventListener("click", openAutomationModal);
    if (dom.automationCloseBtn) dom.automationCloseBtn.addEventListener("click", closeAutomationModal);
    if (dom.automationModal) {
      dom.automationModal.addEventListener("click", (e) => {
        if (e.target === dom.automationModal) closeAutomationModal();
      });
    }

    if (dom.lookupsBtn) dom.lookupsBtn.addEventListener("click", openLookupsModal);
    if (dom.lookupsCloseBtn) dom.lookupsCloseBtn.addEventListener("click", closeLookupsModal);
    if (dom.lookupsModal) {
      dom.lookupsModal.addEventListener("click", (e) => {
        if (e.target === dom.lookupsModal) closeLookupsModal();
      });
    }
    dom.lookupTabBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        activeLookupCategory = btn.dataset.category;
        renderLookupsManager();
      });
    });
    if (dom.lookupAddForm) {
      dom.lookupAddForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const payload = { category: activeLookupCategory };
        if (activeLookupCategory === "dimension_preset") {
          payload.w = parseFloat(dom.lookupNewW.value);
          payload.h = parseFloat(dom.lookupNewH.value);
        } else {
          payload.label = dom.lookupNewLabel.value.trim();
          if (activeLookupCategory === "status") {
            payload.color = dom.lookupNewColor.value;
            payload.showInFilter = dom.lookupNewShowFilter.checked;
          }
        }
        try {
          const resp = await fetch("/api/lookups", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || ("HTTP " + resp.status));
          if (dom.lookupNewLabel) dom.lookupNewLabel.value = "";
          if (dom.lookupNewW) dom.lookupNewW.value = "";
          if (dom.lookupNewH) dom.lookupNewH.value = "";
          await loadLookups();
          showLookupMsg("✓ Nová položka pridaná.");
        } catch (err) {
          showLookupMsg("Chyba pridania: " + err.message, true);
        }
      });
    }

    try {
      const resp = await fetch("/api/auth/me");
      const data = await resp.json();
      if (data && data.authenticated) {
        hideAuthGate();
        resetForm();
        await loadLookups();
        loadAutomationChannels();
        loadArtworks();
      } else {
        showAuthGate();
      }
    } catch {
      showAuthGate("Nepodarilo sa overiť prihlásenie.");
    }
  });
})();
