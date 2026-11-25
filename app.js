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

  // Settings & Auth Elements
  const settingsBtn = document.getElementById("settingsBtn");
  const settingsModal = document.getElementById("settingsModal");
  const settingsModalCloseBtn = document.getElementById("settingsModalCloseBtn");
  const settingsLoginView = document.getElementById("settingsLoginView");
  const settingsAdminView = document.getElementById("settingsAdminView");
  const settingsUserLabel = document.getElementById("settingsUserLabel");
  const loginForm = document.getElementById("loginForm");
  const loginUsernameInput = document.getElementById("loginUsername");
  const loginPasswordInput = document.getElementById("loginPassword");
  const loginErrorEl = document.getElementById("loginError");
  const loginSubmitBtn = document.getElementById("loginSubmitBtn");
  const changePasswordForm = document.getElementById("changePasswordForm");
  const changePassMsgEl = document.getElementById("changePassMsg");
  const logoutBtn = document.getElementById("logoutBtn");

  const PAGE_SIZE = 24;
  let activeFilter = "all";
  let currentFilteredList = [];
  let displayedCount = 0;
  let renderedEntries = [];
  let layoutRafId = null;
  let resizeTimerId = null;

  let _isAuthenticated = false;
  let _authUsername = null;
  let _masterArtworksList = null;
  let _statusLookups = [
    { code: "Available", label: "Dostupné", color: "green", showInFilter: true },
    { code: "Reserved", label: "Rezervované", color: "yellow", showInFilter: true },
    { code: "Sold", label: "Predané", color: "gray", showInFilter: true },
  ];

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

  // 2. Settings & Auth Handling
  function updateSettingsUI() {
    if (settingsBtn) {
      settingsBtn.classList.toggle("logged-in", _isAuthenticated);
    }
    if (settingsLoginView && settingsAdminView) {
      settingsLoginView.style.display = _isAuthenticated ? "none" : "block";
      settingsAdminView.style.display = _isAuthenticated ? "block" : "none";
    }
    if (settingsUserLabel && _authUsername) {
      settingsUserLabel.textContent = _authUsername;
    }
  }

  function openSettingsModal() {
    if (!settingsModal) return;
    updateSettingsUI();
    if (loginErrorEl) loginErrorEl.style.display = "none";
    if (changePassMsgEl) changePassMsgEl.style.display = "none";
    settingsModal.classList.add("open");
    document.body.style.overflow = "hidden";
    if (!_isAuthenticated) {
      setTimeout(() => {
        if (loginUsernameInput && !loginUsernameInput.value) {
          loginUsernameInput.focus();
        } else if (loginPasswordInput) {
          loginPasswordInput.focus();
        }
      }, 60);
    }
  }

  function closeSettingsModal() {
    if (!settingsModal) return;
    settingsModal.classList.remove("open");
    document.body.style.overflow = "";
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

  if (settingsBtn) settingsBtn.addEventListener("click", openSettingsModal);
  if (settingsModalCloseBtn) settingsModalCloseBtn.addEventListener("click", closeSettingsModal);
  if (settingsModal) {
    settingsModal.addEventListener("click", (e) => {
      if (e.target === settingsModal) closeSettingsModal();
    });
  }

  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (loginErrorEl) loginErrorEl.style.display = "none";
      if (loginSubmitBtn) loginSubmitBtn.disabled = true;

      try {
        const resp = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: loginUsernameInput ? loginUsernameInput.value.trim() : "mario",
            password: loginPasswordInput ? loginPasswordInput.value : "",
          }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.authenticated) {
          throw new Error(data.error || "Nesprávne meno alebo heslo.");
        }
        _isAuthenticated = true;
        _authUsername = data.username || "mario";
        if (loginPasswordInput) loginPasswordInput.value = "";
        updateSettingsUI();
      } catch (err) {
        if (loginErrorEl) {
          loginErrorEl.textContent = err.message || "Chyba prihlásenia.";
          loginErrorEl.style.display = "block";
        }
      } finally {
        if (loginSubmitBtn) loginSubmitBtn.disabled = false;
      }
    });
  }

  if (changePasswordForm) {
    changePasswordForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const curPass = document.getElementById("currentPassword").value;
      const newPass = document.getElementById("newPassword").value;
      const confPass = document.getElementById("confirmPassword").value;

      const showMsg = (text, isErr) => {
        if (!changePassMsgEl) return;
        changePassMsgEl.textContent = text;
        changePassMsgEl.className = isErr ? "settings-error" : "settings-success";
        changePassMsgEl.style.display = "block";
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
          _isAuthenticated = false;
          _authUsername = null;
          updateSettingsUI();
          showMsg("Prihlásenie vypršalo.", true);
          return;
        }
        if (!resp.ok || !data.success) {
          throw new Error(data.error || "Nepodarilo sa zmeniť heslo.");
        }
        changePasswordForm.reset();
        showMsg("Heslo bolo úspešne zmenené.", false);
      } catch (err) {
        showMsg(err.message || "Chyba pri zmene hesla.", true);
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      try { await fetch("/api/auth/logout", { method: "POST" }); } catch {}
      _isAuthenticated = false;
      _authUsername = null;
      updateSettingsUI();
      closeSettingsModal();
    });
  }

  // 3. Data Access — loads from /api/artworks, falls back to artworksData
  function getArtworksList() {
    return _masterArtworksList || [];
  }

  function renderDynamicStatusFilters() {
    if (!statusFilterGroup) return;
    statusFilterGroup.innerHTML = "";
    _statusLookups
      .filter((s) => s.showInFilter !== false)
      .forEach((s) => {
        const btn = document.createElement("button");
        btn.className = "filter-btn";
        btn.dataset.filter = `status:${String(s.code).toLowerCase()}`;
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

    const [artRes, lookupRes] = await Promise.allSettled([
      fetch("/api/artworks").then((r) => (r.ok ? r.json() : Promise.reject(r.status))),
      fetch("/api/lookups").then((r) => (r.ok ? r.json() : Promise.reject(r.status))),
    ]);

    if (lookupRes.status === "fulfilled" && lookupRes.value && Array.isArray(lookupRes.value.statuses)) {
      _statusLookups = lookupRes.value.statuses;
      renderDynamicStatusFilters();
    }

    if (artRes.status === "fulfilled" && Array.isArray(artRes.value) && artRes.value.length > 0) {
      _masterArtworksList = artRes.value;
    } else {
      console.warn("API load failed, falling back to artworksData");
      _masterArtworksList = (typeof artworksData !== "undefined" && Array.isArray(artworksData))
        ? artworksData : [];
    }

    applyFilter("all");
    handleInitialDeepLink();
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

  // 4. Render White Cube Catalog Grid
  function applyFilter(filter) {
    activeFilter = filter;
    const all = getArtworksList();

    currentFilteredList = all.filter((item) => {
      if (filter === "all") return true;
      const st = normalizeStatus(item.status).key;
      if (filter.startsWith("status:")) {
        return st === filter.substring("status:".length);
      }
      if (filter === "available" || filter === "reserved" || filter === "sold") {
        return st === filter;
      }
      if (filter === "size-small" || filter === "size-medium" || filter === "size-large") {
        const maxDim = getMaxDimensionCm(item.dimensions || "50 × 70 cm");
        if (!maxDim) return false;
        if (filter === "size-small") return maxDim < 60;
        if (filter === "size-medium") return maxDim >= 60 && maxDim <= 100;
        if (filter === "size-large") return maxDim > 100;
      }
      if (filter === "2024" || filter === "2023" || filter === "2022") return item.year === filter;
      if (filter === "multi") return (item.photoCount || (item.detailImages && item.detailImages.length) || 1) >= 3;
      return (item.technique || "").toLowerCase() === filter.toLowerCase();
    });

    galleryGrid.innerHTML = "";
    displayedCount = 0;
    renderedEntries = [];

    const allBtn = document.querySelector('[data-filter="all"]');
    if (allBtn) allBtn.textContent = `Všetky maľby (${all.length})`;

    if (currentFilteredList.length === 0) {
      galleryGrid.innerHTML = `
        <div style="text-align: center; padding: 60px 0; color: var(--text-muted);">
          V tejto kategórii sa nenašli žiadne maľby.
        </div>`;
      if (loadMoreWrap) loadMoreWrap.style.display = "none";
      return;
    }

    renderNextBatch();
  }

  function clampRatio(r) {
    if (!Number.isFinite(r) || r <= 0) return 5 / 7;
    return Math.min(2.3, Math.max(0.42, r));
  }

  function getInitialAspectRatio(art) {
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
      galleryGrid.classList.add("is-mobile-stack");
      galleryGrid.innerHTML = "";
      renderedEntries.forEach((entry) => {
        entry.card.style.width = "";
        entry.imgWrap.style.height = "";
        galleryGrid.appendChild(entry.card);
      });
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
        entry.imgWrap.style.height = `${rowH}px`;
        rowEl.appendChild(entry.card);
      });

      frag.appendChild(rowEl);
    });

    galleryGrid.innerHTML = "";
    galleryGrid.appendChild(frag);
  }

  function scheduleJustifiedLayout() {
    if (layoutRafId !== null) return;
    layoutRafId = requestAnimationFrame(layoutJustifiedGallery);
  }

  function renderNextBatch() {
    const nextBatch = currentFilteredList.slice(displayedCount, displayedCount + PAGE_SIZE);

    nextBatch.forEach((art) => {
      const card = document.createElement("div");
      card.className = "artwork-card";
      card.id = `card-${art.id}`;

      const statusInfo = normalizeStatus(art.status);
      const photoCount = art.photoCount || (art.detailImages ? art.detailImages.length : 1);

      card.innerHTML = `
        <div class="card-image-wrap">
          <img src="${toThumbUrl(art.coverImage)}" alt="${art.title}" loading="lazy" decoding="async">
        </div>
        <div class="card-details">
          <div class="card-title-row">
            <h3 class="card-title">${art.title}</h3>
            <span class="status-pill ${statusInfo.badgeClass}">${statusInfo.label}</span>
          </div>
          <div class="card-submeta">
            <span>${art.dimensions || "50 × 70 cm"}</span>
            <span>·</span>
            <span>${art.medium || "Akryl na plátne"}</span>
            ${photoCount > 1 ? `<span>· ${photoCount} fotiek</span>` : ""}
          </div>
        </div>
      `;

      const imgWrap = card.querySelector(".card-image-wrap");
      const img = imgWrap.querySelector("img");
      const entry = {
        art,
        card,
        imgWrap,
        img,
        ratio: getInitialAspectRatio(art),
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
      filterBar.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      applyFilter(btn.dataset.filter);
    });
  }

  // 5. Detail Modal, AR & 3D Gallery Delegation
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

  function openARViewer(art) {
    if (!art || !window.PlatenkoARViewer) return;
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

  function open3DGallery(initialArtworkId) {
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
