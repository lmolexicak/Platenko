/**
 * Platenko Art Portfolio - Public Gallery, Deep-Linking, Settings Auth & Navigation
 * (All editing/cropping/3D Cover Studio consolidated into unified /admin CMS)
 */
document.addEventListener("DOMContentLoaded", () => {
  const galleryGrid = document.getElementById("galleryGrid");
  const filterBar = document.getElementById("filterBar");
  const statusFilterGroup = document.getElementById("statusFilterGroup");
  const themeToggleBtn = document.getElementById("themeToggle");
  const loadMoreBtn = document.getElementById("loadMoreBtn");
  const loadMoreWrap = document.getElementById("loadMoreWrap");

  // Admin gear shortcut (direct navigation to /admin)
  const settingsBtn = document.getElementById("settingsBtn");

  // Filter & Search State (combinable Status + Size + Search query)
  const searchInput = document.getElementById("gallerySearchInput");
  const filterResetBtn = document.getElementById("galleryFilterResetBtn");
  const resultHintEl = document.getElementById("galleryResultHint");
  const ASSET_VER = "20261128c";
  const loadedScriptPromises = new Map();

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  const PAGE_SIZE = 24;
  let activeStatusFilter = "all";
  let activeSizeFilter = "all";
  let searchQuery = "";
  let currentFilteredList = [];
  let displayedCount = 0;
  let renderedEntries = [];
  let layoutRafId = null;
  let resizeTimerId = null;
  let lastLayoutKey = "";

  let _isAuthenticated = false;
  let _authUsername = null;
  let _masterArtworksList = null;
  let _statusLookups = [
    { code: "Available", label: "Dostupné", color: "green", showInFilter: true },
    { code: "Reserved", label: "Rezervované", color: "yellow", showInFilter: true },
    { code: "Sold", label: "Predané", color: "gray", showInFilter: true },
  ];

  function loadScriptOnce(src) {
    if (loadedScriptPromises.has(src)) return loadedScriptPromises.get(src);
    const p = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`Nepodarilo sa načítať modul ${src}`));
      document.body.appendChild(s);
    });
    loadedScriptPromises.set(src, p);
    return p;
  }

  function applySiteSettings(settings) {
    if (!settings || typeof settings !== "object") return;
    window.PlatenkoSiteSettings = settings;
    const setText = (id, val) => {
      if (val === undefined || val === null) return;
      const el = document.getElementById(id);
      if (el && String(val).trim() !== "") el.textContent = val;
    };
    setText("siteBrandTitle", settings.brandTitle);
    setText("siteBrandSubtitle", settings.brandSubtitle);
    setText("siteHeroTitle", settings.heroTitle);
    setText("siteHeroSubtitle", settings.heroSubtitle);
    setText("siteAboutHeading", settings.aboutHeading);
    setText("siteAboutText", settings.aboutText);
    setText("siteAboutCustomOrder", settings.aboutCustomOrder);
    setText("siteAboutShipping", settings.aboutShipping);
    setText("siteFooterText", settings.footerText);

    const igLink = document.getElementById("siteAboutInstagram");
    if (igLink) {
      if (settings.instagramUrl) igLink.href = settings.instagramUrl;
      if (settings.instagramHandle) igLink.textContent = `Sledovať na Instagrame ${settings.instagramHandle} ↗`;
    }
    if (settings.brandTitle && !new URLSearchParams(window.location.search).get("dielo")) {
      document.title = `${settings.brandTitle} | ${settings.brandSubtitle || "Abstraktné akrylové maľby na plátne"}`;
    }
  }

  function toThumbUrl(url) {
    if (!url || typeof url !== "string") return url;
    if (url.startsWith("data:") || url.startsWith("blob:")) return url;
    return url + (url.includes("?") ? "&" : "?") + "size=thumb";
  }

  // Top View Switcher & Toast
  const navViewCatalog = document.getElementById("navViewCatalog");
  const navView3D = document.getElementById("navView3D");
  const platenkoToast = document.getElementById("platenkoToast");
  let toastTimer = null;

  function showToast(message) {
    if (!platenkoToast) return;
    platenkoToast.textContent = message;
    platenkoToast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      platenkoToast.classList.remove("show");
    }, 2400);
  }

  function setActiveNavTab(mode) {
    if (navViewCatalog) {
      navViewCatalog.classList.toggle("active", mode === "catalog");
      navViewCatalog.setAttribute("aria-pressed", mode === "catalog" ? "true" : "false");
    }
    if (navView3D) {
      navView3D.classList.toggle("active", mode === "3d");
      navView3D.setAttribute("aria-pressed", mode === "3d" ? "true" : "false");
    }
  }

  function syncUrlParams(params) {
    try {
      const url = new URL(window.location.href);
      url.search = "";
      if (params && params.view) url.searchParams.set("view", params.view);
      if (params && params.dielo) url.searchParams.set("dielo", params.dielo);
      if (params && params.ar) url.searchParams.set("ar", params.ar);
      history.replaceState(null, "", url.pathname + url.search + url.hash);
    } catch {
      // ignore on restricted environments
    }
  }

  function buildShareUrl(artId, mode) {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    if (mode === "3d") url.searchParams.set("view", "3d");
    if (artId) url.searchParams.set("dielo", artId);
    if (mode === "ar") url.searchParams.set("ar", "1");
    return url.toString();
  }

  async function shareArtwork(art, mode, triggerBtn) {
    if (!art) return;
    const url = buildShareUrl(art.id, mode || "detail");
    const title = `Plátenko · ${art.title || "Dielo"}`;
    const text = `Pozrite si originálnu maľbu "${art.title || "Plátenko"}" (${art.dimensions || "akryl na plátne"})`;

    const isMobileTouch = /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent || "") ||
      ((navigator.maxTouchPoints || 0) > 1 && window.innerWidth <= 1024);

    if (isMobileTouch && navigator.share) {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (err) {
        if (err && err.name === "AbortError") return;
      }
    }

    let copied = false;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        copied = true;
      } catch {}
    }
    if (!copied) {
      const tmp = document.createElement("textarea");
      tmp.value = url;
      tmp.style.position = "fixed";
      tmp.style.opacity = "0";
      document.body.appendChild(tmp);
      tmp.select();
      try { copied = document.execCommand("copy"); } catch {}
      tmp.remove();
    }

    showToast("Odkaz skopírovaný");
    if (triggerBtn) {
      const origHtml = triggerBtn.innerHTML;
      triggerBtn.innerHTML = "✓ Odkaz skopírovaný";
      setTimeout(() => { triggerBtn.innerHTML = origHtml; }, 2200);
    }
  }

  // 1. Theme Toggle
  const savedTheme = localStorage.getItem("platenko_theme") || "light";
  document.documentElement.setAttribute("data-theme", savedTheme);
  updateThemeButton(savedTheme);

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", () => {
      const currentTheme = document.documentElement.getAttribute("data-theme");
      const newTheme = currentTheme === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", newTheme);
      localStorage.setItem("platenko_theme", newTheme);
      updateThemeButton(newTheme);
    });
  }

  function updateThemeButton(theme) {
    if (!themeToggleBtn) return;
    themeToggleBtn.innerHTML = theme === "dark" ? `☀️ <span>Svetlý</span>` : `🌙 <span>Tmavý</span>`;
  }

  // 2. Admin Auth Session Check (toggles ⚙️ highlight & detail CMS shortcut)
  function updateSettingsUI() {
    if (settingsBtn) {
      settingsBtn.classList.toggle("logged-in", _isAuthenticated);
    }
  }

  async function checkAuthSession() {
    try {
      const resp = await fetch("/api/auth/me");
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const data = await resp.json();
      _isAuthenticated = Boolean(data && data.authenticated);
      _authUsername = data && data.username ? data.username : null;
    } catch {
      _isAuthenticated = false;
      _authUsername = null;
    }
    updateSettingsUI();
  }

  // 3. Data Access — loads from /api/artworks
  function getArtworksList() {
    return _masterArtworksList || [];
  }

  function renderDynamicStatusFilters() {
    if (!statusFilterGroup) return;
    statusFilterGroup.innerHTML = "";
    _statusLookups
      .filter((s) => s.showInFilter !== false)
      .forEach((s) => {
        const filterVal = `status:${String(s.code).toLowerCase()}`;
        const btn = document.createElement("button");
        btn.className = `filter-btn${activeStatusFilter === filterVal ? " active" : ""}`;
        btn.dataset.filter = filterVal;
        btn.dataset.filterType = "status";
        btn.textContent = s.label;
        statusFilterGroup.appendChild(btn);
      });
  }

  async function loadArtworksFromAPI() {
    if (galleryGrid) {
      galleryGrid.innerHTML = `
        <div style="grid-column:1/-1;text-align:center;padding:80px 0;color:var(--text-muted);">
          <div style="font-size:2rem;margin-bottom:12px;">⏳</div>
          <p>Načítavam galériu…</p>
        </div>`;
    }

    const [artRes, lookupRes, siteRes] = await Promise.allSettled([
      fetch("/api/artworks").then((r) => (r.ok ? r.json() : Promise.reject(r.status))),
      fetch("/api/lookups").then((r) => (r.ok ? r.json() : Promise.reject(r.status))),
      fetch("/api/site-settings").then((r) => (r.ok ? r.json() : Promise.reject(r.status))),
    ]);

    if (siteRes.status === "fulfilled" && siteRes.value) {
      applySiteSettings(siteRes.value);
    }

    if (lookupRes.status === "fulfilled" && lookupRes.value && Array.isArray(lookupRes.value.statuses)) {
      _statusLookups = lookupRes.value.statuses;
      renderDynamicStatusFilters();
    }

    if (artRes.status === "fulfilled" && Array.isArray(artRes.value)) {
      _masterArtworksList = artRes.value;
      applyFiltersAndSearch();
      handleInitialDeepLink();
      return;
    }

    _masterArtworksList = [];
    if (loadMoreWrap) loadMoreWrap.style.display = "none";
    if (galleryGrid) {
      galleryGrid.innerHTML = `
        <div style="grid-column:1/-1;text-align:center;padding:80px 16px;color:var(--text-muted);">
          <div style="font-size:2rem;margin-bottom:12px;">⚠️</div>
          <p style="margin-bottom:16px;color:var(--text-main);font-weight:500;">Galériu sa nepodarilo načítať.</p>
          <button type="button" id="retryGalleryLoadBtn" class="filter-btn active" style="padding:10px 20px;">Skúsiť znova</button>
        </div>`;
      const retryBtn = document.getElementById("retryGalleryLoadBtn");
      if (retryBtn) {
        retryBtn.addEventListener("click", () => loadArtworksFromAPI());
      }
    }
  }

  function handleInitialDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const dieloId = params.get("dielo");
    const viewMode = params.get("view");
    const arFlag = params.get("ar");
    const list = getArtworksList();
    const targetArt = dieloId ? list.find((a) => a.id === dieloId) : null;

    if (viewMode === "3d") {
      open3DGallery(dieloId || null);
      return;
    }
    if (targetArt && arFlag === "1") {
      openARViewer(targetArt);
      return;
    }
    if (targetArt) {
      openArtworkModal(targetArt);
    }
  }

  function normalizeStatus(status) {
    const raw = (status || "Available").trim();
    const s = raw.toLowerCase();
    const matched = _statusLookups.find(
      (item) => (item.code || "").toLowerCase() === s || (item.label || "").toLowerCase() === s
    );
    if (matched) {
      return {
        key: String(matched.code).toLowerCase(),
        label: matched.label,
        badgeClass: `badge-color-${matched.color || "blue"}`,
      };
    }
    if (s === "reserved" || s === "rezervovane" || s === "rezervované") {
      return { key: "reserved", label: "Rezervované", badgeClass: "badge-color-yellow" };
    }
    if (s === "sold" || s === "predane" || s === "predané") {
      return { key: "sold", label: "Predané", badgeClass: "badge-color-gray" };
    }
    return { key: s || "available", label: raw || "Dostupné", badgeClass: "badge-color-green" };
  }

  function getMaxDimensionCm(dimensionsStr) {
    if (!dimensionsStr || typeof dimensionsStr !== "string") return null;
    const nums = dimensionsStr.match(/\d+(?:[.,]\d+)?/g);
    if (!nums || nums.length === 0) return null;
    const parsed = nums.slice(0, 2).map((n) => parseFloat(n.replace(",", "."))).filter((n) => !isNaN(n));
    return parsed.length > 0 ? Math.max(...parsed) : null;
  }

  // 4. Render White Cube Catalog Grid (Combined Status + Size + Live Search)
  function updateFilterButtonsUI() {
    if (!filterBar) return;
    const isAll = activeStatusFilter === "all" && activeSizeFilter === "all";
    filterBar.querySelectorAll(".filter-btn").forEach((b) => {
      const f = b.dataset.filter || "";
      const fType = b.dataset.filterType || (f === "all" ? "all" : (f.startsWith("size-") ? "size" : "status"));
      if (fType === "all") {
        b.classList.toggle("active", isAll);
      } else if (fType === "status") {
        b.classList.toggle("active", activeStatusFilter === f);
      } else if (fType === "size") {
        b.classList.toggle("active", activeSizeFilter === f);
      }
    });

    const hasFilters = !isAll || searchQuery.trim().length > 0;
    if (filterResetBtn) {
      filterResetBtn.style.display = hasFilters ? "inline-flex" : "none";
    }
    if (resultHintEl) {
      if (hasFilters && _masterArtworksList) {
        resultHintEl.style.display = "inline";
        resultHintEl.textContent = `Zobrazených ${currentFilteredList.length} z ${_masterArtworksList.length} diel`;
      } else {
        resultHintEl.style.display = "none";
      }
    }
  }

  function applyFiltersAndSearch() {
    const all = getArtworksList();
    const q = searchQuery.trim().toLowerCase();

    currentFilteredList = all.filter((item) => {
      if (activeStatusFilter !== "all") {
        const st = normalizeStatus(item.status).key;
        const wanted = activeStatusFilter.startsWith("status:")
          ? activeStatusFilter.substring("status:".length)
          : activeStatusFilter;
        if (st !== wanted) return false;
      }

      if (activeSizeFilter !== "all") {
        const maxDim = getMaxDimensionCm(item.dimensions || "50 × 70 cm");
        if (!maxDim) return false;
        if (activeSizeFilter === "size-small" && !(maxDim < 60)) return false;
        if (activeSizeFilter === "size-medium" && !(maxDim >= 60 && maxDim <= 100)) return false;
        if (activeSizeFilter === "size-large" && !(maxDim > 100)) return false;
      }

      if (q) {
        const hay = `${item.title || ""} ${item.technique || ""} ${item.medium || ""} ${item.dimensions || ""} ${item.year || ""} ${item.description || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    galleryGrid.innerHTML = "";
    displayedCount = 0;
    renderedEntries = [];
    lastLayoutKey = "";

    const allBtn = document.querySelector('[data-filter="all"]');
    if (allBtn) allBtn.textContent = `Všetky maľby (${all.length})`;
    updateFilterButtonsUI();

    if (currentFilteredList.length === 0) {
      galleryGrid.innerHTML = `
        <div style="text-align: center; padding: 60px 0; color: var(--text-muted);">
          Pre zvolené filtre sa nenašli žiadne maľby.
        </div>`;
      if (loadMoreWrap) loadMoreWrap.style.display = "none";
      return;
    }

    renderNextBatch();
  }

  function clampRatio(r) {
    if (!Number.isFinite(r) || r <= 0) return 5 / 7;
    return Math.min(3.2, Math.max(0.3, r));
  }

  function getInitialAspectRatio(art) {
    if (Number(art && art.coverAspectRatio) > 0) {
      return clampRatio(Number(art.coverAspectRatio));
    }
    let w = Number(art && art.widthCm);
    let h = Number(art && art.heightCm);
    if (!(w > 0 && h > 0) && art && typeof art.dimensions === "string") {
      const nums = art.dimensions.match(/\d+(?:[.,]\d+)?/g);
      if (nums && nums.length >= 2) {
        w = parseFloat(nums[0].replace(",", "."));
        h = parseFloat(nums[1].replace(",", "."));
      }
    }
    return (w > 0 && h > 0) ? clampRatio(w / h) : (5 / 7);
  }

  function layoutJustifiedGallery() {
    layoutRafId = null;
    if (!galleryGrid || renderedEntries.length === 0) return;

    const containerW = galleryGrid.clientWidth;
    if (!containerW || containerW < 100) return;

    // Mobile single-column stack: natural uncropped aspect per card
    if (window.innerWidth < 640 || containerW < 520) {
      const mobileKey = `mob:${renderedEntries.length}`;
      galleryGrid.classList.add("is-mobile-stack");
      if (lastLayoutKey === mobileKey && galleryGrid.children.length === renderedEntries.length) {
        renderedEntries.forEach((entry) => {
          entry.card.style.width = "";
          entry.imgWrap.style.height = "";
          entry.imgWrap.style.aspectRatio = String(entry.ratio);
        });
        return;
      }
      galleryGrid.innerHTML = "";
      renderedEntries.forEach((entry) => {
        entry.card.style.width = "";
        entry.imgWrap.style.height = "";
        entry.imgWrap.style.aspectRatio = String(entry.ratio);
        galleryGrid.appendChild(entry.card);
      });
      lastLayoutKey = mobileKey;
      return;
    }

    galleryGrid.classList.remove("is-mobile-stack");
    const targetH = containerW >= 1020 ? 355 : (containerW >= 740 ? 305 : 265);
    const maxRowH = targetH * 1.32;
    const gap = containerW >= 1020 ? 30 : 22;

    const rows = [];
    let i = 0;
    while (i < renderedEntries.length) {
      let sumRatio = 0;
      let count = 0;
      let chosenCount = 1;
      let chosenH = targetH;

      for (let j = i; j < renderedEntries.length; j++) {
        sumRatio += renderedEntries[j].ratio;
        count++;
        const availW = containerW - gap * (count - 1);
        const hCurr = availW / sumRatio;

        if (hCurr <= targetH || j === renderedEntries.length - 1) {
          if (count > 1 && j < renderedEntries.length - 1) {
            const prevSum = sumRatio - renderedEntries[j].ratio;
            const hPrev = (containerW - gap * (count - 2)) / prevSum;
            if (Math.abs(hPrev - targetH) < Math.abs(hCurr - targetH) && hPrev <= maxRowH) {
              chosenCount = count - 1;
              chosenH = hPrev;
            } else {
              chosenCount = count;
              chosenH = hCurr;
            }
          } else {
            chosenCount = count;
            chosenH = hCurr;
          }
          break;
        }
      }

      const isLastRow = (i + chosenCount) >= renderedEntries.length;
      if (isLastRow && chosenH > targetH * 1.15) {
        chosenH = targetH;
      } else {
        chosenH = Math.min(maxRowH, Math.max(190, chosenH));
      }

      rows.push({
        items: renderedEntries.slice(i, i + chosenCount),
        height: chosenH,
        isLastRow,
      });
      i += chosenCount;
    }

    const rowKey = rows.map((r) => r.items.map((it) => it.art.id).join(",")).join("|");
    const canReuseRows = lastLayoutKey === rowKey && galleryGrid.children.length === rows.length;

    if (canReuseRows) {
      rows.forEach((row, rIdx) => {
        const rowEl = galleryGrid.children[rIdx];
        rowEl.style.gap = `${gap}px`;
        const rowH = Math.round(row.height);
        const totalGapW = gap * (row.items.length - 1);
        const fullWidthRow = !row.isLastRow || (row.items.reduce((s, it) => s + rowH * it.ratio, 0) + totalGapW >= containerW - 4);
        let usedW = 0;

        row.items.forEach((entry, idx) => {
          let cardW;
          if (fullWidthRow && idx === row.items.length - 1) {
            cardW = Math.max(80, containerW - totalGapW - usedW);
          } else {
            cardW = Math.max(80, Math.round(rowH * entry.ratio));
            usedW += cardW;
          }
          entry.card.style.width = `${cardW}px`;
          entry.imgWrap.style.aspectRatio = "";
          entry.imgWrap.style.height = `${rowH}px`;
        });
      });
      return;
    }

    const frag = document.createDocumentFragment();
    rows.forEach((row) => {
      const rowEl = document.createElement("div");
      rowEl.className = "gallery-row";
      rowEl.style.gap = `${gap}px`;

      const rowH = Math.round(row.height);
      const totalGapW = gap * (row.items.length - 1);
      const fullWidthRow = !row.isLastRow || (row.items.reduce((s, it) => s + rowH * it.ratio, 0) + totalGapW >= containerW - 4);
      let usedW = 0;

      row.items.forEach((entry, idx) => {
        let cardW;
        if (fullWidthRow && idx === row.items.length - 1) {
          cardW = Math.max(80, containerW - totalGapW - usedW);
        } else {
          cardW = Math.max(80, Math.round(rowH * entry.ratio));
          usedW += cardW;
        }
        entry.card.style.width = `${cardW}px`;
        entry.imgWrap.style.aspectRatio = "";
        entry.imgWrap.style.height = `${rowH}px`;
        rowEl.appendChild(entry.card);
      });

      frag.appendChild(rowEl);
    });

    galleryGrid.innerHTML = "";
    galleryGrid.appendChild(frag);
    lastLayoutKey = rowKey;
  }

  function scheduleJustifiedLayout() {
    if (layoutRafId !== null) return;
    layoutRafId = requestAnimationFrame(layoutJustifiedGallery);
  }

  function renderNextBatch() {
    const nextBatch = currentFilteredList.slice(displayedCount, displayedCount + PAGE_SIZE);

    nextBatch.forEach((art, batchIdx) => {
      const card = document.createElement("div");
      card.className = "artwork-card";
      card.id = `card-${art.id}`;

      const statusInfo = normalizeStatus(art.status);
      const photoCount = art.photoCount || (art.detailImages ? art.detailImages.length : 1);
      const isPriorityCard = (displayedCount + batchIdx) < 6;
      const imgLoadingAttrs = isPriorityCard
        ? 'loading="eager" fetchpriority="high"'
        : 'loading="lazy"';

      card.innerHTML = `
        <div class="card-image-wrap">
          <img src="${escapeHtml(toThumbUrl(art.coverImage))}" alt="${escapeHtml(art.title || "")}" ${imgLoadingAttrs} decoding="async">
        </div>
        <div class="card-details">
          <div class="card-title-row">
            <h3 class="card-title">${escapeHtml(art.title || "")}</h3>
            <span class="status-pill ${escapeHtml(statusInfo.badgeClass)}">${escapeHtml(statusInfo.label)}</span>
          </div>
          <div class="card-submeta">
            <span>${escapeHtml(art.dimensions || "50 × 70 cm")}</span>
            <span>·</span>
            <span>${escapeHtml(art.medium || "Akryl na plátne")}</span>
            ${photoCount > 1 ? `<span>· ${photoCount} fotiek</span>` : ""}
          </div>
        </div>
      `;

      const imgWrap = card.querySelector(".card-image-wrap");
      const img = imgWrap.querySelector("img");
      const initialRatio = getInitialAspectRatio(art);
      imgWrap.style.aspectRatio = String(initialRatio);
      const entry = {
        art,
        card,
        imgWrap,
        img,
        ratio: initialRatio,
      };

      const updateRatioFromImage = () => {
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          const naturalRatio = clampRatio(img.naturalWidth / img.naturalHeight);
          if (Math.abs(naturalRatio - entry.ratio) > 0.015) {
            entry.ratio = naturalRatio;
            scheduleJustifiedLayout();
          }
        }
      };

      if (img.complete && img.naturalWidth > 0) {
        entry.ratio = clampRatio(img.naturalWidth / img.naturalHeight);
      } else {
        img.addEventListener("load", updateRatioFromImage);
      }

      card.addEventListener("click", () => openArtworkModal(art));
      renderedEntries.push(entry);
    });

    displayedCount += nextBatch.length;
    layoutJustifiedGallery();

    if (loadMoreWrap) {
      if (displayedCount >= currentFilteredList.length) {
        loadMoreWrap.style.display = "none";
      } else {
        loadMoreWrap.style.display = "flex";
        const remaining = currentFilteredList.length - displayedCount;
        loadMoreBtn.textContent = `Zobraziť ďalšie maľby (+${Math.min(remaining, PAGE_SIZE)} z ${remaining})`;
      }
    }
  }

  window.addEventListener("resize", () => {
    clearTimeout(resizeTimerId);
    resizeTimerId = setTimeout(scheduleJustifiedLayout, 90);
  });

  if (loadMoreBtn) loadMoreBtn.addEventListener("click", renderNextBatch);

  if (filterBar) {
    filterBar.addEventListener("click", (e) => {
      const btn = e.target.closest(".filter-btn");
      if (!btn) return;
      const f = btn.dataset.filter || "all";
      const fType = btn.dataset.filterType || (f === "all" ? "all" : (f.startsWith("size-") ? "size" : "status"));
      if (fType === "all") {
        activeStatusFilter = "all";
        activeSizeFilter = "all";
      } else if (fType === "status") {
        activeStatusFilter = (activeStatusFilter === f) ? "all" : f;
      } else if (fType === "size") {
        activeSizeFilter = (activeSizeFilter === f) ? "all" : f;
      }
      applyFiltersAndSearch();
    });
  }

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      searchQuery = searchInput.value || "";
      applyFiltersAndSearch();
    });
  }

  if (filterResetBtn) {
    filterResetBtn.addEventListener("click", () => {
      activeStatusFilter = "all";
      activeSizeFilter = "all";
      searchQuery = "";
      if (searchInput) searchInput.value = "";
      applyFiltersAndSearch();
    });
  }

  // 5. Detail Modal, Lazy-Loaded AR & 3D Gallery Delegation
  function openArtworkModal(art) {
    if (!window.PlatenkoDetailModal || !art) return;
    window.PlatenkoDetailModal.open(art, {
      toThumbUrl,
      normalizeStatus,
      isAuthenticated: _isAuthenticated,
      onOpen: (openedArt) => {
        const in3D = window.Platenko3DGallery && window.Platenko3DGallery.isOpen();
        syncUrlParams({ view: in3D ? "3d" : null, dielo: openedArt.id });
      },
      onClose: () => {
        const in3D = window.Platenko3DGallery && window.Platenko3DGallery.isOpen();
        if (in3D) {
          syncUrlParams({ view: "3d", dielo: art.id });
        } else {
          syncUrlParams({});
        }
      },
      onShare: (sharedArt, btn) => shareArtwork(sharedArt, "detail", btn),
      onOpenAR: (arArt) => openARViewer(arArt),
    });
  }

  async function openARViewer(art) {
    if (!art) return;
    if (!window.PlatenkoARViewer) {
      showToast("Pripravujem AR náhľad…");
      try {
        await loadScriptOnce(`ar-viewer.js?v=${ASSET_VER}`);
      } catch (err) {
        showToast(err.message || "AR modul sa nepodarilo načítať.");
        return;
      }
    }
    if (!window.PlatenkoARViewer) return;
    window.PlatenkoARViewer.open(art, getArtworksList(), {
      onOpen: (openedArt) => {
        syncUrlParams({ dielo: openedArt.id, ar: "1" });
      },
      onClose: () => {
        const in3D = window.Platenko3DGallery && window.Platenko3DGallery.isOpen();
        const modalOpen = window.PlatenkoDetailModal && window.PlatenkoDetailModal.isOpen();
        if (in3D) {
          syncUrlParams({ view: "3d", dielo: art.id });
        } else if (modalOpen) {
          syncUrlParams({ dielo: art.id });
        } else {
          syncUrlParams({});
        }
      },
      onShare: (sharedArt, btn) => shareArtwork(sharedArt, "ar", btn),
    });
  }

  async function open3DGallery(initialArtworkId) {
    if (!window.Platenko3DGallery) {
      showToast("Načítavam 3D galériu…");
      try {
        await loadScriptOnce(`gallery-3d.js?v=${ASSET_VER}`);
      } catch (err) {
        showToast(err.message || "3D modul sa nepodarilo načítať.");
        return;
      }
    }
    if (!window.Platenko3DGallery) return;
    setActiveNavTab("3d");
    syncUrlParams({ view: "3d", dielo: initialArtworkId || null });
    window.Platenko3DGallery.open(getArtworksList(), {
      initialArtworkId: initialArtworkId || null,
      onFocusArtwork: (focusedArt) => {
        syncUrlParams({ view: "3d", dielo: focusedArt.id });
      },
      onLeaveArtwork: () => {
        syncUrlParams({ view: "3d" });
      },
      onOpenDetail: (detailArt) => openArtworkModal(detailArt),
      onOpenAR: (arArt) => openARViewer(arArt),
      onShare: (sharedArt, btn) => shareArtwork(sharedArt, "3d", btn),
      onClose: () => {
        setActiveNavTab("catalog");
        syncUrlParams({});
      },
    });
  }

  if (navViewCatalog) {
    navViewCatalog.addEventListener("click", () => {
      if (window.Platenko3DGallery && window.Platenko3DGallery.isOpen()) {
        window.Platenko3DGallery.close();
      }
      setActiveNavTab("catalog");
      syncUrlParams({});
    });
  }
  if (navView3D) {
    navView3D.addEventListener("click", () => {
      open3DGallery(null);
    });
  }

  window.PlatenkoApp = {
    shareArtwork,
    showToast,
    buildShareUrl,
    openARViewer,
    open3DGallery,
  };

  checkAuthSession();
  loadArtworksFromAPI();
});
