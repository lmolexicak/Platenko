/**
 * Platenko Art Portfolio - Full-Screen 3-Tab Detail Modal
 * Tab 1: Deep Zoom + Raking Light ("Bočné nasvietenie" WebGL shader / 2D fallback)
 * Tab 2: True-Scale "In-Situ" Wall & Sofa Simulator
 * Tab 3: Curatorial Info & Inquiry
 */
(function () {
  "use strict";

  const INSTAGRAM_FALLBACK = "https://www.instagram.com/platenko.akryl";

  let currentArt = null;
  let helpers = {
    toThumbUrl: (u) => u,
    normalizeStatus: (s) => ({ key: "available", label: s || "Dostupné", badgeClass: "badge-available" }),
  };

  let activeTab = "detail";
  let images = [];
  let imageIdx = 0;

  // Deep zoom & pan state
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panOriginX = 0;
  let panOriginY = 0;
  let activePointers = new Map();
  let pinchStartDist = 0;
  let pinchStartZoom = 1;

  // Raking light WebGL state
  let rakingActive = false;
  let lightU = 0.25;
  let lightV = 0.25;
  let gl = null;
  let glProgram = null;
  let glTexture = null;
  let glHasTexture = false;
  let glLoc = {};
  let rakingRAF = null;

  // Resize observer for In-Situ & Raking Light
  let resizeObserver = null;

  // DOM Cache
  const el = {};
  function cacheDom() {
    if (el.overlay) return;
    el.overlay = document.getElementById("artworkModal");
    el.closeBtn = document.getElementById("modalCloseBtn");
    el.title = document.getElementById("modalTitle");
    el.meta = document.getElementById("modalHeaderMeta");
    el.status = document.getElementById("modalStatus");
    el.editCmsLink = document.getElementById("modalEditCmsLink");
    el.arBtn = document.getElementById("modalArBtn");
    el.shareBtn = document.getElementById("modalShareBtn");
    el.insituArBtn = document.getElementById("insituArLaunchBtn");
    el.tabBtns = Array.from(document.querySelectorAll(".detail-tab-btn"));
    el.tabPanels = Array.from(document.querySelectorAll(".detail-tab-panel"));

    // Tab 1
    el.detailStage = document.getElementById("detailStage");
    el.transformLayer = document.getElementById("detailTransformLayer");
    el.mainImage = document.getElementById("modalMainImage");
    el.rakingCanvas = document.getElementById("rakingCanvas");
    el.prevBtn = document.getElementById("modalPrevBtn");
    el.nextBtn = document.getElementById("modalNextBtn");
    el.thumbs = document.getElementById("modalThumbs");
    el.zoomOutBtn = document.getElementById("zoomOutBtn");
    el.zoomResetBtn = document.getElementById("zoomResetBtn");
    el.zoomInBtn = document.getElementById("zoomInBtn");
    el.rakingToggleBtn = document.getElementById("rakingToggleBtn");
    el.rakingControlsWrap = document.getElementById("rakingControlsWrap");
    el.rakingStrength = document.getElementById("rakingStrength");
    el.rakingHint = document.getElementById("rakingHint");

    // Tab 2
    el.insituStage = document.getElementById("insituStage");
    el.insituWall = document.getElementById("insituWall");
    el.insituPaintingWrap = document.getElementById("insituPaintingWrap");
    el.insituPaintingImg = document.getElementById("insituPaintingImg");
    el.insituPaintingDepth = document.getElementById("insituPaintingDepth");
    el.insituDimTag = document.getElementById("insituDimTag");
    el.insituSofaWrap = document.getElementById("insituSofaWrap");
    el.insituSofaLabel = document.getElementById("insituSofaLabel");
    el.insituSofaRange = document.getElementById("insituSofaRange");
    el.insituSofaNumber = document.getElementById("insituSofaNumber");
    el.insituCeilingNumber = document.getElementById("insituCeilingNumber");
    el.insituScaleReadout = document.getElementById("insituScaleReadout");
    el.wallSwatches = Array.from(document.querySelectorAll(".wall-swatch"));

    // Tab 3
    el.infoThumb = document.getElementById("infoTabThumb");
    el.infoDesc = document.getElementById("modalDescription");
    el.infoDims = document.getElementById("modalDimensions");
    el.infoMedium = document.getElementById("modalMedium");
    el.infoTechnique = document.getElementById("modalTechnique");
    el.infoYear = document.getElementById("modalYear");
    el.infoInstaWrap = document.getElementById("modalInstaWrap");
    el.infoInstaLink = document.getElementById("modalInstaLink");
    el.inquiryName = document.getElementById("inquiryName");
    el.inquiryContact = document.getElementById("inquiryContact");
    el.inquiryMessage = document.getElementById("inquiryMessage");
    el.inquiryFeedback = document.getElementById("inquiryFeedback");
    el.inquiryMailtoBtn = document.getElementById("modalInquireBtn");
    el.inquiryCopyBtn = document.getElementById("modalCopyInquiryBtn");
  }

  // ---- Helpers ----
  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function parseDimensionsCm(art) {
    let w = Number(art.widthCm);
    let h = Number(art.heightCm);
    const d = Number(art.depthCm) > 0 ? Number(art.depthCm) : 4;
    if (!(w > 0 && h > 0) && typeof art.dimensions === "string") {
      const nums = art.dimensions.match(/\d+(?:[.,]\d+)?/g);
      if (nums && nums.length >= 2) {
        w = parseFloat(nums[0].replace(",", "."));
        h = parseFloat(nums[1].replace(",", "."));
      }
    }
    if (!(w > 0 && h > 0)) {
      w = 50;
      h = 70;
    }
    return { w, h, d };
  }

  // ---- Tab Switching ----
  function switchTab(tabName) {
    activeTab = tabName;
    el.tabBtns.forEach((b) => {
      const isAct = b.dataset.tab === tabName;
      b.classList.toggle("active", isAct);
      b.setAttribute("aria-selected", isAct ? "true" : "false");
    });
    el.tabPanels.forEach((p) => {
      p.classList.toggle("active", p.dataset.panel === tabName);
    });

    if (tabName === "detail") {
      if (rakingActive) syncAndRenderRakingLight();
    } else if (tabName === "insitu") {
      requestAnimationFrame(renderInSitu);
    }
  }

  // ---- Deep Zoom & Pan ----
  function clampPan() {
    if (!el.detailStage || !el.mainImage || zoom <= 1) {
      panX = 0;
      panY = 0;
      return;
    }
    const imgRect = el.mainImage.getBoundingClientRect();
    const unzoomedW = imgRect.width / zoom;
    const unzoomedH = imgRect.height / zoom;
    const stageRect = el.detailStage.getBoundingClientRect();

    const maxPanX = Math.max(0, (unzoomedW * zoom - stageRect.width * 0.85) / 2);
    const maxPanY = Math.max(0, (unzoomedH * zoom - stageRect.height * 0.85) / 2);
    panX = clamp(panX, -maxPanX, maxPanX);
    panY = clamp(panY, -maxPanY, maxPanY);
  }

  function applyTransform() {
    if (!el.transformLayer) return;
    clampPan();
    el.transformLayer.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    if (el.zoomResetBtn) {
      el.zoomResetBtn.textContent = `${Math.round(zoom * 100)}%`;
    }
    if (el.detailStage) {
      el.detailStage.classList.toggle("is-zoomed", zoom > 1.01);
    }
  }

  function setZoom(nextZoom) {
    zoom = clamp(nextZoom, 1, 4.5);
    if (zoom <= 1.02) {
      zoom = 1;
      panX = 0;
      panY = 0;
    }
    applyTransform();
  }

  function resetZoom() {
    setZoom(1);
  }

  // ---- Raking Light (WebGL Sobel Relief Shader + 2D Canvas Fallback) ----
  const VERT_SRC = `
    attribute vec2 a_pos;
    varying vec2 v_uv;
    void main() {
      v_uv = vec2((a_pos.x + 1.0) * 0.5, 1.0 - (a_pos.y + 1.0) * 0.5);
      gl_Position = vec4(a_pos, 0.0, 1.0);
    }
  `;

  const FRAG_SRC = `
    precision mediump float;
    uniform sampler2D u_image;
    uniform vec2 u_texelSize;
    uniform vec2 u_lightPos;
    uniform float u_relief;
    varying vec2 v_uv;

    float lum(vec3 c) {
      return dot(c, vec3(0.299, 0.587, 0.114));
    }

    void main() {
      vec3 base = texture2D(u_image, v_uv).rgb;
      float l = lum(texture2D(u_image, v_uv - vec2(u_texelSize.x, 0.0)).rgb);
      float r = lum(texture2D(u_image, v_uv + vec2(u_texelSize.x, 0.0)).rgb);
      float t = lum(texture2D(u_image, v_uv - vec2(0.0, u_texelSize.y)).rgb);
      float b = lum(texture2D(u_image, v_uv + vec2(0.0, u_texelSize.y)).rgb);

      vec3 normal = normalize(vec3((l - r) * u_relief * 2.4, (t - b) * u_relief * 2.4, 1.0));
      vec3 lightPos3 = vec3(u_lightPos, 0.22);
      vec3 fragPos3 = vec3(v_uv, 0.0);
      vec3 lightDir = normalize(lightPos3 - fragPos3);

      float dist = distance(v_uv, u_lightPos);
      float spot = smoothstep(0.95, 0.08, dist);

      float diff = max(dot(normal, lightDir), 0.0);
      vec3 viewDir = vec3(0.0, 0.0, 1.0);
      vec3 halfDir = normalize(lightDir + viewDir);
      float spec = pow(max(dot(normal, halfDir), 0.0), 28.0) * (0.28 * u_relief);

      vec3 warmTint = vec3(1.04, 1.00, 0.94);
      vec3 lit = base * (0.48 + 0.72 * spot * diff * warmTint) + vec3(spec * spot) * warmTint;
      gl_FragColor = vec4(clamp(lit, 0.0, 1.0), 1.0);
    }
  `;

  function initWebGL(canvas) {
    if (gl && glProgram) return true;
    const ctx = canvas.getContext("webgl", { premultipliedAlpha: false, antialias: true })
      || canvas.getContext("experimental-webgl");
    if (!ctx) return false;

    const compile = (type, src) => {
      const s = ctx.createShader(type);
      ctx.shaderSource(s, src);
      ctx.compileShader(s);
      if (!ctx.getShaderParameter(s, ctx.COMPILE_STATUS)) {
        ctx.deleteShader(s);
        return null;
      }
      return s;
    };

    const vs = compile(ctx.VERTEX_SHADER, VERT_SRC);
    const fs = compile(ctx.FRAGMENT_SHADER, FRAG_SRC);
    if (!vs || !fs) return false;

    const prog = ctx.createProgram();
    ctx.attachShader(prog, vs);
    ctx.attachShader(prog, fs);
    ctx.linkProgram(prog);
    if (!ctx.getProgramParameter(prog, ctx.LINK_STATUS)) {
      return false;
    }

    const buf = ctx.createBuffer();
    ctx.bindBuffer(ctx.ARRAY_BUFFER, buf);
    ctx.bufferData(
      ctx.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      ctx.STATIC_DRAW
    );

    const aPos = ctx.getAttribLocation(prog, "a_pos");
    ctx.enableVertexAttribArray(aPos);
    ctx.vertexAttribPointer(aPos, 2, ctx.FLOAT, false, 0, 0);

    gl = ctx;
    glProgram = prog;
    glLoc = {
      image: ctx.getUniformLocation(prog, "u_image"),
      texelSize: ctx.getUniformLocation(prog, "u_texelSize"),
      lightPos: ctx.getUniformLocation(prog, "u_lightPos"),
      relief: ctx.getUniformLocation(prog, "u_relief"),
    };
    return true;
  }

  function uploadGlTexture() {
    if (!gl || !el.mainImage || !el.mainImage.complete || el.mainImage.naturalWidth === 0) {
      return false;
    }
    try {
      if (glTexture) {
        gl.deleteTexture(glTexture);
        glTexture = null;
      }
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el.mainImage);
      glTexture = tex;
      glHasTexture = true;
      return true;
    } catch {
      glHasTexture = false;
      return false;
    }
  }

  function renderRaking2DFallback(canvas, w, h, relief) {
    const ctx = canvas.getContext("2d");
    if (!ctx || !el.mainImage.complete || el.mainImage.naturalWidth === 0) return;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(el.mainImage, 0, 0, w, h);
    const lx = lightU * w;
    const ly = lightV * h;
    const radius = Math.max(w, h) * 0.72;
    const grad = ctx.createRadialGradient(lx, ly, radius * 0.05, lx, ly, radius);
    const strength = clamp(0.18 * relief, 0.1, 0.45);
    grad.addColorStop(0, `rgba(255, 248, 232, ${strength})`);
    grad.addColorStop(0.55, "rgba(0, 0, 0, 0.12)");
    grad.addColorStop(1, "rgba(0, 0, 0, 0.55)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  function renderRakingFrame() {
    rakingRAF = null;
    if (!rakingActive || !el.rakingCanvas || !el.mainImage || !el.mainImage.complete) return;

    const natW = el.mainImage.naturalWidth;
    const natH = el.mainImage.naturalHeight;
    if (!natW || !natH) return;

    const dispW = el.mainImage.clientWidth || natW;
    const dispH = el.mainImage.clientHeight || natH;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetW = Math.max(2, Math.round(dispW * dpr));
    const targetH = Math.max(2, Math.round(dispH * dpr));

    if (el.rakingCanvas.width !== targetW || el.rakingCanvas.height !== targetH) {
      el.rakingCanvas.width = targetW;
      el.rakingCanvas.height = targetH;
    }

    const relief = parseFloat(el.rakingStrength ? el.rakingStrength.value : "1.6") || 1.6;

    if (initWebGL(el.rakingCanvas) && (glHasTexture || uploadGlTexture())) {
      gl.viewport(0, 0, targetW, targetH);
      gl.useProgram(glProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, glTexture);
      gl.uniform1i(glLoc.image, 0);
      gl.uniform2f(glLoc.texelSize, 1 / Math.max(200, targetW), 1 / Math.max(200, targetH));
      gl.uniform2f(glLoc.lightPos, lightU, lightV);
      gl.uniform1f(glLoc.relief, relief);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    } else {
      renderRaking2DFallback(el.rakingCanvas, targetW, targetH, relief);
    }
  }

  function scheduleRakingFrame() {
    if (!rakingActive || rakingRAF !== null) return;
    rakingRAF = requestAnimationFrame(renderRakingFrame);
  }

  function syncAndRenderRakingLight() {
    if (!rakingActive) return;
    glHasTexture = false;
    scheduleRakingFrame();
  }

  function setRakingActive(enable) {
    rakingActive = Boolean(enable);
    if (el.rakingToggleBtn) {
      el.rakingToggleBtn.classList.toggle("active", rakingActive);
      el.rakingToggleBtn.setAttribute("aria-pressed", rakingActive ? "true" : "false");
    }
    if (el.rakingControlsWrap) {
      el.rakingControlsWrap.style.display = rakingActive ? "flex" : "none";
    }
    if (el.rakingCanvas) {
      el.rakingCanvas.style.display = rakingActive ? "block" : "none";
    }
    if (el.rakingHint) {
      el.rakingHint.style.display = rakingActive ? "block" : "none";
    }
    if (rakingActive) {
      syncAndRenderRakingLight();
    } else if (gl && glTexture) {
      gl.deleteTexture(glTexture);
      glTexture = null;
      glHasTexture = false;
    }
  }

  // ---- Tab 1 Gallery Navigation ----
  function renderMainImage() {
    if (!el.mainImage || images.length === 0) return;
    resetZoom();
    glHasTexture = false;

    const src = images[imageIdx];
    el.mainImage.crossOrigin = "anonymous";
    el.mainImage.src = src;

    if (el.thumbs) {
      el.thumbs.querySelectorAll(".modal-thumb").forEach((t, idx) => {
        const isAct = idx === imageIdx;
        t.classList.toggle("active", isAct);
        if (isAct) {
          t.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
        }
      });
    }

    if (el.prevBtn && el.nextBtn) {
      const showNav = images.length > 1;
      el.prevBtn.style.display = showNav ? "flex" : "none";
      el.nextBtn.style.display = showNav ? "flex" : "none";
    }
  }

  function nextImage() {
    if (images.length <= 1) return;
    imageIdx = (imageIdx + 1) % images.length;
    renderMainImage();
  }

  function prevImage() {
    if (images.length <= 1) return;
    imageIdx = (imageIdx - 1 + images.length) % images.length;
    renderMainImage();
  }

  // ---- Tab 2: In-Situ True-Scale Simulator ----
  function renderInSitu() {
    if (!currentArt || !el.insituStage || !el.insituPaintingWrap || !el.insituSofaWrap) return;
    const rect = el.insituStage.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) return;

    let { w, h, d } = parseDimensionsCm(currentArt);

    // Prevent stretching when stored default (50×70 portrait) wraps a landscape photo
    const imgEl = el.insituPaintingImg;
    if (imgEl && imgEl.naturalWidth > 0 && imgEl.naturalHeight > 0) {
      const photoLandscape = imgEl.naturalWidth > imgEl.naturalHeight * 1.05;
      const photoPortrait = imgEl.naturalHeight > imgEl.naturalWidth * 1.05;
      if ((photoLandscape && w < h) || (photoPortrait && w > h)) {
        [w, h] = [h, w];
      }
    }

    const sofaW = clamp(parseFloat(el.insituSofaNumber.value) || 220, 140, 350);
    const ceilH = clamp(parseFloat(el.insituCeilingNumber.value) || 260, 220, 350);
    const sofaH = 80; // Modern low-profile sofa height in cm
    const floorPx = 28;

    const wallWidthCm = Math.max(sofaW * 1.85, w + 120, 340);
    const availW = Math.max(120, rect.width - 28);
    const availH = Math.max(120, rect.height - floorPx - 14);
    const pxPerCm = Math.min(availW / wallWidthCm, availH / ceilH);

    const paintPxW = Math.max(18, Math.round(w * pxPerCm));
    const paintPxH = Math.max(18, Math.round(h * pxPerCm));
    const depthPx = clamp(Math.round(d * pxPerCm), 3, 14);
    const sofaPxW = Math.max(60, Math.round(sofaW * pxPerCm));
    const sofaPxH = Math.max(30, Math.round(sofaH * pxPerCm));

    // Eye-level center at 145 cm above floor, ensuring clearance above sofa & below ceiling
    const idealBottomCm = 145 - h / 2;
    const minBottomCm = sofaH + 14;
    const maxBottomCm = Math.max(minBottomCm, ceilH - h - 10);
    const bottomCm = clamp(idealBottomCm, minBottomCm, maxBottomCm);

    el.insituPaintingWrap.style.width = `${paintPxW}px`;
    el.insituPaintingWrap.style.height = `${paintPxH}px`;
    el.insituPaintingWrap.style.bottom = `${Math.round(floorPx + bottomCm * pxPerCm)}px`;

    if (el.insituPaintingDepth) {
      el.insituPaintingDepth.style.width = `${depthPx}px`;
      el.insituPaintingDepth.style.right = `-${depthPx}px`;
    }
    if (el.insituDimTag) {
      el.insituDimTag.textContent = `${w} × ${h} cm`;
    }

    el.insituSofaWrap.style.width = `${sofaPxW}px`;
    el.insituSofaWrap.style.height = `${sofaPxH}px`;
    el.insituSofaWrap.style.bottom = `${floorPx}px`;

    if (el.insituSofaLabel) {
      el.insituSofaLabel.textContent = `Pohovka ${sofaW} cm`;
    }
    if (el.insituScaleReadout) {
      el.insituScaleReadout.textContent = `Obraz ${w} × ${h} × ${d} cm · Stred ${Math.round(bottomCm + h / 2)} cm nad podlahou · Mierka ${pxPerCm.toFixed(2)} px/cm`;
    }
  }

  function setWallTheme(wallKey) {
    if (!el.insituWall) return;
    el.insituWall.dataset.wall = wallKey;
    el.wallSwatches.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.wall === wallKey);
    });
  }

  // ---- Tab 3: Inquiry Builder ----
  function buildInquiryBody() {
    if (!currentArt) return "";
    const dims = parseDimensionsCm(currentArt);
    const userMsg = el.inquiryMessage ? el.inquiryMessage.value.trim() : "";
    const senderName = el.inquiryName ? el.inquiryName.value.trim() : "";
    const senderContact = el.inquiryContact ? el.inquiryContact.value.trim() : "";

    let full = userMsg || `Dobrý deň, mám záujem o dielo "${currentArt.title}" (${dims.w} × ${dims.h} cm, ID: ${currentArt.id}).`;
    if (senderName || senderContact) {
      full += `\n\nKontakt:\n${senderName ? "Meno: " + senderName + "\n" : ""}${senderContact ? "Kontakt: " + senderContact : ""}`;
    }
    return full;
  }

  // ---- Public Open / Close ----
  function open(art, opts) {
    cacheDom();
    if (!el.overlay || !art) return;

    currentArt = art;
    if (opts) helpers = Object.assign({}, helpers, opts);

    const dims = parseDimensionsCm(art);
    const statusInfo = helpers.normalizeStatus(art.status);

    // Header
    if (el.title) el.title.textContent = art.title || "Bez názvu";
    if (el.meta) el.meta.textContent = `${dims.w} × ${dims.h} × ${dims.d} cm · ${art.medium || "Akryl na plátne"}`;
    if (el.status) {
      el.status.textContent = statusInfo.label;
      el.status.className = `status-pill ${statusInfo.badgeClass}`;
    }
    if (el.editCmsLink) {
      if (helpers.isAuthenticated) {
        el.editCmsLink.href = `/admin?edit=${encodeURIComponent(art.id)}`;
        el.editCmsLink.style.display = "inline-flex";
      } else {
        el.editCmsLink.style.display = "none";
      }
    }

    // Images (full-res main, ?size=thumb strip)
    images = (art.detailImages && art.detailImages.length > 0)
      ? [...art.detailImages]
      : [art.coverImage];
    imageIdx = 0;

    if (el.thumbs) {
      el.thumbs.innerHTML = "";
      images.forEach((imgUrl, idx) => {
        const t = document.createElement("div");
        t.className = `modal-thumb ${idx === 0 ? "active" : ""}`;
        t.innerHTML = `<img src="${helpers.toThumbUrl(imgUrl)}" alt="${art.title} foto ${idx + 1}" loading="lazy" decoding="async">`;
        t.addEventListener("click", () => {
          imageIdx = idx;
          renderMainImage();
        });
        el.thumbs.appendChild(t);
      });
    }

    setRakingActive(false);
    renderMainImage();

    // Tab 2 In-Situ image (prefer thumb/1280px URL for snappy preview, same-origin)
    if (el.insituPaintingImg) {
      el.insituPaintingImg.src = helpers.toThumbUrl(images[0]);
    }

    // Tab 3 Info & Inquiry
    if (el.infoThumb) el.infoThumb.src = helpers.toThumbUrl(images[0]);
    if (el.infoDesc) {
      el.infoDesc.textContent = art.description || `Originálna abstraktná akrylová maľba na napnutom plátne (${art.date || art.year || ""}).`;
    }
    if (el.infoDims) el.infoDims.textContent = `${dims.w} × ${dims.h} × ${dims.d} cm`;
    if (el.infoMedium) el.infoMedium.textContent = art.medium || "Akryl na plátne";
    if (el.infoTechnique) el.infoTechnique.textContent = art.technique || "Mixed";
    if (el.infoYear) el.infoYear.textContent = art.date || art.year || "—";

    const siteIg = (window.PlatenkoSiteSettings && window.PlatenkoSiteSettings.instagramUrl) || INSTAGRAM_FALLBACK;
    const instaUrl = (art.instagramUrl && art.instagramUrl.trim()) || siteIg;
    if (el.infoInstaLink) el.infoInstaLink.href = instaUrl;
    if (el.inquiryFeedback) el.inquiryFeedback.style.display = "none";

    if (el.inquiryMessage) {
      el.inquiryMessage.value = `Dobrý deň,\n\nmám záujem o dielo "${art.title}" (${dims.w} × ${dims.h} cm, ID: ${art.id}).\nProsím o informácie ohľadom dostupnosti a ceny.`;
    }

    switchTab("detail");
    el.overlay.classList.add("open");
    document.body.style.overflow = "hidden";
    if (helpers.onOpen) helpers.onOpen(art);
  }

  function close() {
    if (!el.overlay) return;
    el.overlay.classList.remove("open");
    if (!window.Platenko3DGallery || !window.Platenko3DGallery.isOpen()) {
      document.body.style.overflow = "";
    }
    setRakingActive(false);
    resetZoom();
    if (helpers.onClose) helpers.onClose();
  }

  function isOpen() {
    return Boolean(el.overlay && el.overlay.classList.contains("open"));
  }

  // ---- Bind Events Once ----
  let bindingsDone = false;
  function initBindings() {
    if (bindingsDone) return;
    bindingsDone = true;
    cacheDom();
    if (!el.overlay) return;

    if (el.closeBtn) el.closeBtn.addEventListener("click", close);
    el.overlay.addEventListener("click", (e) => {
      if (e.target === el.overlay) close();
    });

    if (el.shareBtn) {
      el.shareBtn.addEventListener("click", () => {
        if (currentArt && helpers.onShare) helpers.onShare(currentArt, el.shareBtn);
      });
    }
    if (el.arBtn) {
      el.arBtn.addEventListener("click", () => {
        if (currentArt && helpers.onOpenAR) helpers.onOpenAR(currentArt);
      });
    }
    if (el.insituArBtn) {
      el.insituArBtn.addEventListener("click", () => {
        if (currentArt && helpers.onOpenAR) helpers.onOpenAR(currentArt);
      });
    }

    // Tab buttons
    el.tabBtns.forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });

    // Navigation arrows
    if (el.nextBtn) el.nextBtn.addEventListener("click", nextImage);
    if (el.prevBtn) el.prevBtn.addEventListener("click", prevImage);

    // Zoom toolbar
    if (el.zoomInBtn) el.zoomInBtn.addEventListener("click", () => setZoom(zoom + 0.5));
    if (el.zoomOutBtn) el.zoomOutBtn.addEventListener("click", () => setZoom(zoom - 0.5));
    if (el.zoomResetBtn) el.zoomResetBtn.addEventListener("click", resetZoom);

    // Image load updates WebGL texture / In-Situ aspect orientation
    if (el.mainImage) {
      el.mainImage.addEventListener("load", () => {
        if (rakingActive) syncAndRenderRakingLight();
      });
    }
    if (el.insituPaintingImg) {
      el.insituPaintingImg.addEventListener("load", () => {
        if (activeTab === "insitu") renderInSitu();
      });
    }

    // Detail Stage wheel / double-click / pointer pan & light / touch pinch
    if (el.detailStage) {
      el.detailStage.addEventListener("wheel", (e) => {
        if (activeTab !== "detail") return;
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.35 : -0.35;
        setZoom(zoom + delta);
      }, { passive: false });

      el.detailStage.addEventListener("dblclick", (e) => {
        if (activeTab !== "detail") return;
        if (e.target.closest("button")) return;
        setZoom(zoom > 1.05 ? 1 : 2.5);
      });

      el.detailStage.addEventListener("pointerdown", (e) => {
        if (activeTab !== "detail" || e.target.closest("button")) return;
        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (activePointers.size === 2) {
          const pts = Array.from(activePointers.values());
          pinchStartDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
          pinchStartZoom = zoom;
          isPanning = false;
          return;
        }

        if (zoom > 1.01) {
          isPanning = true;
          panStartX = e.clientX;
          panStartY = e.clientY;
          panOriginX = panX;
          panOriginY = panY;
          try { el.detailStage.setPointerCapture(e.pointerId); } catch {}
        }
      });

      el.detailStage.addEventListener("pointermove", (e) => {
        if (activeTab !== "detail") return;
        if (activePointers.has(e.pointerId)) {
          activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        }

        // Pinch zoom with 2 fingers
        if (activePointers.size === 2 && pinchStartDist > 0) {
          const pts = Array.from(activePointers.values());
          const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
          setZoom(pinchStartZoom * (dist / pinchStartDist));
          return;
        }

        // Pan when zoomed
        if (isPanning && zoom > 1.01) {
          panX = panOriginX + (e.clientX - panStartX);
          panY = panOriginY + (e.clientY - panStartY);
          applyTransform();
        }

        // Move raking spotlight
        if (rakingActive && el.mainImage) {
          const rect = el.mainImage.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            lightU = clamp((e.clientX - rect.left) / rect.width, 0, 1);
            lightV = clamp((e.clientY - rect.top) / rect.height, 0, 1);
            scheduleRakingFrame();
          }
        }
      });

      const endPointer = (e) => {
        activePointers.delete(e.pointerId);
        if (activePointers.size < 2) pinchStartDist = 0;
        isPanning = false;
      };
      el.detailStage.addEventListener("pointerup", endPointer);
      el.detailStage.addEventListener("pointercancel", endPointer);
    }

    // Raking light toggle & strength slider
    if (el.rakingToggleBtn) {
      el.rakingToggleBtn.addEventListener("click", () => setRakingActive(!rakingActive));
    }
    if (el.rakingStrength) {
      el.rakingStrength.addEventListener("input", scheduleRakingFrame);
    }

    // In-Situ controls
    if (el.insituSofaRange && el.insituSofaNumber) {
      el.insituSofaRange.addEventListener("input", () => {
        el.insituSofaNumber.value = el.insituSofaRange.value;
        renderInSitu();
      });
      el.insituSofaNumber.addEventListener("input", () => {
        const v = clamp(parseFloat(el.insituSofaNumber.value) || 220, 140, 350);
        el.insituSofaRange.value = v;
        renderInSitu();
      });
    }
    if (el.insituCeilingNumber) {
      el.insituCeilingNumber.addEventListener("input", renderInSitu);
    }
    el.wallSwatches.forEach((btn) => {
      btn.addEventListener("click", () => setWallTheme(btn.dataset.wall));
    });

    if (typeof ResizeObserver !== "undefined" && el.insituStage) {
      resizeObserver = new ResizeObserver(() => {
        if (activeTab === "insitu" && isOpen()) renderInSitu();
        if (activeTab === "detail" && rakingActive && isOpen()) scheduleRakingFrame();
      });
      resizeObserver.observe(el.insituStage);
      if (el.detailStage) resizeObserver.observe(el.detailStage);
    }

    // Tab 3 direct D1 inquiry submission
    if (el.inquiryMailtoBtn) {
      el.inquiryMailtoBtn.addEventListener("click", async () => {
        if (!currentArt) return;
        const senderName = el.inquiryName ? el.inquiryName.value.trim() : "";
        const senderContact = el.inquiryContact ? el.inquiryContact.value.trim() : "";
        const message = el.inquiryMessage ? el.inquiryMessage.value.trim() : "";

        const showInquiryFeedback = (text, isErr) => {
          if (!el.inquiryFeedback) return;
          el.inquiryFeedback.textContent = text;
          el.inquiryFeedback.className = `inquiry-feedback ${isErr ? "error" : "success"}`;
          el.inquiryFeedback.style.display = "block";
        };

        if (!senderName) {
          showInquiryFeedback("Zadaj prosím svoje meno.", true);
          if (el.inquiryName) el.inquiryName.focus();
          return;
        }
        if (!senderContact) {
          showInquiryFeedback("Zadaj prosím svoj e-mail alebo telefón.", true);
          if (el.inquiryContact) el.inquiryContact.focus();
          return;
        }
        if (message.length < 5) {
          showInquiryFeedback("Správa musí mať aspoň 5 znakov.", true);
          if (el.inquiryMessage) el.inquiryMessage.focus();
          return;
        }

        const btn = el.inquiryMailtoBtn;
        const origText = btn.textContent;
        btn.disabled = true;
        btn.textContent = "⏳ Odosielam…";
        if (el.inquiryFeedback) el.inquiryFeedback.style.display = "none";

        try {
          const resp = await fetch("/api/inquiry", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              artworkId: currentArt.id,
              artworkTitle: currentArt.title || "",
              senderName,
              senderContact,
              message,
            }),
          });
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok || !data.success) {
            throw new Error(data.error || ("HTTP " + resp.status));
          }
          if (el.inquiryName) el.inquiryName.value = "";
          if (el.inquiryContact) el.inquiryContact.value = "";
          showInquiryFeedback("✓ Ďakujeme! Dopyt bol odoslaný a uložený — čoskoro sa vám ozveme.", false);
        } catch (err) {
          showInquiryFeedback("Nepodarilo sa odoslať dopyt: " + (err.message || "chyba siete"), true);
        } finally {
          btn.disabled = false;
          btn.textContent = origText;
        }
      });
    }
    if (el.inquiryCopyBtn) {
      el.inquiryCopyBtn.addEventListener("click", async () => {
        const text = buildInquiryBody();
        try {
          await navigator.clipboard.writeText(text);
          const orig = el.inquiryCopyBtn.textContent;
          el.inquiryCopyBtn.textContent = "✓ Skopírované!";
          setTimeout(() => { el.inquiryCopyBtn.textContent = orig; }, 2000);
        } catch {
          if (el.inquiryMessage) {
            el.inquiryMessage.select();
            document.execCommand("copy");
          }
        }
      });
    }

    // Keyboard shortcuts inside open detail modal
    document.addEventListener("keydown", (e) => {
      if (!isOpen()) return;
      if (e.key === "Escape") close();
      else if (activeTab === "detail" && e.key === "ArrowRight") nextImage();
      else if (activeTab === "detail" && e.key === "ArrowLeft") prevImage();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initBindings);
  } else {
    initBindings();
  }

  window.PlatenkoDetailModal = { open, close, isOpen };
})();
