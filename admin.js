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
  let currentSocialImageUrl = "";

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
  let automationIntegrations = [];
  let encryptionKeyConfigured = true;
  let activeAutoTab = "channels";
  let integrationsUnlocked = false;
  let editingPublishChannels = {};
  let photoDragState = null;
  let suppressNextPhotoClick = false;
  let currentUsername = "mario";
  let activeEditorTab = "photo";
  let activeCatalogFilter = "all";
  let isFormDirty = false;
  let inquiriesList = [];
  let currentSiteSettings = {};

  const dom = {};
  function cacheDom() {
    dom.authOverlay = document.getElementById("adminAuthOverlay");
    dom.loginForm = document.getElementById("adminLoginForm");
    dom.loginUser = document.getElementById("adminLoginUsername");
    dom.loginPass = document.getElementById("adminLoginPassword");
    dom.authError = document.getElementById("adminAuthError");
    dom.loginSubmit = document.getElementById("adminLoginSubmit");

    dom.main = document.getElementById("adminMain");
    dom.adminSubnav = document.getElementById("adminSubnav");
    dom.logoutBtn = document.getElementById("adminLogoutBtn");
    dom.inquiriesBtn = document.getElementById("adminInquiriesBtn");
    dom.inquiriesBadge = document.getElementById("adminInquiriesBadge");
    dom.automationBtn = document.getElementById("adminAutomationBtn");
    dom.lookupsBtn = document.getElementById("adminLookupsBtn");
    dom.siteSettingsBtn = document.getElementById("adminSiteSettingsBtn");
    dom.accountBtn = document.getElementById("adminAccountBtn");
    dom.sorterLink = document.getElementById("adminSorterLink");
    dom.brandTitle = document.getElementById("adminBrandTitle");
    dom.brandSubtitle = document.getElementById("adminBrandSubtitle");

    dom.inquiriesModal = document.getElementById("inquiriesModal");
    dom.inquiriesCloseBtn = document.getElementById("inquiriesCloseBtn");
    dom.inquiriesStatusMsg = document.getElementById("admInquiriesStatusMsg");
    dom.inquiriesList = document.getElementById("admInquiriesList");

    dom.siteSettingsModal = document.getElementById("siteSettingsModal");
    dom.siteSettingsCloseBtn = document.getElementById("siteSettingsCloseBtn");
    dom.siteStatusMsg = document.getElementById("admSiteStatusMsg");
    dom.siteSettingsForm = document.getElementById("admSiteSettingsForm");
    dom.siteSaveBtn = document.getElementById("admSiteSaveBtn");
    dom.siteBrandTitle = document.getElementById("siteSetBrandTitle");
    dom.siteBrandSubtitle = document.getElementById("siteSetBrandSubtitle");
    dom.siteHeroTitle = document.getElementById("siteSetHeroTitle");
    dom.siteHeroSubtitle = document.getElementById("siteSetHeroSubtitle");
    dom.siteAboutHeading = document.getElementById("siteSetAboutHeading");
    dom.siteContactEmail = document.getElementById("siteSetContactEmail");
    dom.siteAboutText = document.getElementById("siteSetAboutText");
    dom.siteCustomOrder = document.getElementById("siteSetCustomOrder");
    dom.siteShipping = document.getElementById("siteSetShipping");
    dom.siteIgHandle = document.getElementById("siteSetInstagramHandle");
    dom.siteIgUrl = document.getElementById("siteSetInstagramUrl");
    dom.siteHashtags = document.getElementById("siteSetHashtags");
    dom.siteFooterText = document.getElementById("siteSetFooterText");

    dom.accountModal = document.getElementById("accountModal");
    dom.accountCloseBtn = document.getElementById("accountCloseBtn");
    dom.accountUsername = document.getElementById("admAccountUsername");
    dom.changePassForm = document.getElementById("admChangePassForm");
    dom.curPass = document.getElementById("admCurrentPassword");
    dom.newPass = document.getElementById("admNewPassword");
    dom.confirmPass = document.getElementById("admConfirmPassword");
    dom.changePassMsg = document.getElementById("admChangePassMsg");
    dom.accountLogoutBtn = document.getElementById("admAccountLogoutBtn");

    dom.automationModal = document.getElementById("automationModal");
    dom.automationCloseBtn = document.getElementById("automationCloseBtn");
    dom.autoTabBtns = Array.from(document.querySelectorAll("#automationModal .auto-tab-btn"));
    dom.autoTabChannels = document.getElementById("admAutoTabChannels");
    dom.autoTabIntegrations = document.getElementById("admAutoTabIntegrations");
    dom.autoSummary = document.getElementById("admAutoSummary");
    dom.autoWarningBanner = document.getElementById("admAutoWarningBanner");
    dom.autoStatusMsg = document.getElementById("admAutoStatusMsg");
    dom.autoSocialList = document.getElementById("admAutoSocialList");
    dom.autoMarketList = document.getElementById("admAutoMarketList");
    dom.integEncryptionNotice = document.getElementById("admIntegEncryptionNotice");
    dom.integLockBox = document.getElementById("admIntegLockBox");
    dom.integLockedState = document.getElementById("admIntegLockedState");
    dom.integUnlockedState = document.getElementById("admIntegUnlockedState");
    dom.integUnlockForm = document.getElementById("admIntegUnlockForm");
    dom.integUnlockPass = document.getElementById("admIntegUnlockPass");
    dom.integUnlockBtn = document.getElementById("admIntegUnlockBtn");
    dom.integUnlockErr = document.getElementById("admIntegUnlockErr");
    dom.integLockBtn = document.getElementById("admIntegLockBtn");
    dom.refreshTokensBtn = document.getElementById("admRefreshTokensBtn");
    dom.integrationsList = document.getElementById("admIntegrationsList");

    dom.lookupsModal = document.getElementById("lookupsModal");
    dom.lookupsCloseBtn = document.getElementById("lookupsCloseBtn");
    dom.lookupTabBtns = Array.from(document.querySelectorAll("#lookupsModal .lookup-tab-btn"));
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
    dom.editorTabs = Array.from(document.querySelectorAll("#artworkFormCard .adm-editor-tab"));
    dom.editorPanels = Array.from(document.querySelectorAll("#artworkFormCard .adm-editor-panel"));
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
    dom.priceAukro = document.getElementById("admPriceAukro");
    dom.priceSashe = document.getElementById("admPriceSashe");
    dom.priceEtsy = document.getElementById("admPriceEtsy");
    dom.instagramUrl = document.getElementById("admInstagramUrl");
    dom.instaTestLink = document.getElementById("admInstaTestLink");
    dom.description = document.getElementById("admDescription");
    dom.webReadinessList = document.getElementById("admWebReadinessList");
    dom.viewPublicLink = document.getElementById("admViewPublicLink");
    dom.publishNewHint = document.getElementById("admPublishNewHint");
    dom.publishPanel = document.getElementById("admPublishPanel");
    dom.openAutoFromPanelBtn = document.getElementById("admOpenAutoFromPanelBtn");
    dom.socialThumbWrap = document.getElementById("admSocialThumbWrap");
    dom.socialThumbImg = document.getElementById("admSocialThumbImg");
    dom.socialThumbTitle = document.getElementById("admSocialThumbTitle");
    dom.socialThumbDesc = document.getElementById("admSocialThumbDesc");
    dom.publishStatusList = document.getElementById("admPublishStatusList");
    dom.publishNowBtn = document.getElementById("admPublishNowBtn");
    dom.publishResultBox = document.getElementById("admPublishResultBox");
    dom.dirtyBadge = document.getElementById("admDirtyBadge");
    dom.statusMsg = document.getElementById("admStatusMsg");
    dom.saveBtn = document.getElementById("admSaveBtn");

    dom.totalCount = document.getElementById("admTotalCount");
    dom.searchInput = document.getElementById("admSearchInput");
    dom.catalogFilterBtns = Array.from(document.querySelectorAll("#admCatalogFilters .adm-cat-chip"));
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
    if (dom.adminSubnav) dom.adminSubnav.style.display = "none";
    if (dom.logoutBtn) dom.logoutBtn.style.display = "none";
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
    if (dom.adminSubnav) dom.adminSubnav.style.display = "block";
    if (dom.logoutBtn) dom.logoutBtn.style.display = "inline-flex";
    if (dom.accountUsername) dom.accountUsername.textContent = currentUsername || "mario";
  }

  function setEditorTab(tabName) {
    activeEditorTab = (tabName === "details" || tabName === "publish") ? tabName : "photo";
    (dom.editorTabs || []).forEach((btn) => {
      const active = btn.dataset.edTab === activeEditorTab;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    (dom.editorPanels || []).forEach((p) => {
      p.classList.toggle("active", p.dataset.edPanel === activeEditorTab);
    });
    if (activeEditorTab === "photo") updateSofaPreview();
    if (activeEditorTab === "publish") renderWebReadiness();
  }

  function setFormDirty(dirty) {
    isFormDirty = Boolean(dirty);
    if (dom.dirtyBadge) dom.dirtyBadge.classList.toggle("visible", isFormDirty);
    if (dom.saveBtn) dom.saveBtn.classList.toggle("is-dirty", isFormDirty);
  }

  function confirmDiscardIfDirty() {
    if (!isFormDirty) return true;
    return confirm("Máš neuložené zmeny v aktuálnom diele. Chceš ich zahodiť?");
  }

  function renderWebReadiness() {
    if (!dom.webReadinessList) return;
    const hasPhoto = albumPhotos.length > 0;
    const hasTitle = Boolean(dom.title && dom.title.value.trim());
    const hasDims = Boolean(Number(dom.width && dom.width.value) > 0 && Number(dom.height && dom.height.value) > 0);
    const { priceEur, portalPrices } = readPricesFromForm();
    const hasPrice = Boolean((priceEur && priceEur > 0) || Object.values(portalPrices).some((v) => v > 0));
    const hasDesc = Boolean(dom.description && dom.description.value.trim());

    const checks = [
      { ok: hasPhoto, label: hasPhoto ? `Fotka (${albumPhotos.length}×)` : "Chýba fotka" },
      { ok: hasTitle, label: hasTitle ? "Názov vyplnený" : "Chýba názov" },
      { ok: hasDims, label: hasDims ? `${dom.width.value}×${dom.height.value} cm` : "Chýba rozmer" },
      { ok: hasPrice, label: hasPrice ? "Cena zadaná" : "Bez ceny (€)" },
      { ok: hasDesc, label: hasDesc ? "Popis vyplnený" : "Bez popisu" },
    ];
    dom.webReadinessList.innerHTML = checks.map((c) => `
      <div class="adm-readiness-item${c.ok ? " ok" : ""}">
        <span>${c.ok ? "✅" : "⚠️"}</span>
        <span>${c.label}</span>
      </div>
    `).join("");

    if (dom.viewPublicLink) {
      if (editingId) {
        dom.viewPublicLink.href = `/?dielo=${encodeURIComponent(editingId)}`;
        dom.viewPublicLink.style.display = "inline-flex";
      } else {
        dom.viewPublicLink.style.display = "none";
      }
    }
    if (dom.publishNewHint) {
      dom.publishNewHint.style.display = editingId ? "none" : "block";
    }
  }

  function setAdminBrand(section, subtitle) {
    const label = section ? `Plátenko ${section}` : "Plátenko Katalóg";
    const sub = subtitle || "Admin CMS · Správa diel";
    if (dom.brandTitle) dom.brandTitle.textContent = label;
    if (dom.brandSubtitle) dom.brandSubtitle.textContent = sub;
    document.title = `${label} | Admin CMS`;
  }

  function openAccountModal() {
    if (!dom.accountModal) return;
    if (dom.accountUsername) dom.accountUsername.textContent = currentUsername || "mario";
    if (dom.changePassMsg) dom.changePassMsg.style.display = "none";
    if (dom.changePassForm) dom.changePassForm.reset();
    dom.accountModal.classList.add("open");
    document.body.style.overflow = "hidden";
    setAdminBrand("Účet", "Admin CMS · Heslo správcu a prihlásenie");
  }

  function closeAccountModal() {
    if (!dom.accountModal) return;
    dom.accountModal.classList.remove("open");
    document.body.style.overflow = "";
    setAdminBrand();
  }

  // ---- Inquiries Manager Modal (Dopyty z galérie) ----
  function showInquiriesMsg(text, isErr = false) {
    if (!dom.inquiriesStatusMsg) return;
    dom.inquiriesStatusMsg.textContent = text;
    dom.inquiriesStatusMsg.className = isErr ? "settings-error" : "settings-success";
    dom.inquiriesStatusMsg.style.display = "block";
    if (!isErr) {
      setTimeout(() => {
        if (dom.inquiriesStatusMsg.textContent === text) dom.inquiriesStatusMsg.style.display = "none";
      }, 3000);
    }
  }

  function updateInquiriesBadge(unreadCount) {
    if (!dom.inquiriesBadge) return;
    if (unreadCount > 0) {
      dom.inquiriesBadge.textContent = String(unreadCount);
      dom.inquiriesBadge.style.display = "inline-flex";
    } else {
      dom.inquiriesBadge.style.display = "none";
    }
  }

  async function loadInquiries() {
    try {
      const resp = await fetch("/api/inquiries");
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const data = await resp.json();
      inquiriesList = Array.isArray(data.inquiries) ? data.inquiries : [];
      updateInquiriesBadge(Number(data.unreadCount) || 0);
      if (dom.inquiriesModal && dom.inquiriesModal.classList.contains("open")) {
        renderInquiriesList();
      }
    } catch (err) {
      console.warn("Inquiries load failed:", err);
    }
  }

  function renderInquiriesList() {
    if (!dom.inquiriesList) return;
    dom.inquiriesList.innerHTML = "";
    if (inquiriesList.length === 0) {
      dom.inquiriesList.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:24px;">Zatiaľ žiadne prijaté dopyty.</p>`;
      return;
    }

    inquiriesList.forEach((inq) => {
      const card = document.createElement("div");
      card.className = `adm-inq-card${inq.status === "new" ? " is-new" : ""}`;
      const dateStr = inq.createdAt ? new Date(inq.createdAt).toLocaleString("sk-SK") : "";
      const isEmail = inq.senderContact && inq.senderContact.includes("@");

      card.innerHTML = `
        <div class="adm-inq-head">
          <div>
            <strong>${inq.senderName}</strong>
            <span style="font-size:0.8rem;color:var(--text-muted);margin-left:6px;">${inq.senderContact}</span>
            <div style="font-size:0.76rem;color:var(--text-muted);margin-top:2px;">
              ${dateStr}${inq.artworkTitle ? ` · Dielo: <button type="button" class="preset-chip adm-inq-jump" style="padding:1px 7px;">${inq.artworkTitle}</button>` : ""}
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            <select class="status-select adm-inq-status">
              <option value="new" ${inq.status === "new" ? "selected" : ""}>Nový</option>
              <option value="replied" ${inq.status === "replied" ? "selected" : ""}>Vybavený</option>
              <option value="archived" ${inq.status === "archived" ? "selected" : ""}>Archivovaný</option>
            </select>
            ${isEmail ? `<a class="adm-icon-btn" style="text-decoration:none;" href="mailto:${encodeURIComponent(inq.senderContact)}?subject=${encodeURIComponent("Re: Záujem o maľbu " + (inq.artworkTitle || "Plátenko"))}" title="Odpovedať e-mailom">✉️</a>` : ""}
            <button type="button" class="adm-icon-btn adm-inq-del" style="color:#ef4444;" title="Vymazať">🗑️</button>
          </div>
        </div>
        <div class="adm-inq-msg"></div>
      `;
      card.querySelector(".adm-inq-msg").textContent = inq.message || "";

      const jumpBtn = card.querySelector(".adm-inq-jump");
      if (jumpBtn && inq.artworkId) {
        jumpBtn.addEventListener("click", () => {
          const target = artworks.find((a) => a.id === inq.artworkId);
          if (target && confirmDiscardIfDirty()) {
            closeInquiriesModal();
            loadArtworkIntoForm(target);
          }
        });
      }

      card.querySelector(".adm-inq-status").addEventListener("change", async (e) => {
        try {
          const resp = await fetch(`/api/inquiries/${inq.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: e.target.value }),
          });
          if (!resp.ok) throw new Error("HTTP " + resp.status);
          await loadInquiries();
          showInquiriesMsg("✓ Stav dopytu upravený.");
        } catch (err) {
          showInquiriesMsg("Chyba: " + err.message, true);
        }
      });

      card.querySelector(".adm-inq-del").addEventListener("click", async () => {
        if (!confirm(`Vymazať dopyt od „${inq.senderName}“?`)) return;
        try {
          const resp = await fetch(`/api/inquiries/${inq.id}`, { method: "DELETE" });
          if (!resp.ok) throw new Error("HTTP " + resp.status);
          await loadInquiries();
          showInquiriesMsg("✓ Dopyt vymazaný.");
        } catch (err) {
          showInquiriesMsg("Chyba mazania: " + err.message, true);
        }
      });

      dom.inquiriesList.appendChild(card);
    });
  }

  function openInquiriesModal() {
    if (!dom.inquiriesModal) return;
    if (dom.inquiriesStatusMsg) dom.inquiriesStatusMsg.style.display = "none";
    renderInquiriesList();
    dom.inquiriesModal.classList.add("open");
    document.body.style.overflow = "hidden";
    setAdminBrand("Dopyty", "Admin CMS · Prijaté správy z galérie");
    loadInquiries();
  }

  function closeInquiriesModal() {
    if (!dom.inquiriesModal) return;
    dom.inquiriesModal.classList.remove("open");
    document.body.style.overflow = "";
    setAdminBrand();
  }

  // ---- Site Settings & Texts Modal (Web & Texty) ----
  function showSiteMsg(text, isErr = false) {
    if (!dom.siteStatusMsg) return;
    dom.siteStatusMsg.textContent = text;
    dom.siteStatusMsg.className = isErr ? "settings-error" : "settings-success";
    dom.siteStatusMsg.style.display = "block";
    if (!isErr) {
      setTimeout(() => {
        if (dom.siteStatusMsg.textContent === text) dom.siteStatusMsg.style.display = "none";
      }, 3500);
    }
  }

  function populateSiteSettingsForm(s) {
    if (!s) return;
    if (dom.siteBrandTitle) dom.siteBrandTitle.value = s.brandTitle || "";
    if (dom.siteBrandSubtitle) dom.siteBrandSubtitle.value = s.brandSubtitle || "";
    if (dom.siteHeroTitle) dom.siteHeroTitle.value = s.heroTitle || "";
    if (dom.siteHeroSubtitle) dom.siteHeroSubtitle.value = s.heroSubtitle || "";
    if (dom.siteAboutHeading) dom.siteAboutHeading.value = s.aboutHeading || "";
    if (dom.siteContactEmail) dom.siteContactEmail.value = s.contactEmail || "";
    if (dom.siteAboutText) dom.siteAboutText.value = s.aboutText || "";
    if (dom.siteCustomOrder) dom.siteCustomOrder.value = s.aboutCustomOrder || "";
    if (dom.siteShipping) dom.siteShipping.value = s.aboutShipping || "";
    if (dom.siteIgHandle) dom.siteIgHandle.value = s.instagramHandle || "";
    if (dom.siteIgUrl) dom.siteIgUrl.value = s.instagramUrl || "";
    if (dom.siteHashtags) dom.siteHashtags.value = s.defaultHashtags || "";
    if (dom.siteFooterText) dom.siteFooterText.value = s.footerText || "";
  }

  async function loadSiteSettings() {
    try {
      const resp = await fetch("/api/site-settings");
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      currentSiteSettings = await resp.json();
      if (dom.siteSettingsModal && dom.siteSettingsModal.classList.contains("open")) {
        populateSiteSettingsForm(currentSiteSettings);
      }
    } catch (err) {
      console.warn("Site settings load failed:", err);
    }
  }

  function openSiteSettingsModal() {
    if (!dom.siteSettingsModal) return;
    if (dom.siteStatusMsg) dom.siteStatusMsg.style.display = "none";
    populateSiteSettingsForm(currentSiteSettings);
    dom.siteSettingsModal.classList.add("open");
    document.body.style.overflow = "hidden";
    setAdminBrand("Web & Texty", "Admin CMS · Verejné texty, O tvorbe a kontakt");
    loadSiteSettings();
  }

  function closeSiteSettingsModal() {
    if (!dom.siteSettingsModal) return;
    dom.siteSettingsModal.classList.remove("open");
    document.body.style.overflow = "";
    setAdminBrand();
  }

  function handleDeepLinkOpenParam() {
    const params = new URLSearchParams(window.location.search);
    const openParam = (params.get("open") || "").trim().toLowerCase();
    if (!openParam) return;
    if (openParam === "automation") openAutomationModal("channels");
    else if (openParam === "lookups") openLookupsModal();
    else if (openParam === "account") openAccountModal();
    else if (openParam === "inquiries") openInquiriesModal();
    else if (openParam === "site") openSiteSettingsModal();
    params.delete("open");
    const qs = params.toString();
    const cleanUrl = window.location.pathname + (qs ? `?${qs}` : "");
    window.history.replaceState({}, "", cleanUrl);
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
    setAdminBrand("Číselníky", "Admin CMS · Techniky, stavy, médiá a rozmery");
  }

  function closeLookupsModal() {
    if (!dom.lookupsModal) return;
    dom.lookupsModal.classList.remove("open");
    document.body.style.overflow = "";
    setAdminBrand();
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

  function setIntegrationsUnlocked(unlocked) {
    integrationsUnlocked = Boolean(unlocked);
    if (dom.integLockBox) dom.integLockBox.classList.toggle("unlocked", integrationsUnlocked);
    if (dom.integLockedState) dom.integLockedState.style.display = integrationsUnlocked ? "none" : "block";
    if (dom.integUnlockedState) dom.integUnlockedState.style.display = integrationsUnlocked ? "flex" : "none";
    if (dom.integUnlockErr) {
      dom.integUnlockErr.style.display = "none";
      dom.integUnlockErr.textContent = "";
    }
    if (!integrationsUnlocked && dom.integUnlockPass) {
      dom.integUnlockPass.value = "";
    }
    renderIntegrationsList();
  }

  function setAutoTab(tabName) {
    activeAutoTab = tabName === "integrations" ? "integrations" : "channels";
    (dom.autoTabBtns || []).forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.autoTab === activeAutoTab);
    });
    if (dom.autoTabChannels) dom.autoTabChannels.style.display = activeAutoTab === "channels" ? "flex" : "none";
    if (dom.autoTabIntegrations) dom.autoTabIntegrations.style.display = activeAutoTab === "integrations" ? "flex" : "none";
  }

  async function loadAutomationIntegrations() {
    try {
      const resp = await fetch("/api/automation/integrations");
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const data = await resp.json();
      automationIntegrations = Array.isArray(data.integrations) ? data.integrations : [];
      encryptionKeyConfigured = data.encryptionKeyConfigured !== false;
      if (dom.automationModal && dom.automationModal.classList.contains("open")) {
        renderAutomationModal();
        renderIntegrationsList();
      }
    } catch (err) {
      console.warn("Automation integrations load failed:", err);
    }
  }

  function renderIntegrationsList() {
    if (dom.integEncryptionNotice) {
      if (!encryptionKeyConfigured) {
        dom.integEncryptionNotice.style.display = "flex";
        dom.integEncryptionNotice.innerHTML = `<span style="color:#b45309;">⚠️ Na Cloudflare Workeri chýba tajný kľúč <code>AUTOMATION_ENCRYPTION_KEY</code>. Nastav ho raz cez <code>npx wrangler secret put AUTOMATION_ENCRYPTION_KEY</code>, aby sa dali kľúče šifrovane ukladať cez UI.</span>`;
      } else {
        dom.integEncryptionNotice.style.display = "none";
      }
    }
    if (!dom.integrationsList) return;
    dom.integrationsList.innerHTML = "";

    const badgeLabels = {
      connected: "✓ Pripojené",
      configured: "Uložené (čaká na test)",
      error: "⚠️ Chyba",
      disconnected: "Nepripojené",
    };

    automationIntegrations.forEach((integ) => {
      const card = document.createElement("div");
      card.className = "adm-integ-card";
      card.dataset.provider = integ.provider;

      const expStr = integ.expiresAt ? new Date(integ.expiresAt).toLocaleDateString("sk-SK") : "";
      const sourceLabel = integ.source === "env_secret" ? "Cloudflare Secret" : (integ.source === "db" ? "Šifrované v D1" : "");

      const fieldsHtml = integrationsUnlocked
        ? `<div class="adm-integ-fields">${(integ.fields || []).map((f) => `
            <div>
              <label class="edit-label" style="font-size:0.74rem;margin-bottom:3px;">
                ${f.label} ${f.hasValue ? '<span style="color:#16a34a;">(uložené)</span>' : ""}
              </label>
              <input
                type="${f.secret ? "password" : "text"}"
                class="edit-input adm-integ-input"
                data-field="${f.key}"
                autocomplete="off"
                placeholder="${f.hasValue ? "•••• (ponechaj prázdne pre zachovanie)" : (f.placeholder || "")}"
              >
            </div>
          `).join("")}</div>`
        : "";

      const actionsHtml = integrationsUnlocked
        ? `
          <button type="button" class="btn-primary adm-integ-save" style="padding:7px 14px;font-size:0.8rem;">💾 Uložiť (zašifrovať)</button>
          <button type="button" class="btn-secondary adm-integ-test" style="padding:7px 14px;font-size:0.8rem;">🔍 Otestovať pripojenie</button>
          ${integ.source === "db" ? `<button type="button" class="btn-secondary adm-integ-del" style="padding:7px 12px;font-size:0.8rem;color:#ef4444;">🔌 Odpojiť</button>` : ""}
        `
        : `
          <button type="button" class="btn-secondary adm-integ-test" style="padding:6px 12px;font-size:0.78rem;">🔍 Otestovať pripojenie</button>
          <span class="adm-integ-locked-tag">🔒 Polia sú zamknuté proti nechcenej zmene</span>
        `;

      card.innerHTML = `
        <div class="adm-integ-head">
          <div>
            <strong style="font-size:0.95rem;">${integ.label}</strong>
            <div class="adm-integ-meta">
              ${integ.accountName ? `<span>👤 ${integ.accountName}</span>` : ""}
              ${sourceLabel ? `<span>🔒 ${sourceLabel}</span>` : ""}
              ${expStr ? `<span>⏳ Platnosť do: ${expStr}</span>` : ""}
            </div>
          </div>
          <span class="adm-integ-badge ${integ.status || "disconnected"}">${badgeLabels[integ.status] || integ.status}</span>
        </div>
        ${integ.lastError ? `<div class="settings-error" style="font-size:0.78rem;padding:6px 10px;margin:0;">${integ.lastError}</div>` : ""}
        ${fieldsHtml}
        <div class="adm-integ-actions">${actionsHtml}</div>
      `;

      const saveBtn = card.querySelector(".adm-integ-save");
      if (saveBtn) {
        saveBtn.addEventListener("click", async () => {
          const credentials = {};
          card.querySelectorAll(".adm-integ-input").forEach((inp) => {
            const val = inp.value.trim();
            if (val) credentials[inp.dataset.field] = val;
          });
          if (Object.keys(credentials).length === 0) {
            showAutoMsg("Zadaj aspoň jeden údaj na uloženie.", true);
            return;
          }
          try {
            const resp = await fetch(`/api/automation/integrations/${encodeURIComponent(integ.provider)}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ credentials }),
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok) throw new Error(data.error || ("HTTP " + resp.status));
            await loadAutomationIntegrations();
            showAutoMsg(`✓ ${integ.label}: údaje zašifrované a uložené.`);
          } catch (err) {
            showAutoMsg("Chyba uloženia integrácie: " + err.message, true);
          }
        });
      }

      card.querySelector(".adm-integ-test").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const orig = btn.textContent;
        btn.disabled = true;
        btn.textContent = "⏳ Testujem…";
        try {
          const resp = await fetch(`/api/automation/integrations/${encodeURIComponent(integ.provider)}/test`, {
            method: "POST",
          });
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok) throw new Error(data.error || ("HTTP " + resp.status));
          await loadAutomationIntegrations();
          if (data.ok) {
            showAutoMsg(`✓ ${integ.label}: pripojenie funkčné${data.accountName ? ` (${data.accountName})` : ""}.`);
          } else {
            showAutoMsg(`⚠️ ${integ.label}: ${data.error || "Test pripojenia zlyhal."}`, true);
          }
        } catch (err) {
          showAutoMsg("Chyba testu: " + err.message, true);
        } finally {
          btn.disabled = false;
          btn.textContent = orig;
        }
      });

      const delBtn = card.querySelector(".adm-integ-del");
      if (delBtn) {
        delBtn.addEventListener("click", async () => {
          if (!confirm(`POZOR: Naozaj chceš natrvalo odpojiť a vymazať uložené API kľúče pre ${integ.label}?\nAutomatické publikovanie na túto sieť prestane fungovať, kým ich znova nenastavíš.`)) return;
          try {
            const resp = await fetch(`/api/automation/integrations/${encodeURIComponent(integ.provider)}`, {
              method: "DELETE",
            });
            if (!resp.ok) throw new Error("HTTP " + resp.status);
            await loadAutomationIntegrations();
            showAutoMsg(`✓ ${integ.label}: integrácia odpojená.`);
          } catch (err) {
            showAutoMsg("Chyba odpojenia: " + err.message, true);
          }
        });
      }

      dom.integrationsList.appendChild(card);
    });
  }

  function renderAutomationModal() {
    if (dom.autoSummary) {
      const enabledCount = automationChannels.filter((c) => c.enabled).length;
      const pendingCount = automationSummary.pendingArtworksCount || 0;
      dom.autoSummary.textContent = `Aktívnych sietí: ${enabledCount} / ${automationChannels.length} · Čakajúcich diel: ${pendingCount}`;
    }
    if (dom.autoWarningBanner) {
      const broken = automationIntegrations.filter((i) => i.status === "error");
      if (broken.length > 0) {
        dom.autoWarningBanner.style.display = "block";
        dom.autoWarningBanner.textContent = `⚠️ Problém s pripojením: ${broken.map((b) => `${b.label} (${b.lastError || "chyba"})`).join(" · ")}`;
      } else {
        dom.autoWarningBanner.style.display = "none";
      }
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

  function openAutomationModal(defaultTab = "channels") {
    if (!dom.automationModal) return;
    if (dom.autoStatusMsg) dom.autoStatusMsg.style.display = "none";
    setIntegrationsUnlocked(false);
    setAutoTab(defaultTab);
    renderAutomationModal();
    dom.automationModal.classList.add("open");
    document.body.style.overflow = "hidden";
    setAdminBrand("Automatizácia", "Admin CMS · Sociálne siete & predajné portály");
    loadAutomationChannels();
    loadAutomationIntegrations();
  }

  function closeAutomationModal() {
    if (!dom.automationModal) return;
    setIntegrationsUnlocked(false);
    dom.automationModal.classList.remove("open");
    document.body.style.overflow = "";
    setAdminBrand();
  }

  function renderArtworkPublishPanel(art) {
    if (!dom.publishPanel || !dom.publishStatusList) return;
    if (!art || !art.id) {
      dom.publishPanel.style.display = "none";
      return;
    }
    dom.publishPanel.style.display = "flex";
    if (dom.publishResultBox) dom.publishResultBox.style.display = "none";

    const chosenSocial = currentSocialImageUrl || art.socialImageUrl || "";
    const fallbackCover = albumPhotos[0] || art.coverImage || "";
    const previewSocial = chosenSocial || fallbackCover;
    const totalCount = albumPhotos.length;
    const uploadLimit = Math.min(10, totalCount);

    if (dom.socialThumbWrap && dom.socialThumbImg) {
      if (previewSocial) {
        dom.socialThumbImg.src = previewSocial.startsWith("data:")
          ? (pendingThumbMap[previewSocial] || previewSocial)
          : toThumbUrl(previewSocial);
        dom.socialThumbWrap.style.display = "flex";
        if (dom.socialThumbTitle) {
          dom.socialThumbTitle.textContent = chosenSocial
            ? `1. fotka na siete je 📱 (+ ďalšie z albumu, spolu ${uploadLimit}/${totalCount})`
            : `Nahrá sa prvých ${uploadLimit} z ${totalCount} fotiek podľa poradia albumu`;
        }
        if (dom.socialThumbDesc) {
          dom.socialThumbDesc.textContent = "Pre portály (Aukro / Sashe / Etsy) ide prvých 10 fotiek v poradí od Titulnej (#1).";
        }
      } else {
        dom.socialThumbWrap.style.display = "none";
      }
    }

    dom.publishStatusList.innerHTML = "";
    const statusMap = art.publishStatus || {};
    const channelsToShow = automationChannels.length > 0
      ? automationChannels.filter((ch) => ch.implemented || ch.enabled || (statusMap[ch.key] && statusMap[ch.key].status))
      : [
          { key: "instagram", label: "Instagram", enabled: false, implemented: true },
          { key: "facebook", label: "Facebook", enabled: false, implemented: true },
          { key: "aukro", label: "Aukro", enabled: false, implemented: true },
          { key: "sashe", label: "Sashe.sk", enabled: false, implemented: true },
        ];

    channelsToShow.forEach((ch) => {
      const entry = statusMap[ch.key] || {};
      const st = entry.status || "pending";
      const chip = document.createElement("div");
      chip.className = "adm-pub-chip";
      const isChecked = editingPublishChannels[ch.key] !== undefined
        ? editingPublishChannels[ch.key] !== false
        : Boolean(ch.enabled);
      const stateLabels = {
        published: "Publikované",
        drafted: "Koncept",
        error: "Chyba",
        pending: ch.enabled ? "Čaká" : "Vypnuté",
      };

      chip.innerHTML = `
        <label class="adm-pub-chip-left" title="Vybrať pre publikovanie na ${ch.label}">
          <input type="checkbox" class="adm-art-ch-chk" data-channel="${ch.key}" ${isChecked ? "checked" : ""}>
          <span class="adm-pub-chip-name">${ch.label}</span>
        </label>
        <div style="display:inline-flex;align-items:center;gap:4px;">
          <span class="adm-pub-state ${st}" title="${entry.error || entry.url || entry.note || ""}">${stateLabels[st] || st}</span>
          ${(st === "error" || st === "published" || st === "drafted")
            ? `<button type="button" class="adm-icon-btn adm-pub-reset" style="width:22px;height:22px;font-size:0.7rem;" title="Resetovať stav na čakajúce">↺</button>`
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
  }

  function readPricesFromForm() {
    const parseOptNum = (el) => {
      if (!el) return null;
      const s = el.value.trim();
      if (s === "") return null;
      const n = Number(s);
      return Number.isFinite(n) && n >= 0 ? n : null;
    };
    const portalPrices = {};
    const aukro = parseOptNum(dom.priceAukro);
    const sashe = parseOptNum(dom.priceSashe);
    const etsy = parseOptNum(dom.priceEtsy);
    if (aukro !== null) portalPrices.aukro = aukro;
    if (sashe !== null) portalPrices.sashe = sashe;
    if (etsy !== null) portalPrices.etsy = etsy;
    return { priceEur: parseOptNum(dom.priceEur), portalPrices };
  }

  async function publishNowForArtwork() {
    if (!editingId || !dom.publishStatusList || !dom.publishNowBtn) return;
    const selectedChannels = Array.from(dom.publishStatusList.querySelectorAll(".adm-art-ch-chk"))
      .filter((chk) => chk.checked)
      .map((chk) => chk.dataset.channel)
      .filter(Boolean);

    if (selectedChannels.length === 0) {
      showStatusMsg("Zaškrtni aspoň jednu sieť alebo portál v paneli publikovania.", true);
      return;
    }

    const origText = dom.publishNowBtn.textContent;
    dom.publishNowBtn.disabled = true;
    dom.publishNowBtn.textContent = "⏳ Ukladám & publikujem…";
    if (dom.publishResultBox) {
      dom.publishResultBox.style.display = "none";
      dom.publishResultBox.innerHTML = "";
    }

    try {
      // Ensure latest metadata, prices, album photos & 📱 social photo are saved before publishing
      await persistCurrentEditingArtwork();

      const resp = await fetch(`/api/automation/publish/${encodeURIComponent(editingId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channels: selectedChannels }),
      });
      if (resp.status === 401) {
        showAuthGate("Prihlásenie vypršalo. Prihlás sa znova.");
        return;
      }
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || ("HTTP " + resp.status));

      const art = artworks.find((a) => a.id === editingId);
      if (art) {
        art.publishStatus = data.publishStatus || {};
        if (data.instagramUrl && !art.instagramUrl) {
          art.instagramUrl = data.instagramUrl;
          if (dom.instagramUrl) dom.instagramUrl.value = data.instagramUrl;
        }
        renderArtworkPublishPanel(art);
      }
      loadAutomationChannels();

      if (dom.publishResultBox && data.results) {
        dom.publishResultBox.style.display = "flex";
        Object.entries(data.results).forEach(([chKey, res]) => {
          const chObj = automationChannels.find((c) => c.key === chKey);
          const label = chObj ? chObj.label : chKey;
          const row = document.createElement("div");
          row.className = "adm-pub-res-row";
          const icon = res.status === "published" ? "✅" : (res.status === "drafted" ? "📝" : (res.status === "error" ? "❌" : "ℹ️"));
          const countTag = res.photoCount > 0 ? ` (${res.photoCount} fotiek)` : "";
          const detail = (res.error || res.note || res.url || res.status) + (res.note && res.note.includes("fotiek") ? "" : countTag);
          row.innerHTML = `<strong>${icon} ${label}</strong><span style="color:${res.status === "error" ? "#dc2626" : "var(--text-muted)"};">${detail}</span>`;
          dom.publishResultBox.appendChild(row);
        });
      }
    } catch (err) {
      showStatusMsg("Chyba publikovania: " + err.message, true);
    } finally {
      dom.publishNowBtn.disabled = false;
      dom.publishNowBtn.textContent = origText;
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

  async function persistAlbumPhotoOrder(fromIdx, toIdx, customMsg) {
    refreshCoverAndAlbumUI(customMsg || `✓ Poradie fotiek upravené (#${fromIdx + 1} → #${toIdx + 1})`);
    if (editingId) {
      const curArt = artworks.find((a) => a.id === editingId);
      if (curArt) renderArtworkPublishPanel(curArt);
    }

    const hasUnsavedDataUrls = albumPhotos.some((u) => typeof u === "string" && u.startsWith("data:"));
    if (!editingId || hasUnsavedDataUrls || albumPhotos.length === 0) {
      refreshCoverAndAlbumUI(`${customMsg || `✓ Poradie fotiek upravené (#${fromIdx + 1} → #${toIdx + 1})`} (potvrď tlačidlom Uložiť)`);
      return;
    }

    try {
      const resp = await fetch(`/api/artworks/${encodeURIComponent(editingId)}/images/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedUrls: [...albumPhotos] }),
      });
      if (resp.status === 401) {
        showAuthGate("Prihlásenie vypršalo. Prihlás sa znova.");
        return;
      }
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !Array.isArray(data.detailImages)) {
        throw new Error(data.error || ("HTTP " + resp.status));
      }
      albumPhotos = [...data.detailImages];
      const curArt = artworks.find((a) => a.id === editingId);
      if (curArt) {
        curArt.coverImage = data.coverImage || albumPhotos[0] || "";
        curArt.detailImages = [...albumPhotos];
        curArt.photoCount = albumPhotos.length;
        renderArtworkPublishPanel(curArt);
      }
      refreshCoverAndAlbumUI(`✓ Poradie fotiek uložené (#${fromIdx + 1} → #${toIdx + 1})`);
      renderInventory();
    } catch (err) {
      showStatusMsg("Nepodarilo sa uložiť poradie fotiek: " + err.message, true);
    }
  }

  function startPhotoDrag(e, sourceCard, fromIdx, opts = {}) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (albumPhotos.length < 2 || photoDragState) return;
    const immediate = Boolean(opts.immediate);
    if (immediate) e.preventDefault();

    const startX = e.clientX;
    const startY = e.clientY;
    let activated = false;
    let ghostEl = null;
    let ghostPosEl = null;
    let insertSlot = fromIdx;
    let toIdx = fromIdx;

    const clearPhotoIndicators = () => {
      if (!dom.photoGrid) return;
      dom.photoGrid.querySelectorAll(".adm-photo-item").forEach((el) => {
        el.classList.remove("adm-photo-drop-before", "adm-photo-drop-after");
      });
    };

    const activateDrag = () => {
      if (activated) return;
      activated = true;
      suppressNextPhotoClick = true;

      const srcUrl = albumPhotos[fromIdx] || "";
      ghostEl = document.createElement("div");
      ghostEl.className = "adm-photo-drag-ghost";
      const gImg = document.createElement("img");
      gImg.src = srcUrl.startsWith("data:") ? (pendingThumbMap[srcUrl] || srcUrl) : toThumbUrl(srcUrl);
      gImg.alt = "";
      ghostPosEl = document.createElement("span");
      ghostPosEl.textContent = `→ #${fromIdx + 1}`;
      ghostEl.appendChild(gImg);
      ghostEl.appendChild(ghostPosEl);
      document.body.appendChild(ghostEl);

      sourceCard.classList.add("adm-photo-dragging");
      document.body.classList.add("adm-is-dragging");
      photoDragState = { active: true };
    };

    const updateTarget = (cx, cy) => {
      if (!dom.photoGrid || !activated) return;
      const cards = Array.from(dom.photoGrid.querySelectorAll(".adm-photo-item"));
      clearPhotoIndicators();
      if (cards.length === 0) return;

      let bestCard = null;
      let bestDist = Infinity;
      let insideCard = null;

      cards.forEach((c) => {
        const r = c.getBoundingClientRect();
        if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) {
          insideCard = c;
        }
        const mx = (r.left + r.right) / 2;
        const my = (r.top + r.bottom) / 2;
        const d = Math.hypot(cx - mx, cy - my);
        if (d < bestDist) {
          bestDist = d;
          bestCard = c;
        }
      });

      const targetCard = insideCard || bestCard;
      if (targetCard) {
        const targetIdx = cards.indexOf(targetCard);
        const r = targetCard.getBoundingClientRect();
        const isAfter = cx > (r.left + r.right) / 2;
        insertSlot = isAfter ? targetIdx + 1 : targetIdx;
        targetCard.classList.add(isAfter ? "adm-photo-drop-after" : "adm-photo-drop-before");
      }

      toIdx = Math.max(0, Math.min(albumPhotos.length - 1, insertSlot > fromIdx ? insertSlot - 1 : insertSlot));
      if (ghostPosEl) ghostPosEl.textContent = `→ #${toIdx + 1}`;
      if (ghostEl) {
        const left = Math.min(Math.max(12, cx + 14), Math.max(12, window.innerWidth - 130));
        const top = Math.min(Math.max(12, cy - 28), Math.max(12, window.innerHeight - 66));
        ghostEl.style.left = `${left}px`;
        ghostEl.style.top = `${top}px`;
      }
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      window.removeEventListener("keydown", onKeyDown);
      clearPhotoIndicators();
      sourceCard.classList.remove("adm-photo-dragging");
      document.body.classList.remove("adm-is-dragging");
      if (ghostEl && ghostEl.parentNode) ghostEl.remove();
      photoDragState = null;
      if (activated) {
        setTimeout(() => { suppressNextPhotoClick = false; }, 120);
      }
    };

    const onMove = (ev) => {
      const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);
      if (!activated) {
        if (dist < (immediate ? 2 : 6)) return;
        activateDrag();
      }
      updateTarget(ev.clientX, ev.clientY);
    };

    const onKeyDown = (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        cleanup();
      }
    };

    const onEnd = (ev) => {
      const didActivate = activated;
      const destIdx = toIdx;
      cleanup();
      if (ev.type === "pointerup" && didActivate && destIdx !== fromIdx) {
        const [moved] = albumPhotos.splice(fromIdx, 1);
        albumPhotos.splice(destIdx, 0, moved);
        persistAlbumPhotoOrder(fromIdx, destIdx);
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    window.addEventListener("keydown", onKeyDown);

    if (immediate) {
      activateDrag();
      updateTarget(startX, startY);
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
    if (dom.photoCount) {
      dom.photoCount.textContent = albumPhotos.length > 10
        ? `(${albumPhotos.length} — prvých 10 sa nahráva)`
        : `(${albumPhotos.length})`;
    }
    dom.photoGrid.innerHTML = "";

    albumPhotos.forEach((url, idx) => {
      const card = document.createElement("div");
      const isSocial = Boolean(currentSocialImageUrl && url === currentSocialImageUrl);
      const isOverLimit = idx >= 10;
      card.className = `adm-photo-item${idx === 0 ? " is-cover" : ""}${isSocial ? " is-social" : ""}${isOverLimit ? " is-over-limit" : ""}`;
      card.dataset.photoIdx = String(idx);
      const thumbSrc = url.startsWith("data:") ? (pendingThumbMap[url] || url) : toThumbUrl(url);
      card.innerHTML = `
        <img src="${thumbSrc}" alt="Foto ${idx + 1}" loading="lazy" decoding="async" title="${idx === 0 ? "Titulná fotka (potiahnutím zmeníš poradie)" : "Kliknutím nastavíš ako Titulnú (#1) alebo potiahni pre poradie"}">
        <div class="adm-photo-tools">
          <button type="button" class="adm-photo-tool${isSocial ? " is-active" : ""}" data-action="social" title="${isSocial ? "Zrušiť výber 1. fotky pre sociálne siete" : "Nastaviť ako 1. fotku pre sociálne siete (IG / FB / Threads / TikTok / Pinterest / X)"}">📱</button>
          <button type="button" class="adm-photo-tool" data-action="crop" title="4-bodový orez (vytvorí kópiu)">📐</button>
          <button type="button" class="adm-photo-tool" data-action="cover3d" title="3D Cover Studio (vytvorí kópiu)">✨</button>
          <button type="button" class="adm-photo-tool danger" data-action="remove" title="Odstrániť z albumu">✕</button>
        </div>
        <div class="adm-photo-footer">
          <button type="button" class="adm-photo-drag-handle" title="Potiahni pre zmenu poradia fotky v albume" aria-label="Presunúť fotku #${idx + 1}">⋮⋮ #${idx + 1}</button>
          <div class="adm-photo-pills">
            ${idx === 0 ? '<span class="adm-photo-pill cover">Titulná</span>' : ""}
            ${isSocial ? '<span class="adm-photo-pill social">📱</span>' : ""}
            ${isOverLimit ? '<span class="adm-photo-pill limit" title="Mimo limitu prvých 10 fotiek pre upload">mimo 10</span>' : ""}
          </div>
        </div>
      `;

      const imgEl = card.querySelector("img");
      imgEl.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "mouse") {
          startPhotoDrag(e, card, idx, { immediate: false });
        }
      });
      imgEl.addEventListener("click", () => {
        if (suppressNextPhotoClick) {
          suppressNextPhotoClick = false;
          return;
        }
        if (idx === 0) return;
        const picked = albumPhotos.splice(idx, 1)[0];
        albumPhotos.unshift(picked);
        persistAlbumPhotoOrder(idx, 0, "✓ Zvolená nová titulná fotka (#1)");
      });

      const handleEl = card.querySelector(".adm-photo-drag-handle");
      if (handleEl) {
        handleEl.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
          startPhotoDrag(e, card, idx, { immediate: true });
        });
      }

      card.querySelector('[data-action="social"]').addEventListener("click", (e) => {
        e.stopPropagation();
        currentSocialImageUrl = (currentSocialImageUrl === url) ? "" : url;
        setFormDirty(true);
        refreshCoverAndAlbumUI(
          currentSocialImageUrl
            ? "📱 Vybraná 1. fotka pre sociálne siete (klikni na Uložiť)"
            : "Zrušený výber — pre sociálne siete sa použije poradie od #1 (klikni na Uložiť)"
        );
        if (editingId) {
          const curArt = artworks.find((a) => a.id === editingId);
          if (curArt) renderArtworkPublishPanel(curArt);
        }
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
        setFormDirty(true);
        refreshCoverAndAlbumUI("Fotka odstránená z albumu (potvrď tlačidlom Uložiť)");
        renderWebReadiness();
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
    currentSocialImageUrl = "";
    setFormDirty(false);

    if (dom.formHeading) dom.formHeading.textContent = "➕ Pridať novú maľbu";
    if (dom.form) dom.form.reset();
    if (dom.width) dom.width.value = "50";
    if (dom.height) dom.height.value = "70";
    if (dom.depth) dom.depth.value = "4";
    if (dom.priceEur) dom.priceEur.value = "";
    if (dom.priceAukro) dom.priceAukro.value = "";
    if (dom.priceSashe) dom.priceSashe.value = "";
    if (dom.priceEtsy) dom.priceEtsy.value = "";
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
    const defaultIg = (currentSiteSettings && currentSiteSettings.instagramUrl) || "https://www.instagram.com/platenko.akryl";
    if (dom.instaTestLink) dom.instaTestLink.href = defaultIg;
    if (dom.statusMsg) dom.statusMsg.style.display = "none";
    if (dom.publishPanel) dom.publishPanel.style.display = "none";
    if (dom.publishResultBox) dom.publishResultBox.style.display = "none";

    refreshCoverAndAlbumUI();
    updateSofaPreview();
    renderWebReadiness();
    renderInventory();
    setEditorTab("photo");
  }

  function loadArtworkIntoForm(art, opts) {
    if (!art) return;
    const options = opts || {};
    editingId = art.id;
    editingPublishChannels = { ...(art.publishChannels || {}) };
    pendingThumbMap = {};
    pendingRawDataUrl = null;
    currentRawUrl = art.rawImage || "";
    currentSocialImageUrl = art.socialImageUrl || "";
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
    const pp = art.portalPrices || {};
    if (dom.priceAukro) dom.priceAukro.value = (pp.aukro !== undefined && pp.aukro !== null && pp.aukro !== "") ? pp.aukro : "";
    if (dom.priceSashe) dom.priceSashe.value = (pp.sashe !== undefined && pp.sashe !== null && pp.sashe !== "") ? pp.sashe : "";
    if (dom.priceEtsy) dom.priceEtsy.value = (pp.etsy !== undefined && pp.etsy !== null && pp.etsy !== "") ? pp.etsy : "";
    dom.instagramUrl.value = art.instagramUrl || "";
    dom.description.value = art.description || "";
    const defaultIg = (currentSiteSettings && currentSiteSettings.instagramUrl) || "https://www.instagram.com/platenko.akryl";
    if (dom.instaTestLink) {
      dom.instaTestLink.href = (art.instagramUrl && art.instagramUrl.trim()) || defaultIg;
    }

    setFormDirty(false);
    refreshCoverAndAlbumUI();
    updateSofaPreview();
    renderArtworkPublishPanel(art);
    renderWebReadiness();
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

        setFormDirty(true);
        refreshCoverAndAlbumUI("✨ Vytvorená orezaná kópia ako titulná — pôvodná fotka ostala v albume (klikni na Uložiť)");
        renderWebReadiness();
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
        setFormDirty(true);
        refreshCoverAndAlbumUI(
          setAsCover
            ? "✨ Vytvorená 3D Cover kópia ako titulná — pôvodná fotka ostala v albume (klikni na Uložiť)"
            : "✨ Vytvorená 3D Cover kópia na koniec albumu (klikni na Uložiť)"
        );
        renderWebReadiness();
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

  function hasAnyPrice(art) {
    if (art.priceEur !== null && art.priceEur !== undefined && Number(art.priceEur) > 0) return true;
    const pp = art.portalPrices || {};
    return Object.values(pp).some((v) => Number(v) > 0);
  }

  function hasAnyPublished(art) {
    const ps = art.publishStatus || {};
    return Object.values(ps).some((entry) => entry && (entry.status === "published" || entry.status === "drafted"));
  }

  // ---- Inventory Table ----
  function renderInventory() {
    if (!dom.inventoryBody) return;
    const q = (dom.searchInput ? dom.searchInput.value : "").trim().toLowerCase();

    if (dom.catalogFilterBtns && dom.catalogFilterBtns.length > 0) {
      const counts = {
        all: artworks.length,
        "no-price": artworks.filter((a) => !hasAnyPrice(a)).length,
        unpublished: artworks.filter((a) => !hasAnyPublished(a)).length,
        "no-desc": artworks.filter((a) => !(a.description || "").trim()).length,
      };
      const labels = {
        all: "Všetky",
        "no-price": "Bez ceny",
        unpublished: "Nepublikované",
        "no-desc": "Bez popisu",
      };
      dom.catalogFilterBtns.forEach((btn) => {
        const k = btn.dataset.catFilter;
        btn.classList.toggle("active", k === activeCatalogFilter);
        if (labels[k] !== undefined && counts[k] !== undefined) {
          btn.textContent = `${labels[k]} (${counts[k]})`;
        }
      });
    }

    const filtered = artworks.filter((a) => {
      if (activeCatalogFilter === "no-price" && hasAnyPrice(a)) return false;
      if (activeCatalogFilter === "unpublished" && hasAnyPublished(a)) return false;
      if (activeCatalogFilter === "no-desc" && (a.description || "").trim()) return false;
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

    const isFiltered = Boolean(q) || activeCatalogFilter !== "all";
    filtered.forEach((art) => {
      const globalIdx = artworks.indexOf(art);
      const tr = document.createElement("tr");
      tr.classList.add("adm-clickable-row");
      tr.title = "Klikni na riadok pre úpravu diela";
      tr.dataset.artId = art.id;
      tr.dataset.globalIdx = String(globalIdx);
      if (editingId && art.id === editingId) {
        tr.classList.add("is-active");
      }
      const thumbSrc = toThumbUrl(art.coverImage);
      const dimsLabel = `${art.widthCm || 50} × ${art.heightCm || 70} × ${art.depthCm || 4} cm`;
      const priced = hasAnyPrice(art);
      const published = hasAnyPublished(art);

      tr.innerHTML = `
        <td class="adm-order-cell">
          <div class="adm-order-wrap">
            <button type="button" class="adm-drag-handle" title="${isFiltered ? "Prepni na Všetky bez hľadania pre presun ťahaním" : "Chyť a potiahni pre zmenu poradia"}" aria-label="Presunúť dielo ťahaním" ${isFiltered ? "disabled" : ""}>⋮⋮</button>
            <button type="button" class="adm-pos-btn" title="Klikni a zadaj cieľovú pozíciu (1–${artworks.length})" aria-label="Zmeniť pozíciu #${globalIdx + 1}">${globalIdx + 1}</button>
          </div>
        </td>
        <td>
          <img src="${thumbSrc}" alt="${art.title}" class="adm-row-thumb" loading="lazy" decoding="async">
        </td>
        <td>
          <strong style="display:block;font-size:0.92rem;">
            ${art.title}
            <span class="adm-micro-badges">
              ${priced ? `<span class="adm-micro-badge ok" title="Zadaná cena">€</span>` : ""}
              ${published ? `<span class="adm-micro-badge social" title="Publikované na sieti / portáli">🚀</span>` : ""}
            </span>
          </strong>
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
      if (dragHandle && !isFiltered) {
        dragHandle.addEventListener("pointerdown", (e) => startRowDrag(e, tr, art, globalIdx));
      }
      const posBtn = tr.querySelector(".adm-pos-btn");
      if (posBtn) {
        posBtn.addEventListener("click", () => openInlinePositionEditor(tr, art, globalIdx));
      }

      tr.addEventListener("click", (e) => {
        if (dragState) return;
        if (e.target.closest("button, a, input, select, textarea, label, .adm-drag-handle, .adm-pos-btn, .adm-pos-input")) return;
        const sel = window.getSelection ? window.getSelection().toString().trim() : "";
        if (sel) return;
        if (editingId === art.id) return;
        if (!confirmDiscardIfDirty()) return;
        loadArtworkIntoForm(art);
      });

      tr.querySelector(".adm-edit-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        if (!confirmDiscardIfDirty()) return;
        loadArtworkIntoForm(art);
      });
      tr.querySelector(".adm-del-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        deleteArtwork(art);
      });

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

  function toAsciiSlug(text) {
    return String(text ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function buildEditPayloadFromForm() {
    const title = dom.title.value.trim();
    const w = Math.max(10, parseFloat(dom.width.value) || 50);
    const h = Math.max(10, parseFloat(dom.height.value) || 70);
    const d = Math.max(1, parseFloat(dom.depth.value) || 4);
    const dateVal = dom.date.value || new Date().toISOString().slice(0, 10);
    const yearVal = dateVal.slice(0, 4);
    const dimensions = `${w} × ${h} cm`;

    const filteredThumbs = {};
    albumPhotos.forEach((p) => {
      if (pendingThumbMap[p]) filteredThumbs[p] = pendingThumbMap[p];
    });
    if (pendingRawDataUrl && pendingThumbMap[pendingRawDataUrl]) {
      filteredThumbs[pendingRawDataUrl] = pendingThumbMap[pendingRawDataUrl];
    }

    const { priceEur, portalPrices } = readPricesFromForm();
    let coverAspectRatio = null;
    if (dom.coverPreview && dom.coverPreview.naturalWidth > 0 && dom.coverPreview.naturalHeight > 0) {
      coverAspectRatio = Number((dom.coverPreview.naturalWidth / dom.coverPreview.naturalHeight).toFixed(4));
    } else if (w > 0 && h > 0) {
      coverAspectRatio = Number((w / h).toFixed(4));
    }
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
      portalPrices,
      socialImageUrl: currentSocialImageUrl,
      coverAspectRatio,
      publishChannels: { ...editingPublishChannels },
      instagramUrl: dom.instagramUrl.value.trim(),
      description: dom.description.value.trim(),
      detailImages: [...albumPhotos],
      thumbMap: filteredThumbs,
    };
    if (currentRawUrl) payload.rawImage = currentRawUrl;
    if (pendingRawDataUrl) payload.rawImageDataUrl = pendingRawDataUrl;
    return payload;
  }

  async function persistCurrentEditingArtwork() {
    if (!editingId) return;
    const payload = buildEditPayloadFromForm();
    if (!payload.title) {
      setEditorTab("details");
      if (dom.title) dom.title.focus();
      throw new Error("Zadaj názov maľby.");
    }
    const resp = await fetch(`/api/artworks/${encodeURIComponent(editingId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (resp.status === 401) {
      showAuthGate("Prihlásenie vypršalo. Prihlás sa znova.");
      throw new Error("Prihlásenie vypršalo.");
    }
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const data = await resp.json().catch(() => ({}));
    if (data.socialImageUrl !== undefined) currentSocialImageUrl = data.socialImageUrl;
    if (Array.isArray(data.detailImages)) albumPhotos = [...data.detailImages];
    if (data.rawImage) currentRawUrl = data.rawImage;
    pendingRawDataUrl = null;
    setFormDirty(false);
    await loadArtworks();
    const keptArt = artworks.find((a) => a.id === editingId);
    if (keptArt) loadArtworkIntoForm(keptArt, { scrollTop: false });
  }

  async function saveArtworkForm(e) {
    e.preventDefault();
    const title = dom.title.value.trim();
    if (!title) {
      setEditorTab("details");
      if (dom.title) dom.title.focus();
      showStatusMsg("Zadaj názov maľby.", true);
      return;
    }

    const origBtnText = dom.saveBtn.textContent;
    dom.saveBtn.disabled = true;
    dom.saveBtn.textContent = "⏳ Ukladám do cloudu…";

    try {
      let savedId = editingId;
      let successMsg = "✓ Zmeny uložené do D1 a R2!";

      if (editingId) {
        await persistCurrentEditingArtwork();
        showStatusMsg(successMsg);
        return;
      } else {
        if (albumPhotos.length === 0) {
          setEditorTab("photo");
          showStatusMsg("Pre novú maľbu najprv odfotografuj alebo nahraj obrázok.", true);
          return;
        }
        const editPayload = buildEditPayloadFromForm();
        const dateSlug = toAsciiSlug(editPayload.date) || new Date().toISOString().slice(0, 10);
        const titleSlug = toAsciiSlug(title) || "malba";
        const suffix = Date.now().toString(36).slice(-4);
        const folder = toAsciiSlug(`${dateSlug}-${titleSlug}-${suffix}`) || `malba-${suffix}`;
        const newId = `art-${folder}`;
        savedId = newId;
        successMsg = "✓ Nová maľba (výrez aj originál) uložená do galérie!";
        const payload = {
          ...editPayload,
          id: newId,
          folder,
          publishChannels: {},
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
        const createdData = await resp.json().catch(() => ({}));
        if (createdData && createdData.id) savedId = createdData.id;
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
          currentUsername = data.username || (dom.loginUser ? dom.loginUser.value.trim() : "mario");
          hideAuthGate();
          resetForm();
          loadLookups().then(() => loadArtworks());
          loadAutomationChannels();
          loadAutomationIntegrations();
          loadInquiries();
          loadSiteSettings();
          handleDeepLinkOpenParam();
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
        closeAccountModal();
        showAuthGate();
      });
    }

    if (dom.accountBtn) dom.accountBtn.addEventListener("click", openAccountModal);
    if (dom.accountCloseBtn) dom.accountCloseBtn.addEventListener("click", closeAccountModal);
    if (dom.accountModal) {
      dom.accountModal.addEventListener("click", (e) => {
        if (e.target === dom.accountModal) closeAccountModal();
      });
    }
    if (dom.accountLogoutBtn) {
      dom.accountLogoutBtn.addEventListener("click", async () => {
        try { await fetch("/api/auth/logout", { method: "POST" }); } catch {}
        closeAccountModal();
        showAuthGate();
      });
    }
    if (dom.changePassForm) {
      dom.changePassForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const curPass = dom.curPass ? dom.curPass.value : "";
        const newPass = dom.newPass ? dom.newPass.value : "";
        const confPass = dom.confirmPass ? dom.confirmPass.value : "";

        const showMsg = (text, isErr) => {
          if (!dom.changePassMsg) return;
          dom.changePassMsg.textContent = text;
          dom.changePassMsg.className = isErr ? "settings-error" : "settings-success";
          dom.changePassMsg.style.display = "block";
        };

        if (newPass.length < 6) {
          showMsg("Nové heslo musí mať aspoň 6 znakov.", true);
          return;
        }
        if (newPass !== confPass) {
          showMsg("Nové heslá sa nezhodujú.", true);
          return;
        }

        try {
          const resp = await fetch("/api/auth/change-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ currentPassword: curPass, newPassword: newPass }),
          });
          const data = await resp.json().catch(() => ({}));
          if (resp.status === 401 && data.error === "Unauthorized") {
            closeAccountModal();
            showAuthGate("Prihlásenie vypršalo.");
            return;
          }
          if (!resp.ok || !data.success) {
            throw new Error(data.error || "Nepodarilo sa zmeniť heslo.");
          }
          dom.changePassForm.reset();
          showMsg("✓ Heslo bolo úspešne zmenené.", false);
        } catch (err) {
          showMsg(err.message || "Chyba pri zmene hesla.", true);
        }
      });
    }

    if (dom.resetFormBtn) {
      dom.resetFormBtn.addEventListener("click", () => {
        if (!confirmDiscardIfDirty()) return;
        resetForm();
      });
    }
    if (dom.form) {
      dom.form.addEventListener("submit", saveArtworkForm);
      dom.form.addEventListener("input", () => {
        setFormDirty(true);
        if (activeEditorTab === "publish") renderWebReadiness();
      });
      dom.form.addEventListener("change", () => {
        setFormDirty(true);
        if (activeEditorTab === "publish") renderWebReadiness();
      });
    }
    (dom.editorTabs || []).forEach((btn) => {
      btn.addEventListener("click", () => setEditorTab(btn.dataset.edTab));
    });
    (dom.catalogFilterBtns || []).forEach((btn) => {
      btn.addEventListener("click", () => {
        activeCatalogFilter = btn.dataset.catFilter || "all";
        renderInventory();
      });
    });
    if (dom.searchInput) dom.searchInput.addEventListener("input", renderInventory);
    window.addEventListener("beforeunload", (e) => {
      if (!isFormDirty) return;
      e.preventDefault();
      e.returnValue = "";
    });

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

    if (dom.automationBtn) dom.automationBtn.addEventListener("click", () => openAutomationModal("channels"));
    if (dom.openAutoFromPanelBtn) dom.openAutoFromPanelBtn.addEventListener("click", () => openAutomationModal("channels"));
    if (dom.automationCloseBtn) dom.automationCloseBtn.addEventListener("click", closeAutomationModal);
    if (dom.automationModal) {
      dom.automationModal.addEventListener("click", (e) => {
        if (e.target === dom.automationModal) closeAutomationModal();
      });
    }
    (dom.autoTabBtns || []).forEach((btn) => {
      btn.addEventListener("click", () => setAutoTab(btn.dataset.autoTab));
    });
    if (dom.publishNowBtn) {
      dom.publishNowBtn.addEventListener("click", publishNowForArtwork);
    }
    if (dom.integUnlockForm) {
      dom.integUnlockForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (dom.integUnlockErr) dom.integUnlockErr.style.display = "none";
        const password = dom.integUnlockPass ? dom.integUnlockPass.value : "";
        if (!password) return;
        const origText = dom.integUnlockBtn ? dom.integUnlockBtn.textContent : "";
        if (dom.integUnlockBtn) {
          dom.integUnlockBtn.disabled = true;
          dom.integUnlockBtn.textContent = "⏳ Overujem…";
        }
        try {
          const resp = await fetch("/api/auth/verify-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password }),
          });
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok || !data.verified) {
            throw new Error(data.error || "Nesprávne heslo správcu.");
          }
          setIntegrationsUnlocked(true);
          showAutoMsg("🔓 Technické nastavenia integrácií boli odomknuté.");
        } catch (err) {
          if (dom.integUnlockErr) {
            dom.integUnlockErr.textContent = err.message || "Overenie zlyhalo.";
            dom.integUnlockErr.style.display = "block";
          }
        } finally {
          if (dom.integUnlockBtn) {
            dom.integUnlockBtn.disabled = false;
            dom.integUnlockBtn.textContent = origText;
          }
        }
      });
    }
    if (dom.integLockBtn) {
      dom.integLockBtn.addEventListener("click", () => {
        setIntegrationsUnlocked(false);
        showAutoMsg("🔒 Technické nastavenia boli znova zamknuté.");
      });
    }
    if (dom.refreshTokensBtn) {
      dom.refreshTokensBtn.addEventListener("click", async () => {
        const btn = dom.refreshTokensBtn;
        const orig = btn.textContent;
        btn.disabled = true;
        btn.textContent = "⏳ Obnovujem…";
        try {
          const resp = await fetch("/api/automation/integrations/refresh", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ force: false }),
          });
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok) throw new Error(data.error || ("HTTP " + resp.status));
          await loadAutomationIntegrations();
          showAutoMsg("✓ Kontrola a obnova končiacich tokenov dokončená.");
        } catch (err) {
          showAutoMsg("Chyba obnovy tokenov: " + err.message, true);
        } finally {
          btn.disabled = false;
          btn.textContent = orig;
        }
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

    if (dom.inquiriesBtn) dom.inquiriesBtn.addEventListener("click", openInquiriesModal);
    if (dom.inquiriesCloseBtn) dom.inquiriesCloseBtn.addEventListener("click", closeInquiriesModal);
    if (dom.inquiriesModal) {
      dom.inquiriesModal.addEventListener("click", (e) => {
        if (e.target === dom.inquiriesModal) closeInquiriesModal();
      });
    }

    if (dom.siteSettingsBtn) dom.siteSettingsBtn.addEventListener("click", openSiteSettingsModal);
    if (dom.siteSettingsCloseBtn) dom.siteSettingsCloseBtn.addEventListener("click", closeSiteSettingsModal);
    if (dom.siteSettingsModal) {
      dom.siteSettingsModal.addEventListener("click", (e) => {
        if (e.target === dom.siteSettingsModal) closeSiteSettingsModal();
      });
    }
    if (dom.siteSettingsForm) {
      dom.siteSettingsForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = dom.siteSaveBtn;
        const orig = btn ? btn.textContent : "";
        if (btn) {
          btn.disabled = true;
          btn.textContent = "⏳ Ukladám…";
        }
        try {
          const payload = {
            brandTitle: dom.siteBrandTitle ? dom.siteBrandTitle.value.trim() : "",
            brandSubtitle: dom.siteBrandSubtitle ? dom.siteBrandSubtitle.value.trim() : "",
            heroTitle: dom.siteHeroTitle ? dom.siteHeroTitle.value.trim() : "",
            heroSubtitle: dom.siteHeroSubtitle ? dom.siteHeroSubtitle.value.trim() : "",
            aboutHeading: dom.siteAboutHeading ? dom.siteAboutHeading.value.trim() : "",
            contactEmail: dom.siteContactEmail ? dom.siteContactEmail.value.trim() : "",
            aboutText: dom.siteAboutText ? dom.siteAboutText.value.trim() : "",
            aboutCustomOrder: dom.siteCustomOrder ? dom.siteCustomOrder.value.trim() : "",
            aboutShipping: dom.siteShipping ? dom.siteShipping.value.trim() : "",
            instagramHandle: dom.siteIgHandle ? dom.siteIgHandle.value.trim() : "",
            instagramUrl: dom.siteIgUrl ? dom.siteIgUrl.value.trim() : "",
            defaultHashtags: dom.siteHashtags ? dom.siteHashtags.value.trim() : "",
            footerText: dom.siteFooterText ? dom.siteFooterText.value.trim() : "",
          };
          const resp = await fetch("/api/site-settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok || !data.success) {
            throw new Error(data.error || ("HTTP " + resp.status));
          }
          currentSiteSettings = data.settings || payload;
          showSiteMsg("✓ Nastavenia webu a texty boli uložené do cloudu D1.");
        } catch (err) {
          showSiteMsg("Chyba uloženia: " + err.message, true);
        } finally {
          if (btn) {
            btn.disabled = false;
            btn.textContent = orig;
          }
        }
      });
    }

    try {
      const resp = await fetch("/api/auth/me");
      const data = await resp.json();
      if (data && data.authenticated) {
        currentUsername = data.username || "mario";
        hideAuthGate();
        resetForm();
        await loadLookups();
        loadAutomationChannels();
        loadAutomationIntegrations();
        loadArtworks();
        loadInquiries();
        loadSiteSettings();
        handleDeepLinkOpenParam();
      } else {
        showAuthGate();
      }
    } catch {
      showAuthGate("Nepodarilo sa overiť prihlásenie.");
    }
  });
})();
