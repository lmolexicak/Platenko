/**
 * Platenko Art Portfolio - Application Logic
 */

document.addEventListener("DOMContentLoaded", () => {
  const galleryGrid = document.getElementById("galleryGrid");
  const filterButtons = document.querySelectorAll(".filter-btn");
  const modalOverlay = document.getElementById("artworkModal");
  const modalCloseBtn = document.getElementById("modalCloseBtn");
  const themeToggleBtn = document.getElementById("themeToggle");
  const loadMoreBtn = document.getElementById("loadMoreBtn");
  const loadMoreWrap = document.getElementById("loadMoreWrap");
  const modalPrevBtn = document.getElementById("modalPrevBtn");
  const modalNextBtn = document.getElementById("modalNextBtn");

  // Admin Mode Elements
  const adminToggleBtn = document.getElementById("adminToggleBtn");
  const adminBanner = document.getElementById("adminBanner");
  const adminDeletedCountEl = document.getElementById("adminDeletedCount");
  const adminUndoBtn = document.getElementById("adminUndoBtn");
  const adminExportBtn = document.getElementById("adminExportBtn");
  const adminExitBtn = document.getElementById("adminExitBtn");

  // Edit Modal Elements
  const editModal = document.getElementById("editModal");
  const editModalCloseBtn = document.getElementById("editModalCloseBtn");
  const editModalCancelBtn = document.getElementById("editModalCancelBtn");
  const editModalSaveBtn = document.getElementById("editModalSaveBtn");

  const PAGE_SIZE = 24;
  let activeFilter = "all";
  let currentFilteredList = [];
  let displayedCount = 0;

  // Track deleted paintings
  let deletedIds = new Set(JSON.parse(localStorage.getItem("platenko_deleted_ids") || "[]"));
  let undoStack = [];

  // Custom edits (title, description etc.) stored in localStorage
  let customEdits = JSON.parse(localStorage.getItem("platenko_custom_edits") || "{}");

  // Edit modal state
  let editingArtId = null;
  let editPhotos = []; // current photo list being edited

  // Modal navigation state
  let currentArtworkImages = [];
  let currentImageIndex = 0;

  // 1. Theme Toggle Initialization
  const savedTheme = localStorage.getItem("platenko_theme") || "light";
  document.documentElement.setAttribute("data-theme", savedTheme);
  updateThemeButton(savedTheme);

  themeToggleBtn.addEventListener("click", () => {
    const currentTheme = document.documentElement.getAttribute("data-theme");
    const newTheme = currentTheme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", newTheme);
    localStorage.setItem("platenko_theme", newTheme);
    updateThemeButton(newTheme);
  });

  function updateThemeButton(theme) {
    if (theme === "dark") {
      themeToggleBtn.innerHTML = `☀️ <span>Svetlý</span>`;
    } else {
      themeToggleBtn.innerHTML = `🌙 <span>Tmavý</span>`;
    }
  }

  // 2. Admin Mode Handling
  function setAdminMode(enable) {
    if (enable) {
      document.body.classList.add("admin-mode");
      if (adminToggleBtn) {
        adminToggleBtn.classList.add("admin-active");
        adminToggleBtn.innerHTML = `🛠️ <span>Admin: ZAP</span>`;
      }
    } else {
      document.body.classList.remove("admin-mode");
      if (adminToggleBtn) {
        adminToggleBtn.classList.remove("admin-active");
        adminToggleBtn.innerHTML = `🛠️ <span>Admin mód</span>`;
      }
    }
    updateAdminStats();
  }

  function updateAdminStats() {
    if (adminDeletedCountEl) {
      adminDeletedCountEl.textContent = _usingCloudAPI ? undoStack.length : deletedIds.size;
    }
    if (adminUndoBtn) {
      adminUndoBtn.disabled = undoStack.length === 0;
      adminUndoBtn.style.opacity = undoStack.length === 0 ? "0.5" : "1";
    }
  }

  if (adminToggleBtn) {
    adminToggleBtn.addEventListener("click", () => {
      const isCurrently = document.body.classList.contains("admin-mode");
      setAdminMode(!isCurrently);
    });
  }

  if (adminExitBtn) {
    adminExitBtn.addEventListener("click", () => setAdminMode(false));
  }

  if (adminUndoBtn) {
    adminUndoBtn.addEventListener("click", async () => {
      if (undoStack.length === 0) return;

      if (_usingCloudAPI) {
        const restoredArt = undoStack.pop();
        if (restoredArt && restoredArt.id) {
          if (!_masterArtworksList) _masterArtworksList = [];
          if (!_masterArtworksList.some(a => a.id === restoredArt.id)) {
            _masterArtworksList.push(restoredArt);
            _masterArtworksList.sort((a, b) =>
              (b.date || "").localeCompare(a.date || "") || (b.id || "").localeCompare(a.id || "")
            );
          }
          try {
            const resp = await fetch("/api/artworks", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(restoredArt)
            });
            if (!resp.ok) throw new Error("HTTP " + resp.status);
          } catch (err) {
            console.warn("D1 restore failed:", err);
          }
        }
        updateAdminStats();
        applyFilter(activeFilter);
        return;
      }

      const restoredId = undoStack.pop();
      deletedIds.delete(restoredId);
      localStorage.setItem("platenko_deleted_ids", JSON.stringify([...deletedIds]));
      updateAdminStats();
      applyFilter(activeFilter);
    });
  }

  if (adminExportBtn) {
    adminExportBtn.addEventListener("click", () => {
      if (_usingCloudAPI) {
        updateAdminStats();
        const origText = adminExportBtn.innerHTML;
        adminExportBtn.innerHTML = `✓ Všetko je uložené v cloude!`;
        adminExportBtn.style.backgroundColor = "#16a34a";

        setTimeout(() => {
          adminExportBtn.innerHTML = origText;
          adminExportBtn.style.backgroundColor = "";
        }, 2000);
        return;
      }

      // Uloženie stavu do pamäte prehliadača (offline fallback)
      localStorage.setItem("platenko_deleted_ids", JSON.stringify([...deletedIds]));
      updateAdminStats();

      // Vizuálne potvrdenie priamo na tlačidle bez vyskakovacích okien
      const origText = adminExportBtn.innerHTML;
      adminExportBtn.innerHTML = `✓ Zmeny uložené!`;
      adminExportBtn.style.backgroundColor = "#16a34a";

      setTimeout(() => {
        adminExportBtn.innerHTML = origText;
        adminExportBtn.style.backgroundColor = "";
      }, 2000);
    });
  }

  // 3. Data Access — loads from API (D1 database), falls back to artworksData
  // Master list fetched once from /api/artworks
  let _masterArtworksList = null;
  let _usingCloudAPI = false;

  function getArtworksList() {
    if (_usingCloudAPI) {
      return _masterArtworksList || [];
    }
    const base = _masterArtworksList || [];
    return base
      .filter(item => !deletedIds.has(item.id))
      .map(item => {
        const edits = customEdits[item.id];
        return edits ? Object.assign({}, item, edits) : item;
      });
  }

  async function loadArtworksFromAPI() {
    // Show loading indicator
    if (galleryGrid) {
      galleryGrid.innerHTML = `
        <div style="grid-column:1/-1;text-align:center;padding:80px 0;color:var(--text-muted);">
          <div style="font-size:2rem;margin-bottom:12px;">⏳</div>
          <p>Načítavam galériu…</p>
        </div>`;
    }

    try {
      const resp = await fetch("/api/artworks");
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const data = await resp.json();
      if (Array.isArray(data) && data.length > 0) {
        _masterArtworksList = data;
        _usingCloudAPI = true;
      } else {
        throw new Error("Empty API response");
      }
    } catch (err) {
      console.warn("API load failed, falling back to artworksData:", err);
      _usingCloudAPI = false;
      // Fallback: use hardcoded artworks.js if API fails
      _masterArtworksList = (typeof artworksData !== "undefined" && Array.isArray(artworksData))
        ? artworksData : [];
    }

    // Render after data is ready
    updateAdminStats();
    applyFilter("all");
  }

  // 4. Render Gallery with Pagination & Delete Buttons
  function applyFilter(filter) {
    activeFilter = filter;
    const all = getArtworksList();

    currentFilteredList = all.filter(item => {
      if (filter === "all") return true;
      if (filter === "2024") return item.year === "2024";
      if (filter === "2023") return item.year === "2023";
      if (filter === "2022") return item.year === "2022";
      if (filter === "multi") return (item.photoCount || (item.detailImages && item.detailImages.length) || 1) >= 3;
      if (filter === "available") return (item.status || "").toLowerCase() === "available";
      return (item.technique || "").toLowerCase() === filter.toLowerCase();
    });

    galleryGrid.innerHTML = "";
    displayedCount = 0;

    // Update filter counts
    updateFilterCounts(all);

    if (currentFilteredList.length === 0) {
      galleryGrid.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 60px 0; color: var(--text-muted);">
          V tejto kategórii sa nenašli žiadne maľby.
        </div>
      `;
      if (loadMoreWrap) loadMoreWrap.style.display = "none";
      return;
    }

    renderNextBatch();
  }

  function updateFilterCounts(all) {
    const allBtn = document.querySelector('[data-filter="all"]');
    if (allBtn) allBtn.textContent = `Všetky maľby (${all.length})`;
  }

  function renderNextBatch() {
    const nextBatch = currentFilteredList.slice(displayedCount, displayedCount + PAGE_SIZE);

    nextBatch.forEach(art => {
      const card = document.createElement("div");
      card.className = "artwork-card";
      card.id = `card-${art.id}`;
      
      const badgeClass = (art.status || "").toLowerCase() === "available" ? "badge-available" : "badge-sold";
      const photoCount = art.photoCount || (art.detailImages ? art.detailImages.length : 1);
      const photoCountHtml = photoCount > 1 
        ? `<span class="card-photo-count">📷 ${photoCount} fotiek</span>` 
        : "";

      card.innerHTML = `
        <div class="card-image-wrap">
          <button class="card-delete-btn" title="Vymazať túto maľbu z webu" aria-label="Vymazať">✕</button>
          <button class="card-edit-btn" title="Upraviť maľbu (názov, popis, fotky...)" aria-label="Upraviť">✏️</button>
          <img src="${art.coverImage}" alt="${art.title}" loading="lazy">
          <span class="card-badge ${badgeClass}">${art.status || "Available"}</span>
          ${photoCountHtml}
        </div>
        <div class="card-details">
          <div class="card-meta">
            <span>${art.date || art.year}</span>
            <span>${art.technique || "Akryl"}</span>
          </div>
          <h3 class="card-title">${art.title}</h3>
          <p class="card-medium">${art.medium || "Akryl na plátne"}</p>
          <div class="card-footer">
            <span class="card-dimensions">${art.dimensions || "50 × 70 cm"}</span>
            <span class="card-action-text">Otvoriť galériu →</span>
          </div>
        </div>
      `;

      // Delete Button Handler
      const deleteBtn = card.querySelector(".card-delete-btn");
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation(); // Zabráni otvoreniu modalu
        handleDeleteArtwork(art, card);
      });

      // Edit Button Handler
      const editBtn = card.querySelector(".card-edit-btn");
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openEditModal(art);
      });

      card.addEventListener("click", () => openArtworkModal(art));
      galleryGrid.appendChild(card);
    });

    displayedCount += nextBatch.length;

    // Update Load More button visibility
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

  function handleDeleteArtwork(art, cardEl) {
    if (!confirm(`Naozaj chceš vymazať maľbu "${art.title}"?`)) return;

    cardEl.classList.add("deleting");

    setTimeout(async () => {
      cardEl.remove();

      if (_usingCloudAPI) {
        undoStack.push(JSON.parse(JSON.stringify(art)));
        if (_masterArtworksList) {
          _masterArtworksList = _masterArtworksList.filter(item => item.id !== art.id);
        }
        try {
          const resp = await fetch(`/api/artworks/${encodeURIComponent(art.id)}`, {
            method: "DELETE"
          });
          if (!resp.ok) throw new Error("HTTP " + resp.status);
        } catch (err) {
          console.warn("D1 delete failed:", err);
        }
      } else {
        deletedIds.add(art.id);
        undoStack.push(art.id);
        localStorage.setItem("platenko_deleted_ids", JSON.stringify([...deletedIds]));
      }

      // Update in-memory filtered list
      currentFilteredList = currentFilteredList.filter(item => item.id !== art.id);
      displayedCount = Math.max(0, displayedCount - 1);
      updateAdminStats();
      updateFilterCounts(getArtworksList());

      // Update load more text
      if (loadMoreWrap) {
        const remaining = currentFilteredList.length - displayedCount;
        if (remaining <= 0) {
          loadMoreWrap.style.display = "none";
        } else {
          loadMoreBtn.textContent = `Zobraziť ďalšie maľby (+${Math.min(remaining, PAGE_SIZE)} z ${remaining})`;
        }
      }
    }, 250);
  }

  if (loadMoreBtn) {
    loadMoreBtn.addEventListener("click", renderNextBatch);
  }

  // 5. Filter Navigation
  filterButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      filterButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      applyFilter(btn.dataset.filter);
    });
  });

  // 6. Modal Lightbox Display & Thumbnails
  function openArtworkModal(art) {
    const modalImage = document.getElementById("modalMainImage");
    const modalThumbs = document.getElementById("modalThumbs");
    const modalTitle = document.getElementById("modalTitle");
    const modalStatus = document.getElementById("modalStatus");
    const modalMedium = document.getElementById("modalMedium");
    const modalDimensions = document.getElementById("modalDimensions");
    const modalYear = document.getElementById("modalYear");
    const modalDesc = document.getElementById("modalDescription");
    const modalInquireBtn = document.getElementById("modalInquireBtn");

    modalTitle.textContent = art.title;
    modalMedium.textContent = art.medium || "Akryl na plátne";
    modalDimensions.textContent = art.dimensions || "50 × 70 cm";
    modalYear.textContent = art.date || art.year;
    modalDesc.textContent = art.description || `Séria fotografií originálnej maľby vytvorenej ${art.date}.`;

    modalStatus.textContent = art.status || "Available";
    modalStatus.className = `card-badge ${(art.status || "").toLowerCase() === 'available' ? 'badge-available' : 'badge-sold'}`;

    currentArtworkImages = (art.detailImages && art.detailImages.length > 0)
      ? art.detailImages
      : [art.coverImage];
    currentImageIndex = 0;

    renderModalImage();

    // Thumbnails
    modalThumbs.innerHTML = "";
    currentArtworkImages.forEach((imgUrl, index) => {
      const thumb = document.createElement("div");
      thumb.className = `modal-thumb ${index === 0 ? "active" : ""}`;
      thumb.innerHTML = `<img src="${imgUrl}" alt="${art.title} foto ${index + 1}">`;
      
      thumb.addEventListener("click", () => {
        currentImageIndex = index;
        renderModalImage();
      });

      modalThumbs.appendChild(thumb);
    });

    // Inquire Button Action
    modalInquireBtn.onclick = () => {
      alert(`Mám záujem o "${art.title}" (${art.dimensions})\n\nV ďalšej fáze projektu toto tlačidlo rovno odošle správu do tvojej schránky!`);
    };

    modalOverlay.classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function renderModalImage() {
    const modalImage = document.getElementById("modalMainImage");
    if (!modalImage || currentArtworkImages.length === 0) return;

    modalImage.src = currentArtworkImages[currentImageIndex];

    // Update active thumb
    document.querySelectorAll(".modal-thumb").forEach((t, idx) => {
      if (idx === currentImageIndex) {
        t.classList.add("active");
        t.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
      } else {
        t.classList.remove("active");
      }
    });

    // Show/hide navigation arrows based on count
    if (modalPrevBtn && modalNextBtn) {
      if (currentArtworkImages.length <= 1) {
        modalPrevBtn.style.display = "none";
        modalNextBtn.style.display = "none";
      } else {
        modalPrevBtn.style.display = "flex";
        modalNextBtn.style.display = "flex";
      }
    }
  }

  function nextModalImage() {
    if (currentArtworkImages.length <= 1) return;
    currentImageIndex = (currentImageIndex + 1) % currentArtworkImages.length;
    renderModalImage();
  }

  function prevModalImage() {
    if (currentArtworkImages.length <= 1) return;
    currentImageIndex = (currentImageIndex - 1 + currentArtworkImages.length) % currentArtworkImages.length;
    renderModalImage();
  }

  if (modalNextBtn) modalNextBtn.addEventListener("click", nextModalImage);
  if (modalPrevBtn) modalPrevBtn.addEventListener("click", prevModalImage);

  function closeModal() {
    modalOverlay.classList.remove("open");
    document.body.style.overflow = "";
  }

  modalCloseBtn.addEventListener("click", closeModal);
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  document.addEventListener("keydown", (e) => {
    if (!modalOverlay.classList.contains("open")) return;
    if (e.key === "Escape") {
      closeModal();
    } else if (e.key === "ArrowRight") {
      nextModalImage();
    } else if (e.key === "ArrowLeft") {
      prevModalImage();
    }
  });

  // ============================================================
  // EDIT MODAL LOGIC
  // ============================================================

  function openEditModal(art) {
    editingArtId = art.id;

    // Populate fields
    document.getElementById("editTitle").value = art.title || "";
    document.getElementById("editDescription").value = art.description || "";
    document.getElementById("editTechnique").value = art.technique || "Pouring";
    document.getElementById("editStatus").value = art.status || "Available";
    document.getElementById("editDimensions").value = art.dimensions || "";
    document.getElementById("editMedium").value = art.medium || "";
    document.getElementById("editModalFolderHint").textContent = `📁 ${art.folder || art.id}`;

    // Build photo list (detailImages or just coverImage)
    editPhotos = art.detailImages && art.detailImages.length > 0
      ? [...art.detailImages]
      : [art.coverImage];

    renderEditPhotoGrid();

    editModal.classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function renderEditPhotoGrid() {
    const grid = document.getElementById("editPhotoGrid");
    const countEl = document.getElementById("editPhotoCount");
    countEl.textContent = `(${editPhotos.length} fotiek)`;
    grid.innerHTML = "";

    editPhotos.forEach((url, index) => {
      const thumb = document.createElement("div");
      thumb.className = `edit-photo-thumb${index === 0 ? " cover-photo" : ""}`;
      thumb.title = index === 0 ? "Titulná fotka (cover)" : url.split("/").pop();
      thumb.innerHTML = `
        <img src="${url}" alt="Fotka ${index + 1}" loading="lazy">
        <button class="remove-photo-btn" title="Odstrániť z albumu">✕</button>
      `;

      // Set as cover on click
      thumb.querySelector("img").addEventListener("click", () => {
        if (index === 0) return; // already cover
        // Move to front
        editPhotos.splice(index, 1);
        editPhotos.unshift(url);
        renderEditPhotoGrid();
      });

      // Remove photo
      thumb.querySelector(".remove-photo-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        if (editPhotos.length <= 1) {
          alert("Musí zostať aspoň jedna fotka v albume.");
          return;
        }
        editPhotos.splice(index, 1);
        renderEditPhotoGrid();
      });

      grid.appendChild(thumb);
    });
  }

  function closeEditModal() {
    editModal.classList.remove("open");
    document.body.style.overflow = "";
    editingArtId = null;
    editPhotos = [];
  }

  async function saveEditModal() {
    if (!editingArtId) return;

    const targetId = editingArtId;
    const photosSnapshot = [...editPhotos];

    const updates = {
      title: document.getElementById("editTitle").value.trim(),
      description: document.getElementById("editDescription").value.trim(),
      technique: document.getElementById("editTechnique").value,
      status: document.getElementById("editStatus").value,
      dimensions: document.getElementById("editDimensions").value.trim(),
      medium: document.getElementById("editMedium").value.trim(),
      coverImage: photosSnapshot[0],
      detailImages: [...photosSnapshot],
      photoCount: photosSnapshot.length,
    };

    // Update in-memory master list immediately (optimistic UI)
    if (_masterArtworksList) {
      const idx = _masterArtworksList.findIndex(a => a.id === targetId);
      if (idx !== -1) {
        _masterArtworksList[idx] = Object.assign({}, _masterArtworksList[idx], updates);
      }
    }

    if (!_usingCloudAPI) {
      customEdits[targetId] = updates;
      localStorage.setItem("platenko_custom_edits", JSON.stringify(customEdits));
    }

    closeEditModal();
    applyFilter(activeFilter);

    // Persist to D1 + R2 via API
    if (_usingCloudAPI) {
      try {
        const resp = await fetch(`/api/artworks/${encodeURIComponent(targetId)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: updates.title,
            description: updates.description,
            technique: updates.technique,
            status: updates.status,
            dimensions: updates.dimensions,
            medium: updates.medium,
            coverImage: updates.coverImage,
            detailImages: updates.detailImages
          })
        });
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        const resData = await resp.json();
        if (resData && resData.coverImage && _masterArtworksList) {
          const idx = _masterArtworksList.findIndex(a => a.id === targetId);
          if (idx !== -1) {
            _masterArtworksList[idx] = Object.assign({}, _masterArtworksList[idx], {
              coverImage: resData.coverImage,
              detailImages: resData.detailImages || _masterArtworksList[idx].detailImages,
              photoCount: resData.photoCount ?? (resData.detailImages ? resData.detailImages.length : _masterArtworksList[idx].photoCount)
            });
            applyFilter(activeFilter);
          }
        }
        console.log("Saved to D1 OK:", targetId);
      } catch (err) {
        console.warn("D1 save failed:", err);
      }
    }

    // Flash confirm
    if (adminExportBtn) {
      const orig = adminExportBtn.innerHTML;
      adminExportBtn.innerHTML = _usingCloudAPI ? `✓ Uložené v cloude!` : `✓ Zmeny uložené!`;
      adminExportBtn.style.backgroundColor = "#16a34a";
      setTimeout(() => {
        adminExportBtn.innerHTML = orig;
        adminExportBtn.style.backgroundColor = "";
      }, 2000);
    }
  }

  if (editModalCloseBtn) editModalCloseBtn.addEventListener("click", closeEditModal);
  if (editModalCancelBtn) editModalCancelBtn.addEventListener("click", closeEditModal);
  if (editModalSaveBtn) editModalSaveBtn.addEventListener("click", saveEditModal);
  if (editModal) {
    editModal.addEventListener("click", (e) => { if (e.target === editModal) closeEditModal(); });
  }

  // ============================================================
  // 3D COVER MOCKUP STUDIO (Perspective Warp + Blur + Drop Shadow)
  // ============================================================
  const coverStudioModal = document.getElementById("coverStudioModal");
  const openCoverStudioBtn = document.getElementById("openCoverStudioBtn");
  const coverStudioCloseBtn = document.getElementById("coverStudioCloseBtn");
  const coverStudioCancelBtn = document.getElementById("coverStudioCancelBtn");
  const resetCornersBtn = document.getElementById("resetCornersBtn");
  const renderPreviewBtn = document.getElementById("renderPreviewBtn");
  const applyCoverBtn = document.getElementById("applyCoverBtn");

  const detectCornersBtn = document.getElementById("detectCornersBtn");
  const pinningCanvas = document.getElementById("pinningCanvas");
  const previewCanvas = document.getElementById("previewCanvas");

  let studioImg = new Image();
  // 4 corners with explicit labels and colors
  // 0: Hore-Vľavo (modrá), 1: Hore-Vpravo (zelená), 2: Dole-Vpravo (žltá), 3: Dole-Vľavo (červená)
  const CORNER_CONFIG = [
    { label: "1: Hore-Vľavo", color: "#3b82f6" },
    { label: "2: Hore-Vpravo", color: "#10b981" },
    { label: "3: Dole-Vpravo", color: "#f59e0b" },
    { label: "4: Dole-Vľavo", color: "#ef4444" }
  ];
  let corners = [];
  let activeCornerIdx = -1;
  let canvasScale = 1;

  const coverUploadInput = document.getElementById("coverUploadInput");

  if (openCoverStudioBtn) {
    openCoverStudioBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const targetSrc = (editPhotos && editPhotos.length > 0) 
        ? editPhotos[0] 
        : (currentArtworkImages && currentArtworkImages.length > 0 ? currentArtworkImages[0] : null);

      if (!targetSrc) {
        alert("Nenašla sa žiadna fotka na úpravu.");
        return;
      }

      // Ak už fotka je Data URL, otvor priamo
      if (targetSrc.startsWith("data:")) {
        loadStudioImage(targetSrc);
        return;
      }

      // Ak je otvorená cez file://, Chrome z bezpečnostných dôvodov znečistí plátno (Tainted Canvas),
      // preto používateľovi otvoríme bleskový výber súboru (alebo ak beží cez web, pokračujeme priamo)
      // Vyskúšame najprv rýchly Blob cez FileReader:
      convertPathToDataUrl(targetSrc, (cleanDataUrl) => {
        loadStudioImage(cleanDataUrl);
      }, () => {
        // Ak Chrome odmietne priamy prístup k súboru na file://, vyzve na vybratie fotky
        if (coverUploadInput) {
          coverUploadInput.onchange = (evt) => {
            const file = evt.target.files[0];
            if (file) {
              const reader = new FileReader();
              reader.onload = (re) => loadStudioImage(re.target.result);
              reader.readAsDataURL(file);
            }
          };
          coverUploadInput.click();
        }
      });
    });
  }

  function convertPathToDataUrl(path, onSuccess, onError) {
    // Vytvoríme offscreen canvas a pokúsime sa prečítať pixely
    const tempImg = new Image();
    tempImg.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = tempImg.naturalWidth;
        c.height = tempImg.naturalHeight;
        const cx = c.getContext("2d");
        cx.drawImage(tempImg, 0, 0);
        const res = c.toDataURL("image/jpeg", 0.95);
        onSuccess(res);
      } catch (err) {
        // Tainted!
        onError(err);
      }
    };
    tempImg.onerror = onError;
    tempImg.src = path;
  }

  function loadStudioImage(url) {
    studioImg = new Image();
    studioImg.onload = () => {
      setupPinningCanvas();
      coverStudioModal.classList.add("open");
      autoDetectCanvasEdges();
      generate3DPreview();
    };
    studioImg.onerror = (err) => {
      console.error("Chyba načítania obrázka:", err, url);
      alert("Nepodarilo sa načítať fotku: " + url);
    };
    studioImg.src = url;
  }

  function setupPinningCanvas() {
    // Fill canvas up to high resolution for clear details
    const maxDim = 800;
    const imgRatio = studioImg.width / studioImg.height;

    let w = maxDim;
    let h = w / imgRatio;
    if (imgRatio < 1) {
      h = maxDim;
      w = h * imgRatio;
    }

    pinningCanvas.width = Math.round(w);
    pinningCanvas.height = Math.round(h);
    canvasScale = pinningCanvas.width / studioImg.width;

    resetCornersToDefault();
    drawPinningCanvas();
  }

  function resetCornersToDefault() {
    const w = pinningCanvas.width;
    const h = pinningCanvas.height;
    const padX = w * 0.12;
    const padY = h * 0.12;
    corners = [
      { x: padX, y: padY },         // 0: TL
      { x: w - padX, y: padY },     // 1: TR
      { x: w - padX, y: h - padY }, // 2: BR
      { x: padX, y: h - padY }      // 3: BL
    ];
  }

  // Automatic Edge Detection using Luminance Contrast Gradient
  function autoDetectCanvasEdges() {
    try {
      const w = pinningCanvas.width;
      const h = pinningCanvas.height;
      const ctx = pinningCanvas.getContext("2d");
      ctx.drawImage(studioImg, 0, 0, w, h);
      const imgData = ctx.getImageData(0, 0, w, h);
      const data = imgData.data;

      // Greyscale matrix
      const gray = new Float32Array(w * h);
      for (let i = 0; i < data.length; i += 4) {
        gray[i / 4] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      }

      // Sample along 4 inward rays from borders towards center
      const cx = Math.floor(w / 2);
      const cy = Math.floor(h / 2);

      function findEdge(startX, startY, endX, endY) {
        const steps = 60;
        let maxGrad = 0;
        let bestPt = { x: startX, y: startY };
        let prevVal = gray[Math.floor(startY) * w + Math.floor(startX)];

        for (let i = 1; i < steps; i++) {
          const t = i / steps;
          const px = Math.round(startX + (endX - startX) * t);
          const py = Math.round(startY + (endY - startY) * t);
          const val = gray[py * w + px];
          const grad = Math.abs(val - prevVal);
          if (grad > maxGrad && grad > 18) {
            maxGrad = grad;
            bestPt = { x: px, y: py };
          }
          prevVal = val;
        }
        return bestPt;
      }

      // Ray search from each corner towards center
      const cornerTL = findEdge(w * 0.04, h * 0.04, cx, cy);
      const cornerTR = findEdge(w * 0.96, h * 0.04, cx, cy);
      const cornerBR = findEdge(w * 0.96, h * 0.96, cx, cy);
      const cornerBL = findEdge(w * 0.04, h * 0.96, cx, cy);

      if (maxGradFound(cornerTL, cornerTR, cornerBR, cornerBL, w, h)) {
        corners = [cornerTL, cornerTR, cornerBR, cornerBL];
      }
    } catch (e) {
      console.warn("Auto edge detection skipped:", e);
    }
    drawPinningCanvas();
  }

  function maxGradFound(c0, c1, c2, c3, w, h) {
    // Sanity check: corners must form a reasonable quadrilateral
    const area = Math.abs((c1.x - c0.x) * (c3.y - c0.y) - (c3.x - c0.x) * (c1.y - c0.y));
    return area > (w * h * 0.25);
  }

  function drawPinningCanvas() {
    const ctx = pinningCanvas.getContext("2d");
    ctx.clearRect(0, 0, pinningCanvas.width, pinningCanvas.height);

    // Draw background original image
    ctx.drawImage(studioImg, 0, 0, pinningCanvas.width, pinningCanvas.height);

    // Dim area outside painting
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.fillRect(0, 0, pinningCanvas.width, pinningCanvas.height);

    // Highlight area inside corners
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(studioImg, 0, 0, pinningCanvas.width, pinningCanvas.height);
    ctx.restore();

    // Draw boundary polygon
    ctx.strokeStyle = "#6366f1";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw 4 interactive corner handles with colors and clear labels
    corners.forEach((pt, idx) => {
      const cfg = CORNER_CONFIG[idx];
      const isCur = idx === activeCornerIdx;

      // Outer glow
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, isCur ? 16 : 12, 0, Math.PI * 2);
      ctx.fillStyle = isCur ? "rgba(236, 72, 153, 0.4)" : "rgba(99, 102, 241, 0.3)";
      ctx.fill();

      // Solid Handle
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, isCur ? 12 : 9, 0, Math.PI * 2);
      ctx.fillStyle = cfg.color;
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Corner number
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 10px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText((idx + 1).toString(), pt.x, pt.y);
    });
  }

  // Mouse & Touch Dragging for Corners
  function getCanvasPointer(e) {
    const rect = pinningCanvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) * (pinningCanvas.width / rect.width),
      y: (clientY - rect.top) * (pinningCanvas.height / rect.height)
    };
  }

  pinningCanvas.addEventListener("mousedown", (e) => {
    const p = getCanvasPointer(e);
    activeCornerIdx = corners.findIndex(pt => Math.hypot(pt.x - p.x, pt.y - p.y) <= 28);
  });

  window.addEventListener("mousemove", (e) => {
    if (activeCornerIdx === -1 || !coverStudioModal.classList.contains("open")) return;
    const p = getCanvasPointer(e);
    corners[activeCornerIdx].x = Math.max(0, Math.min(pinningCanvas.width, p.x));
    corners[activeCornerIdx].y = Math.max(0, Math.min(pinningCanvas.height, p.y));
    drawPinningCanvas();
    generate3DPreview(); // Real-time preview!
  });

  window.addEventListener("mouseup", () => {
    if (activeCornerIdx !== -1) {
      activeCornerIdx = -1;
      drawPinningCanvas();
      generate3DPreview();
    }
  });

  if (resetCornersBtn) {
    resetCornersBtn.addEventListener("click", () => {
      resetCornersToDefault();
      drawPinningCanvas();
      generate3DPreview();
    });
  }

  if (detectCornersBtn) {
    detectCornersBtn.addEventListener("click", () => {
      autoDetectCanvasEdges();
      generate3DPreview();
    });
  }

  // --- WARP & 3D MOCKUP GENERATION ---
  function generate3DPreview() {
    if (!studioImg.complete || studioImg.naturalWidth === 0) return;

    // 1. Calculate perspective-rectified dimensions
    const scale = 1 / canvasScale;
    const p = corners.map(c => ({ x: c.x * scale, y: c.y * scale }));

    const topW = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);
    const botW = Math.hypot(p[2].x - p[3].x, p[2].y - p[3].y);
    const leftH = Math.hypot(p[3].x - p[0].x, p[3].y - p[0].y);
    const rightH = Math.hypot(p[2].x - p[1].x, p[2].y - p[1].y);

    const targetW = Math.round(Math.max(topW, botW, 300));
    const targetH = Math.round(Math.max(leftH, rightH, 300));

    // Warp polygon using subdivided affine mesh (pure 2D Canvas)
    const warpedCanvas = document.createElement("canvas");
    warpedCanvas.width = targetW;
    warpedCanvas.height = targetH;
    const wCtx = warpedCanvas.getContext("2d");

    warpPerspectiveGrid(wCtx, studioImg, p, targetW, targetH);

    // 2. Compose 3D Floating Mockup (3:4 ratio)
    const outW = 800;
    const outH = 1060;
    previewCanvas.width = outW;
    previewCanvas.height = outH;
    const pCtx = previewCanvas.getContext("2d");

    // A. Background: Zoomed, blurred & brightened painting
    pCtx.save();
    const bgScale = Math.max(outW / warpedCanvas.width, outH / warpedCanvas.height) * 1.35;
    const bgW = warpedCanvas.width * bgScale;
    const bgH = warpedCanvas.height * bgScale;

    // Fast canvas blur fallback
    if ("filter" in pCtx) {
      pCtx.filter = "blur(35px) brightness(1.2) saturate(1.15)";
      pCtx.drawImage(warpedCanvas, (outW - bgW) / 2, (outH - bgH) / 2, bgW, bgH);
    } else {
      pCtx.drawImage(warpedCanvas, (outW - bgW) / 2, (outH - bgH) / 2, bgW, bgH);
    }
    pCtx.restore();

    // Subtle soft white gradient overlay
    const grad = pCtx.createRadialGradient(outW / 2, outH / 2, 80, outW / 2, outH / 2, outW * 0.8);
    grad.addColorStop(0, "rgba(255, 255, 255, 0.22)");
    grad.addColorStop(1, "rgba(255, 255, 255, 0.45)");
    pCtx.fillStyle = grad;
    pCtx.fillRect(0, 0, outW, outH);

    // B. Floating Canvas with Realistic Drop Shadow
    const maxArtW = outW * 0.74;
    const maxArtH = outH * 0.76;
    const artRatio = targetW / targetH;

    let artW = maxArtW;
    let artH = artW / artRatio;
    if (artH > maxArtH) {
      artH = maxArtH;
      artW = artH * artRatio;
    }

    const artX = (outW - artW) / 2;
    const artY = (outH - artH) / 2;

    pCtx.save();
    // Multi-layered soft drop shadow
    pCtx.shadowColor = "rgba(0, 0, 0, 0.45)";
    pCtx.shadowBlur = 35;
    pCtx.shadowOffsetX = 0;
    pCtx.shadowOffsetY = 16;
    pCtx.drawImage(warpedCanvas, artX, artY, artW, artH);

    // Extra tight shadow for depth
    pCtx.shadowColor = "rgba(0, 0, 0, 0.25)";
    pCtx.shadowBlur = 8;
    pCtx.shadowOffsetY = 4;
    pCtx.drawImage(warpedCanvas, artX, artY, artW, artH);
    pCtx.restore();

    // Crisp white border
    pCtx.strokeStyle = "rgba(255, 255, 255, 0.45)";
    pCtx.lineWidth = 1.5;
    pCtx.strokeRect(artX, artY, artW, artH);
  }

  // Bilinear subdivision perspective warp (rock-solid & seamless)
  function warpPerspectiveGrid(ctx, img, p, w, h) {
    const GRID_SIZE = 12; // 12x12 grid for high fidelity

    function interp(c0, c1, c2, c3, u, v) {
      return {
        x: (1 - u) * (1 - v) * c0.x + u * (1 - v) * c1.x + u * v * c2.x + (1 - u) * v * c3.x,
        y: (1 - u) * (1 - v) * c0.y + u * (1 - v) * c1.y + u * v * c2.y + (1 - u) * v * c3.y
      };
    }

    for (let gy = 0; gy < GRID_SIZE; gy++) {
      for (let gx = 0; gx < GRID_SIZE; gx++) {
        const u0 = gx / GRID_SIZE;
        const u1 = (gx + 1) / GRID_SIZE;
        const v0 = gy / GRID_SIZE;
        const v1 = (gy + 1) / GRID_SIZE;

        const s00 = interp(p[0], p[1], p[2], p[3], u0, v0);
        const s10 = interp(p[0], p[1], p[2], p[3], u1, v0);
        const s11 = interp(p[0], p[1], p[2], p[3], u1, v1);
        const s01 = interp(p[0], p[1], p[2], p[3], u0, v1);

        const d00 = { x: u0 * w, y: v0 * h };
        const d10 = { x: u1 * w, y: v0 * h };
        const d11 = { x: u1 * w, y: v1 * h };
        const d01 = { x: u0 * w, y: v1 * h };

        // Triangle 1: (00, 10, 01)
        drawTriangleWarp(ctx, img, s00, s10, s01, d00, d10, d01);
        // Triangle 2: (10, 11, 01)
        drawTriangleWarp(ctx, img, s10, s11, s01, d10, d11, d01);
      }
    }
  }

  // Exact Affine Texture Mapping from Source Triangle (s0,s1,s2) to Dest Triangle (d0,d1,d2)
  function drawTriangleWarp(ctx, img, s0, s1, s2, d0, d1, d2) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(d0.x, d0.y);
    ctx.lineTo(d1.x, d1.y);
    ctx.lineTo(d2.x, d2.y);
    ctx.closePath();
    ctx.clip();

    // Map source image space (s) -> destination canvas space (d)
    // We want matrix M such that M * [s.x, s.y, 1]^T = [d.x, d.y, 1]^T
    const denom = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
    if (Math.abs(denom) < 1e-5) {
      ctx.restore();
      return;
    }

    const a = (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / denom;
    const b = (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / denom;
    const c = (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / denom;
    const d = (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / denom;
    const e = (d0.x * (s1.x * s2.y - s2.x * s1.y) + d1.x * (s2.x * s0.y - s0.x * s2.y) + d2.x * (s0.x * s1.y - s1.x * s0.y)) / denom;
    const f = (d0.y * (s1.x * s2.y - s2.x * s1.y) + d1.y * (s2.x * s0.y - s0.x * s2.y) + d2.y * (s0.x * s1.y - s1.x * s0.y)) / denom;

    ctx.transform(a, b, c, d, e, f);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }

  // Close & Cancel Studio
  function closeCoverStudio() {
    coverStudioModal.classList.remove("open");
  }

  if (coverStudioCloseBtn) coverStudioCloseBtn.addEventListener("click", closeCoverStudio);
  if (coverStudioCancelBtn) coverStudioCancelBtn.addEventListener("click", closeCoverStudio);

  // Apply Generated 3D Mockup
  if (applyCoverBtn) {
    applyCoverBtn.addEventListener("click", () => {
      function processExport(dataUrl) {
        // 1. Zaradiť novú fotku na začiatok albumu ako Cover
        editPhotos.unshift(dataUrl);
        renderEditPhotoGrid();
        closeCoverStudio();

        // 2. Automaticky uložiť album
        saveEditModal();
      }

      try {
        const dataUrl = previewCanvas.toDataURL("image/jpeg", 0.95);
        processExport(dataUrl);
      } catch (err) {
        try {
          previewCanvas.toBlob((blob) => {
            if (blob) {
              const reader = new FileReader();
              reader.onloadend = () => processExport(reader.result);
              reader.readAsDataURL(blob);
            }
          }, "image/jpeg", 0.95);
        } catch (blobErr) {
          console.error("Export error:", blobErr);
          alert("Chyba exportu: " + blobErr.message);
        }
      }
    });
  }
  if (editModal) {
    editModal.addEventListener("click", (e) => { if (e.target === editModal) closeEditModal(); });
  }

  // ============================================================

  // Initial load — fetch from API first
  loadArtworksFromAPI();
});
