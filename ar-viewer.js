/**
 * Platenko Art Portfolio - Mobile WebAR Wall Preview (True 1:1 Scale) & Desktop QR
 * Tier 1: Android Chrome WebXR immersive-ar (hit-test + 1:1 lock + ruler + diptych/triptych)
 * Tier 2: iOS Safari on-the-fly USDZExporter -> Apple AR Quick Look (#allowsContentScaling=0)
 * Tier 3: Universal Rear Camera Fallback + 1-Tap ISO Payment Card (8.56 x 5.40 cm) Calibration
 */
(function () {
  "use strict";

  const CARD_WIDTH_CM = 8.56;
  const CARD_HEIGHT_CM = 5.4;

  let allArtworks = [];
  let primaryArt = null;
  let hungItems = []; // [{ art, dims, xOffsetCm }]
  let spacingCm = 8;
  let rulerVisible = false;
  let callbacks = {};

  // Live AR mode state: "idle" | "webxr" | "fallback"
  let liveMode = "idle";
  let cameraStream = null;
  let fallbackPxPerCm = 24;
  let fallbackCalibrated = false;
  let fallbackPosX = 0;
  let fallbackPosY = -20;
  let fallbackTiltX = 0;
  let fallbackTiltY = 0;
  let fallbackDragging = false;
  let fallbackDragStart = { x: 0, y: 0, ox: 0, oy: 0 };

  // WebXR Three.js state
  let xrState = {
    THREE: null,
    renderer: null,
    scene: null,
    camera: null,
    session: null,
    refSpace: null,
    viewerSpace: null,
    hitTestSource: null,
    reticle: null,
    placedGroup: null,
    rulerGroup: null,
    placed: false,
    disposables: [],
    lastHitMatrix: null,
    dragActive: false,
    dragLastX: 0,
    dragLastY: 0,
  };

  let createdBlobUrls = [];
  const el = {};

  function cacheDom() {
    if (el.arModal) return;
    el.arModal = document.getElementById("arModal");
    el.arModalCloseBtn = document.getElementById("arModalCloseBtn");
    el.arArtThumb = document.getElementById("arArtThumb");
    el.arArtTitle = document.getElementById("arArtTitle");
    el.arArtDims = document.getElementById("arArtDims");
    el.arQrBox = document.getElementById("arQrBox");
    el.arQrCanvas = document.getElementById("arQrCanvas");
    el.arQrFallbackImg = document.getElementById("arQrFallbackImg");
    el.arLaunchWebXRBtn = document.getElementById("arLaunchWebXRBtn");
    el.arLaunchIOSBtn = document.getElementById("arLaunchIOSBtn");
    el.arLaunchFallbackBtn = document.getElementById("arLaunchFallbackBtn");
    el.arCopyLinkBtn = document.getElementById("arCopyLinkBtn");
    el.arStatusText = document.getElementById("arStatusText");

    el.arLiveOverlay = document.getElementById("arLiveOverlay");
    el.arCameraVideo = document.getElementById("arCameraVideo");
    el.arWebXRCanvasHost = document.getElementById("arWebXRCanvasHost");
    el.arFallbackStage = document.getElementById("arFallbackStage");
    el.arFallbackCluster = document.getElementById("arFallbackCluster");
    el.arScaleBadge = document.getElementById("arScaleBadge");
    el.arCalibBtn = document.getElementById("arCalibBtn");
    el.arRulerToggleBtn = document.getElementById("arRulerToggleBtn");
    el.arAddArtBtn = document.getElementById("arAddArtBtn");
    el.arLiveCloseBtn = document.getElementById("arLiveCloseBtn");
    el.arGuidanceText = document.getElementById("arGuidanceText");
    el.arTiltControls = document.getElementById("arTiltControls");
    el.arTiltX = document.getElementById("arTiltX");
    el.arTiltY = document.getElementById("arTiltY");

    el.arCardCalibOverlay = document.getElementById("arCardCalibOverlay");
    el.arCardGuide = document.getElementById("arCardGuide");
    el.arCardScaleRange = document.getElementById("arCardScaleRange");
    el.arCardConfirmBtn = document.getElementById("arCardConfirmBtn");

    el.arAddDrawer = document.getElementById("arAddDrawer");
    el.arAddDrawerCloseBtn = document.getElementById("arAddDrawerCloseBtn");
    el.arActiveStackList = document.getElementById("arActiveStackList");
    el.arAddArtGrid = document.getElementById("arAddArtGrid");
    el.spacingChips = Array.from(document.querySelectorAll(".ar-spacing-chip"));
  }

  function toThumbUrl(url) {
    if (!url || typeof url !== "string") return url;
    if (url.startsWith("data:") || url.startsWith("blob:")) return url;
    return url + (url.includes("?") ? "&" : "?") + "size=thumb";
  }

  function parseDimensionsCm(art, natW, natH) {
    let wCm = Number(art && art.widthCm);
    let hCm = Number(art && art.heightCm);
    const dCm = Number(art && art.depthCm) > 0 ? Number(art.depthCm) : 4;

    if (!(wCm > 0 && hCm > 0) && art && typeof art.dimensions === "string") {
      const nums = art.dimensions.match(/\d+(?:[.,]\d+)?/g);
      if (nums && nums.length >= 2) {
        wCm = parseFloat(nums[0].replace(",", "."));
        hCm = parseFloat(nums[1].replace(",", "."));
      }
    }
    if (!(wCm > 0 && hCm > 0)) {
      wCm = 50;
      hCm = 70;
    }

    if (natW > 0 && natH > 0) {
      const isLandscapePhoto = natW > natH * 1.05;
      const isPortraitPhoto = natH > natW * 1.05;
      if ((isLandscapePhoto && wCm < hCm) || (isPortraitPhoto && wCm > hCm)) {
        [wCm, hCm] = [hCm, wCm];
      }
    }

    return {
      wCm,
      hCm,
      dCm,
      wM: wCm / 100,
      hM: hCm / 100,
      dM: dCm / 100,
    };
  }

  function isMobileDevice() {
    const ua = navigator.userAgent || "";
    const touchCapable = (navigator.maxTouchPoints || 0) > 1;
    return /Android|iPhone|iPad|iPod|Mobi/i.test(ua) || (touchCapable && window.innerWidth <= 1024);
  }

  function isIOSDevice() {
    const ua = navigator.userAgent || "";
    return /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1);
  }

  function buildArUrl(art) {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    if (art && art.id) {
      url.searchParams.set("dielo", art.id);
      url.searchParams.set("ar", "1");
    }
    return url.toString();
  }

  function loadImageSafe(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = (err) => reject(err);
      img.src = src;
    });
  }

  // ---- QR Code Renderer ----
  async function renderQrCode(targetUrl) {
    if (!el.arQrCanvas || !el.arQrFallbackImg) return;
    el.arQrCanvas.style.display = "block";
    el.arQrFallbackImg.style.display = "none";

    const ctx = el.arQrCanvas.getContext("2d");
    const size = 220;
    el.arQrCanvas.width = size;
    el.arQrCanvas.height = size;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);

    try {
      const mod = await import("https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/+esm");
      const qrcodeFactory = mod.default || mod;
      const qr = qrcodeFactory(0, "M");
      qr.addData(targetUrl);
      qr.make();

      const count = qr.getModuleCount();
      const quiet = 14;
      const cell = (size - quiet * 2) / count;
      ctx.fillStyle = "#18181B";
      for (let r = 0; r < count; r++) {
        for (let c = 0; c < count; c++) {
          if (qr.isDark(r, c)) {
            ctx.fillRect(
              Math.floor(quiet + c * cell),
              Math.floor(quiet + r * cell),
              Math.ceil(cell),
              Math.ceil(cell)
            );
          }
        }
      }
    } catch (err) {
      console.warn("QR ESM fallback to QR image:", err);
      el.arQrCanvas.style.display = "none";
      el.arQrFallbackImg.style.display = "block";
      el.arQrFallbackImg.src =
        "https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data=" +
        encodeURIComponent(targetUrl);
    }
  }

  // ---- Stack / Diptych Layout Computation ----
  function computeClusterMetrics() {
    if (hungItems.length === 0) return { totalWidthCm: 0, maxHeightCm: 0, layouts: [] };
    let totalWidthCm = 0;
    let maxHeightCm = 0;
    hungItems.forEach((item, idx) => {
      totalWidthCm += item.dims.wCm;
      if (idx > 0) totalWidthCm += spacingCm;
      if (item.dims.hCm > maxHeightCm) maxHeightCm = item.dims.hCm;
    });

    let cursorX = -totalWidthCm / 2;
    const layouts = hungItems.map((item) => {
      const centerXCm = cursorX + item.dims.wCm / 2;
      cursorX += item.dims.wCm + spacingCm;
      return { item, centerXCm };
    });
    return { totalWidthCm, maxHeightCm, layouts };
  }

  function updateScaleBadge() {
    if (!el.arScaleBadge || !primaryArt) return;
    if (hungItems.length <= 1) {
      const d = (hungItems[0] && hungItems[0].dims) || parseDimensionsCm(primaryArt);
      el.arScaleBadge.textContent = `Mierka 1:1 uzamknutá (${d.wCm} × ${d.hCm} cm)`;
    } else {
      const { totalWidthCm, maxHeightCm } = computeClusterMetrics();
      el.arScaleBadge.textContent = `Mierka 1:1 uzamknutá (${hungItems.length} obrazy · spolu ${Math.round(totalWidthCm)} × ${Math.round(maxHeightCm)} cm)`;
    }
  }

  function addArtworkToStack(art) {
    if (!art) return;
    if (hungItems.length >= 3) {
      if (window.PlatenkoApp && window.PlatenkoApp.showToast) {
        window.PlatenkoApp.showToast("V zostave môžu byť najviac 3 obrazy naraz.");
      }
      return;
    }
    const item = { art, dims: parseDimensionsCm(art) };
    hungItems.push(item);

    // Refine aspect orientation once thumbnail loads
    loadImageSafe(toThumbUrl(art.coverImage)).then((img) => {
      item.dims = parseDimensionsCm(art, img.naturalWidth, img.naturalHeight);
      refreshActiveStackUI();
      if (liveMode === "webxr") rebuildWebXRGroup();
      if (liveMode === "fallback") renderFallbackCluster();
    }).catch(() => {});

    refreshActiveStackUI();
    if (liveMode === "webxr") rebuildWebXRGroup();
    if (liveMode === "fallback") renderFallbackCluster();
  }

  function removeArtworkFromStack(idx) {
    if (hungItems.length <= 1) return;
    hungItems.splice(idx, 1);
    refreshActiveStackUI();
    if (liveMode === "webxr") rebuildWebXRGroup();
    if (liveMode === "fallback") renderFallbackCluster();
  }

  function refreshActiveStackUI() {
    updateScaleBadge();
    if (!el.arActiveStackList) return;
    el.arActiveStackList.innerHTML = "";

    hungItems.forEach((entry, idx) => {
      const chip = document.createElement("div");
      chip.className = "ar-stack-chip";
      chip.innerHTML = `
        <img src="${toThumbUrl(entry.art.coverImage)}" alt="${entry.art.title}">
        <span>${entry.art.title} (${entry.dims.wCm}×${entry.dims.hCm} cm)</span>
        ${hungItems.length > 1 ? '<button type="button" title="Odobrať">✕</button>' : ""}
      `;
      const rmBtn = chip.querySelector("button");
      if (rmBtn) {
        rmBtn.addEventListener("click", () => removeArtworkFromStack(idx));
      }
      el.arActiveStackList.appendChild(chip);
    });
  }

  function populateAddDrawerGrid() {
    if (!el.arAddArtGrid) return;
    el.arAddArtGrid.innerHTML = "";
    const candidates = allArtworks
      .slice()
      .sort((a, b) => {
        const da = parseDimensionsCm(a);
        const db = parseDimensionsCm(b);
        return Math.max(da.wCm, da.hCm) - Math.max(db.wCm, db.hCm);
      })
      .slice(0, 36);

    candidates.forEach((art) => {
      const d = parseDimensionsCm(art);
      const card = document.createElement("button");
      card.type = "button";
      card.className = "ar-drawer-item";
      card.innerHTML = `
        <img src="${toThumbUrl(art.coverImage)}" alt="${art.title}" loading="lazy">
        <span class="ar-drawer-name">${art.title}</span>
        <span class="ar-drawer-size">${d.wCm} × ${d.hCm} cm</span>
      `;
      card.addEventListener("click", () => {
        addArtworkToStack(art);
      });
      el.arAddArtGrid.appendChild(card);
    });
  }

  // ---- Tier 1: Android Chrome Native WebXR immersive-ar ----
  function trackXR(obj) {
    xrState.disposables.push(obj);
    return obj;
  }

  function disposeXRResources() {
    xrState.disposables.forEach((res) => {
      if (res && typeof res.dispose === "function") {
        try { res.dispose(); } catch {}
      }
    });
    xrState.disposables = [];
  }

  function makeCanvasTextTexture(THREE, text, wPx, hPx, bg, fg) {
    const c = document.createElement("canvas");
    c.width = wPx;
    c.height = hPx;
    const ctx = c.getContext("2d");
    if (bg) {
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.roundRect(0, 0, wPx, hPx, 12);
      ctx.fill();
    }
    ctx.fillStyle = fg || "#ffffff";
    ctx.font = "600 28px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, wPx / 2, hPx / 2);
    const tex = trackXR(new THREE.CanvasTexture(c));
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function buildWebXRRuler(THREE, totalWidthCm, maxHeightCm) {
    const group = new THREE.Group();
    const wM = totalWidthCm / 100;
    const hM = maxHeightCm / 100;
    const lineMat = trackXR(new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 }));

    const topY = hM / 2 + 0.045;
    const rightX = wM / 2 + 0.045;

    const topPts = [
      new THREE.Vector3(-wM / 2, topY - 0.015, 0.01),
      new THREE.Vector3(-wM / 2, topY, 0.01),
      new THREE.Vector3(wM / 2, topY, 0.01),
      new THREE.Vector3(wM / 2, topY - 0.015, 0.01),
    ];
    const topGeo = trackXR(new THREE.BufferGeometry().setFromPoints(topPts));
    group.add(new THREE.Line(topGeo, lineMat));

    const sidePts = [
      new THREE.Vector3(rightX - 0.015, -hM / 2, 0.01),
      new THREE.Vector3(rightX, -hM / 2, 0.01),
      new THREE.Vector3(rightX, hM / 2, 0.01),
      new THREE.Vector3(rightX - 0.015, hM / 2, 0.01),
    ];
    const sideGeo = trackXR(new THREE.BufferGeometry().setFromPoints(sidePts));
    group.add(new THREE.Line(sideGeo, lineMat));

    const wTex = makeCanvasTextTexture(THREE, `${Math.round(totalWidthCm)} cm`, 220, 64, "rgba(24,24,27,0.85)", "#ffffff");
    const wSprite = new THREE.Sprite(trackXR(new THREE.SpriteMaterial({ map: wTex, transparent: true })));
    wSprite.position.set(0, topY + 0.045, 0.01);
    wSprite.scale.set(0.18, 0.052, 1);
    group.add(wSprite);

    const hTex = makeCanvasTextTexture(THREE, `${Math.round(maxHeightCm)} cm`, 220, 64, "rgba(24,24,27,0.85)", "#ffffff");
    const hSprite = new THREE.Sprite(trackXR(new THREE.SpriteMaterial({ map: hTex, transparent: true })));
    hSprite.position.set(rightX + 0.075, 0, 0.01);
    hSprite.scale.set(0.18, 0.052, 1);
    group.add(hSprite);

    group.visible = rulerVisible;
    return group;
  }

  async function rebuildWebXRGroup() {
    const THREE = xrState.THREE;
    if (!THREE || !xrState.placedGroup) return;

    while (xrState.placedGroup.children.length > 0) {
      xrState.placedGroup.remove(xrState.placedGroup.children[0]);
    }

    const { totalWidthCm, maxHeightCm, layouts } = computeClusterMetrics();
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");

    const sideMat = trackXR(new THREE.MeshStandardMaterial({ color: 0xf1efe8, roughness: 0.85 }));
    const shadowMat = trackXR(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18 }));

    for (const { item, centerXCm } of layouts) {
      const { wM, hM, dM } = item.dims;
      const tex = await new Promise((resolve) => {
        loader.load(
          toThumbUrl(item.art.coverImage),
          (t) => {
            t.colorSpace = THREE.SRGBColorSpace;
            resolve(trackXR(t));
          },
          undefined,
          () => resolve(null)
        );
      });

      const frontMat = tex
        ? trackXR(new THREE.MeshBasicMaterial({ map: tex }))
        : trackXR(new THREE.MeshStandardMaterial({ color: 0xe4e4e0 }));

      const boxGeo = trackXR(new THREE.BoxGeometry(wM, hM, dM));
      const mesh = new THREE.Mesh(boxGeo, [sideMat, sideMat, sideMat, sideMat, frontMat, sideMat]);
      mesh.position.set(centerXCm / 100, 0, dM / 2);
      xrState.placedGroup.add(mesh);

      const shGeo = trackXR(new THREE.PlaneGeometry(wM + 0.03, hM + 0.03));
      const shMesh = new THREE.Mesh(shGeo, shadowMat);
      shMesh.position.set(centerXCm / 100 + 0.008, -0.01, 0.002);
      xrState.placedGroup.add(shMesh);
    }

    xrState.rulerGroup = buildWebXRRuler(THREE, totalWidthCm, maxHeightCm);
    xrState.placedGroup.add(xrState.rulerGroup);
  }

  async function startWebXRSession() {
    try {
      const THREE = await import("three");
      xrState.THREE = THREE;

      liveMode = "webxr";
      xrState.placed = false;
      xrState.lastHitMatrix = null;

      el.arModal.classList.remove("open");
      el.arLiveOverlay.hidden = false;
      el.arFallbackStage.hidden = true;
      el.arCameraVideo.style.display = "none";
      if (el.arCalibBtn) el.arCalibBtn.style.display = "none";
      if (el.arTiltControls) el.arTiltControls.style.display = "none";
      if (el.arGuidanceText) {
        el.arGuidanceText.textContent = "Namierte telefón na zvislú stenu. Keď sa zobrazí biely rámik 1:1, ťuknutím obraz zaveste.";
      }
      refreshActiveStackUI();

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.xr.enabled = true;

      el.arWebXRCanvasHost.innerHTML = "";
      el.arWebXRCanvasHost.appendChild(renderer.domElement);
      xrState.renderer = renderer;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.05, 20);
      scene.add(trackXR(new THREE.HemisphereLight(0xfffdf8, 0xd8d5cc, 1.4)));
      xrState.scene = scene;
      xrState.camera = camera;

      // Reticle scaled to primary painting 1:1 physical meters
      const d = hungItems[0].dims;
      const retGeo = trackXR(new THREE.EdgesGeometry(new THREE.PlaneGeometry(d.wM, d.hM)));
      const retMat = trackXR(new THREE.LineBasicMaterial({ color: 0xffffff }));
      const reticle = new THREE.LineSegments(retGeo, retMat);
      reticle.matrixAutoUpdate = false;
      reticle.visible = false;
      scene.add(reticle);
      xrState.reticle = reticle;

      const placedGroup = new THREE.Group();
      placedGroup.visible = false;
      scene.add(placedGroup);
      xrState.placedGroup = placedGroup;
      await rebuildWebXRGroup();

      const session = await navigator.xr.requestSession("immersive-ar", {
        requiredFeatures: ["hit-test"],
        optionalFeatures: ["dom-overlay"],
        domOverlay: { root: el.arLiveOverlay },
      });
      xrState.session = session;
      renderer.xr.setReferenceSpaceType("local");
      await renderer.xr.setSession(session);

      xrState.refSpace = await session.requestReferenceSpace("local");
      xrState.viewerSpace = await session.requestReferenceSpace("viewer");
      xrState.hitTestSource = await session.requestHitTestSource({ space: xrState.viewerSpace });

      const mat4 = new THREE.Matrix4();
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      const hitNormal = new THREE.Vector3();

      const onSelect = () => {
        if (!xrState.reticle.visible) return;
        xrState.placedGroup.position.setFromMatrixPosition(xrState.reticle.matrix);
        xrState.placedGroup.quaternion.setFromRotationMatrix(xrState.reticle.matrix);
        xrState.placedGroup.visible = true;
        xrState.placed = true;
        if (el.arGuidanceText) {
          el.arGuidanceText.textContent = "Potiahnutím prsta posuňte obraz po stene · Mierka 1:1 uzamknutá";
        }
      };
      session.addEventListener("select", onSelect);
      session.addEventListener("end", () => {
        if (liveMode === "webxr") closeLiveOverlay();
      });

      renderer.setAnimationLoop((timestamp, frame) => {
        if (frame && xrState.hitTestSource && xrState.refSpace) {
          const hits = frame.getHitTestResults(xrState.hitTestSource);
          if (hits.length > 0 && !xrState.placed) {
            const pose = hits[0].getPose(xrState.refSpace);
            if (pose) {
              mat4.fromArray(pose.transform.matrix);
              mat4.decompose(pos, quat, scale);
              // Hit surface normal (+Y in hit-test pose space) -> prefer vertical walls (|normal.y| < 0.5)
              hitNormal.set(0, 1, 0).applyQuaternion(quat).normalize();
              if (Math.abs(hitNormal.y) < 0.55) {
                // Orient painting outward along wall normal with +Y upright
                const up = new THREE.Vector3(0, 1, 0);
                const right = new THREE.Vector3().crossVectors(up, hitNormal).normalize();
                const orthoUp = new THREE.Vector3().crossVectors(hitNormal, right).normalize();
                const wallBasis = new THREE.Matrix4().makeBasis(right, orthoUp, hitNormal);
                wallBasis.setPosition(pos);
                xrState.reticle.matrix.copy(wallBasis);
                xrState.reticle.visible = true;
              } else {
                xrState.reticle.visible = false;
              }
            }
          } else {
            xrState.reticle.visible = false;
          }
        }
        renderer.render(scene, camera);
      });
    } catch (err) {
      console.warn("WebXR launch failed, offering Tier 3 fallback:", err);
      closeLiveOverlay();
      if (el.arStatusText) {
        el.arStatusText.textContent = "WebXR AR sa nepodarilo spustiť na tomto zariadení — spúšťam kamerový náhľad s kalibráciou kartou.";
      }
      startFallbackCameraAR();
    }
  }

  // ---- Tier 2: iOS Safari On-the-Fly USDZExporter ----
  async function launchIOSQuickLook() {
    try {
      if (el.arStatusText) el.arStatusText.textContent = "Generujem skutočný 3D model 1:1 pre Apple AR Quick Look…";
      const [THREE, exporterMod] = await Promise.all([
        import("three"),
        import("three/addons/exporters/USDZExporter.js"),
      ]);
      const USDZExporter = exporterMod.USDZExporter;
      const exporter = new USDZExporter();

      const group = new THREE.Group();
      const disposables = [];
      const { layouts } = computeClusterMetrics();
      const sideMat = new THREE.MeshStandardMaterial({ color: 0xf1efe8, roughness: 0.85 });
      disposables.push(sideMat);

      for (const { item, centerXCm } of layouts) {
        let dims = item.dims;
        let frontMat;
        try {
          const img = await loadImageSafe(toThumbUrl(item.art.coverImage));
          dims = parseDimensionsCm(item.art, img.naturalWidth, img.naturalHeight);
          const maxTex = 1024;
          const sc = Math.min(1, maxTex / Math.max(img.naturalWidth, img.naturalHeight));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(2, Math.round(img.naturalWidth * sc));
          canvas.height = Math.max(2, Math.round(img.naturalHeight * sc));
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);

          const tex = new THREE.CanvasTexture(canvas);
          tex.colorSpace = THREE.SRGBColorSpace;
          frontMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.65 });
          disposables.push(tex, frontMat);
        } catch {
          frontMat = new THREE.MeshStandardMaterial({ color: 0xd4d4ce, roughness: 0.75 });
          disposables.push(frontMat);
        }

        const geo = new THREE.BoxGeometry(dims.wM, dims.hM, dims.dM);
        disposables.push(geo);
        const mesh = new THREE.Mesh(geo, [sideMat, sideMat, sideMat, sideMat, frontMat, sideMat]);
        mesh.position.set(centerXCm / 100, 0, 0);
        group.add(mesh);
      }

      const arrayBuffer = await exporter.parseAsync(group);
      disposables.forEach((d) => {
        if (d && typeof d.dispose === "function") try { d.dispose(); } catch {}
      });

      const blob = new Blob([arrayBuffer], { type: "model/vnd.usdz+zip" });
      const blobUrl = URL.createObjectURL(blob);
      createdBlobUrls.push(blobUrl);

      const anchor = document.createElement("a");
      anchor.setAttribute("rel", "ar");
      anchor.setAttribute("href", `${blobUrl}#allowsContentScaling=0`);
      const dummyImg = document.createElement("img");
      dummyImg.alt = primaryArt.title || "AR";
      anchor.appendChild(dummyImg);
      document.body.appendChild(anchor);
      anchor.click();
      setTimeout(() => anchor.remove(), 1200);

      if (el.arStatusText) {
        el.arStatusText.textContent = "Apple AR Quick Look otvorený v mierke 1:1 (zmena veľkosti je uzamknutá).";
      }
    } catch (err) {
      console.warn("USDZ Quick Look failed, falling back to camera mode:", err);
      if (el.arStatusText) {
        el.arStatusText.textContent = "Nepodarilo sa spustiť Apple AR Quick Look — otváram kamerový náhľad.";
      }
      startFallbackCameraAR();
    }
  }

  // ---- Tier 3: Universal Rear Camera Fallback + Payment Card Calibration ----
  function renderFallbackCluster() {
    if (!el.arFallbackCluster) return;
    el.arFallbackCluster.innerHTML = "";
    const { totalWidthCm, maxHeightCm, layouts } = computeClusterMetrics();
    const px = fallbackPxPerCm;

    el.arFallbackCluster.style.transform =
      `translate(calc(-50% + ${fallbackPosX}px), calc(-50% + ${fallbackPosY}px)) ` +
      `perspective(1100px) rotateY(${fallbackTiltX}deg) rotateX(${fallbackTiltY}deg)`;

    const row = document.createElement("div");
    row.className = "ar-fallback-row";
    row.style.gap = `${Math.round(spacingCm * px)}px`;

    layouts.forEach(({ item }) => {
      const wPx = Math.max(36, Math.round(item.dims.wCm * px));
      const hPx = Math.max(36, Math.round(item.dims.hCm * px));
      const dPx = Math.max(3, Math.min(18, Math.round(item.dims.dCm * px)));

      const frame = document.createElement("div");
      frame.className = "ar-fallback-canvas";
      frame.style.width = `${wPx}px`;
      frame.style.height = `${hPx}px`;

      const img = document.createElement("img");
      img.src = toThumbUrl(item.art.coverImage);
      img.alt = item.art.title;
      img.draggable = false;
      frame.appendChild(img);

      const depthEdge = document.createElement("div");
      depthEdge.className = "ar-fallback-depth";
      depthEdge.style.width = `${dPx}px`;
      depthEdge.style.right = `-${dPx}px`;
      frame.appendChild(depthEdge);

      row.appendChild(frame);
    });

    el.arFallbackCluster.appendChild(row);

    if (rulerVisible) {
      const rulerTop = document.createElement("div");
      rulerTop.className = "ar-ruler-top";
      rulerTop.textContent = `${Math.round(totalWidthCm)} cm`;
      el.arFallbackCluster.appendChild(rulerTop);

      const rulerSide = document.createElement("div");
      rulerSide.className = "ar-ruler-side";
      rulerSide.innerHTML = `<span>${Math.round(maxHeightCm)} cm</span>`;
      el.arFallbackCluster.appendChild(rulerSide);
    }

    updateScaleBadge();
  }

  async function startFallbackCameraAR() {
    liveMode = "fallback";
    el.arModal.classList.remove("open");
    el.arLiveOverlay.hidden = false;
    el.arFallbackStage.hidden = false;
    el.arWebXRCanvasHost.innerHTML = "";
    if (el.arCalibBtn) el.arCalibBtn.style.display = "inline-flex";
    if (el.arTiltControls) el.arTiltControls.style.display = "flex";

    fallbackPosX = 0;
    fallbackPosY = -20;
    fallbackTiltX = 0;
    fallbackTiltY = 0;
    if (el.arTiltX) el.arTiltX.value = "0";
    if (el.arTiltY) el.arTiltY.value = "0";

    // Default reasonable px/cm before card calibration
    const baseDims = hungItems[0].dims;
    fallbackPxPerCm = Math.max(2.5, Math.min(window.innerWidth * 0.56 / baseDims.wCm, window.innerHeight * 0.48 / baseDims.hCm));
    fallbackCalibrated = false;

    if (el.arGuidanceText) {
      el.arGuidanceText.textContent = "Potiahnite obraz po stene · Pre presnú mierku 1:1 použite Kalibrovať kartou.";
    }

    el.arCameraVideo.style.display = "block";
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        el.arCameraVideo.srcObject = cameraStream;
      } catch {
        el.arCameraVideo.style.display = "none";
        if (el.arGuidanceText) {
          el.arGuidanceText.textContent = "Kamera nedostupná — zobrazený neutrálny náhľad steny. Obraz môžete posúvať aj kalibrovať.";
        }
      }
    } else {
      el.arCameraVideo.style.display = "none";
    }

    refreshActiveStackUI();
    renderFallbackCluster();
  }

  function updateCardGuideSize() {
    if (!el.arCardGuide || !el.arCardScaleRange) return;
    const widthPx = parseFloat(el.arCardScaleRange.value) || 210;
    const heightPx = Math.round(widthPx * (CARD_HEIGHT_CM / CARD_WIDTH_CM));
    el.arCardGuide.style.width = `${widthPx}px`;
    el.arCardGuide.style.height = `${heightPx}px`;
  }

  function closeLiveOverlay() {
    liveMode = "idle";
    if (cameraStream) {
      cameraStream.getTracks().forEach((t) => t.stop());
      cameraStream = null;
    }
    if (el.arCameraVideo) {
      el.arCameraVideo.srcObject = null;
      el.arCameraVideo.style.display = "none";
    }
    if (xrState.session) {
      const sess = xrState.session;
      xrState.session = null;
      try { sess.end(); } catch {}
    }
    if (xrState.renderer) {
      try {
        xrState.renderer.setAnimationLoop(null);
        xrState.renderer.dispose();
      } catch {}
      xrState.renderer = null;
    }
    disposeXRResources();
    if (el.arWebXRCanvasHost) el.arWebXRCanvasHost.innerHTML = "";
    if (el.arFallbackStage) el.arFallbackStage.hidden = true;
    if (el.arCardCalibOverlay) el.arCardCalibOverlay.hidden = true;
    if (el.arAddDrawer) el.arAddDrawer.hidden = true;
    if (el.arLiveOverlay) el.arLiveOverlay.hidden = true;
    if (!window.Platenko3DGallery || !window.Platenko3DGallery.isOpen()) {
      document.body.style.overflow = "";
    }
    if (callbacks.onClose) callbacks.onClose();
  }

  // ---- Public API ----
  async function open(art, artworksList, opts) {
    cacheDom();
    if (!art || !el.arModal) return;

    allArtworks = Array.isArray(artworksList) ? artworksList : [];
    primaryArt = art;
    callbacks = opts || {};
    rulerVisible = false;
    spacingCm = 8;

    const firstItem = { art, dims: parseDimensionsCm(art) };
    hungItems = [firstItem];

    // Refine aspect ratio cleanly from actual image dimensions
    loadImageSafe(toThumbUrl(art.coverImage)).then((img) => {
      firstItem.dims = parseDimensionsCm(art, img.naturalWidth, img.naturalHeight);
      if (el.arArtDims) {
        el.arArtDims.textContent = `${firstItem.dims.wCm} × ${firstItem.dims.hCm} × ${firstItem.dims.dCm} cm · 1:1`;
      }
      updateScaleBadge();
    }).catch(() => {});

    if (el.arArtThumb) el.arArtThumb.src = toThumbUrl(art.coverImage);
    if (el.arArtTitle) el.arArtTitle.textContent = art.title || "Bez názvu";
    if (el.arArtDims) {
      el.arArtDims.textContent = `${firstItem.dims.wCm} × ${firstItem.dims.hCm} × ${firstItem.dims.dCm} cm · 1:1`;
    }
    if (el.arStatusText) el.arStatusText.textContent = "";

    const arUrl = buildArUrl(art);
    renderQrCode(arUrl);
    populateAddDrawerGrid();

    if (el.arRulerToggleBtn) el.arRulerToggleBtn.setAttribute("aria-pressed", "false");
    el.spacingChips.forEach((c) => c.classList.toggle("active", c.dataset.spacing === "8"));

    // Detect device capabilities
    const mobile = isMobileDevice();
    const ios = isIOSDevice();
    let webxrSupported = false;
    if (navigator.xr && typeof navigator.xr.isSessionSupported === "function") {
      try {
        webxrSupported = await navigator.xr.isSessionSupported("immersive-ar");
      } catch {
        webxrSupported = false;
      }
    }

    if (el.arQrBox) el.arQrBox.style.display = mobile ? "none" : "flex";
    if (el.arLaunchWebXRBtn) el.arLaunchWebXRBtn.style.display = webxrSupported ? "flex" : "none";
    if (el.arLaunchIOSBtn) el.arLaunchIOSBtn.style.display = !webxrSupported && ios ? "flex" : "none";
    if (el.arLaunchFallbackBtn) {
      el.arLaunchFallbackBtn.className = (!webxrSupported && !ios && mobile)
        ? "btn-primary ar-launch-btn"
        : "btn-secondary ar-launch-btn";
    }

    el.arModal.classList.add("open");
    document.body.style.overflow = "hidden";
    if (callbacks.onOpen) callbacks.onOpen(art);
  }

  function close() {
    if (liveMode !== "idle") {
      closeLiveOverlay();
      return;
    }
    if (el.arModal && el.arModal.classList.contains("open")) {
      el.arModal.classList.remove("open");
      if (!window.Platenko3DGallery || !window.Platenko3DGallery.isOpen()) {
        document.body.style.overflow = "";
      }
      if (callbacks.onClose) callbacks.onClose();
    }
  }

  function isOpen() {
    return Boolean(
      (el.arModal && el.arModal.classList.contains("open")) ||
      (el.arLiveOverlay && !el.arLiveOverlay.hidden)
    );
  }

  // ---- Event Wiring ----
  let bindingsDone = false;
  function initBindings() {
    if (bindingsDone) return;
    bindingsDone = true;
    cacheDom();
    if (!el.arModal) return;

    if (el.arModalCloseBtn) el.arModalCloseBtn.addEventListener("click", close);
    el.arModal.addEventListener("click", (e) => {
      if (e.target === el.arModal) close();
    });

    if (el.arCopyLinkBtn) {
      el.arCopyLinkBtn.addEventListener("click", async () => {
        const url = buildArUrl(primaryArt);
        try {
          await navigator.clipboard.writeText(url);
        } catch {}
        const orig = el.arCopyLinkBtn.textContent;
        el.arCopyLinkBtn.textContent = "✓ Odkaz skopírovaný";
        if (window.PlatenkoApp && window.PlatenkoApp.showToast) {
          window.PlatenkoApp.showToast("Odkaz skopírovaný");
        }
        setTimeout(() => { el.arCopyLinkBtn.textContent = orig; }, 2200);
      });
    }

    if (el.arLaunchWebXRBtn) el.arLaunchWebXRBtn.addEventListener("click", startWebXRSession);
    if (el.arLaunchIOSBtn) el.arLaunchIOSBtn.addEventListener("click", launchIOSQuickLook);
    if (el.arLaunchFallbackBtn) el.arLaunchFallbackBtn.addEventListener("click", startFallbackCameraAR);
    if (el.arLiveCloseBtn) el.arLiveCloseBtn.addEventListener("click", closeLiveOverlay);

    // Edge ruler toggle
    if (el.arRulerToggleBtn) {
      el.arRulerToggleBtn.addEventListener("click", () => {
        rulerVisible = !rulerVisible;
        el.arRulerToggleBtn.setAttribute("aria-pressed", rulerVisible ? "true" : "false");
        el.arRulerToggleBtn.classList.toggle("active", rulerVisible);
        if (liveMode === "webxr" && xrState.rulerGroup) {
          xrState.rulerGroup.visible = rulerVisible;
        } else if (liveMode === "fallback") {
          renderFallbackCluster();
        }
      });
    }

    // Add 2-3 paintings drawer
    if (el.arAddArtBtn && el.arAddDrawer) {
      el.arAddArtBtn.addEventListener("click", () => {
        el.arAddDrawer.hidden = !el.arAddDrawer.hidden;
        if (!el.arAddDrawer.hidden) refreshActiveStackUI();
      });
    }
    if (el.arAddDrawerCloseBtn && el.arAddDrawer) {
      el.arAddDrawerCloseBtn.addEventListener("click", () => {
        el.arAddDrawer.hidden = true;
      });
    }
    el.spacingChips.forEach((chip) => {
      chip.addEventListener("click", () => {
        spacingCm = parseInt(chip.dataset.spacing, 10) || 8;
        el.spacingChips.forEach((c) => c.classList.toggle("active", c === chip));
        if (liveMode === "webxr") rebuildWebXRGroup();
        if (liveMode === "fallback") renderFallbackCluster();
      });
    });

    // Payment Card Calibration (Tier 3)
    if (el.arCalibBtn && el.arCardCalibOverlay) {
      el.arCalibBtn.addEventListener("click", () => {
        el.arCardCalibOverlay.hidden = false;
        updateCardGuideSize();
      });
    }
    if (el.arCardScaleRange) {
      el.arCardScaleRange.addEventListener("input", updateCardGuideSize);
    }
    if (el.arCardConfirmBtn && el.arCardCalibOverlay) {
      el.arCardConfirmBtn.addEventListener("click", () => {
        const cardPx = parseFloat(el.arCardScaleRange.value) || 210;
        fallbackPxPerCm = cardPx / CARD_WIDTH_CM;
        fallbackCalibrated = true;
        el.arCardCalibOverlay.hidden = true;
        if (el.arGuidanceText) {
          el.arGuidanceText.textContent = "Mierka 1:1 nakalibrovaná podľa platobnej karty. Potiahnite obraz na presné miesto.";
        }
        renderFallbackCluster();
      });
    }

    // Tilt sliders (Tier 3 perspective adjustment)
    if (el.arTiltX) {
      el.arTiltX.addEventListener("input", () => {
        fallbackTiltX = parseFloat(el.arTiltX.value) || 0;
        renderFallbackCluster();
      });
    }
    if (el.arTiltY) {
      el.arTiltY.addEventListener("input", () => {
        fallbackTiltY = parseFloat(el.arTiltY.value) || 0;
        renderFallbackCluster();
      });
    }

    // 1-finger drag sliding along the wall (Tier 1 WebXR & Tier 3 Fallback)
    if (el.arLiveOverlay) {
      el.arLiveOverlay.addEventListener("pointerdown", (e) => {
        if (e.target.closest("button, input, .ar-add-drawer, .ar-card-calib-box, .ar-hud-top, .ar-guidance-bar")) {
          return;
        }
        if (liveMode === "fallback") {
          fallbackDragging = true;
          fallbackDragStart = { x: e.clientX, y: e.clientY, ox: fallbackPosX, oy: fallbackPosY };
        } else if (liveMode === "webxr" && xrState.placed) {
          xrState.dragActive = true;
          xrState.dragLastX = e.clientX;
          xrState.dragLastY = e.clientY;
        }
      });

      window.addEventListener("pointermove", (e) => {
        if (liveMode === "fallback" && fallbackDragging) {
          fallbackPosX = fallbackDragStart.ox + (e.clientX - fallbackDragStart.x);
          fallbackPosY = fallbackDragStart.oy + (e.clientY - fallbackDragStart.y);
          if (el.arFallbackCluster) {
            el.arFallbackCluster.style.transform =
              `translate(calc(-50% + ${fallbackPosX}px), calc(-50% + ${fallbackPosY}px)) ` +
              `perspective(1100px) rotateY(${fallbackTiltX}deg) rotateX(${fallbackTiltY}deg)`;
          }
        } else if (liveMode === "webxr" && xrState.dragActive && xrState.placedGroup && xrState.THREE) {
          const dx = (e.clientX - xrState.dragLastX) * 0.0022;
          const dy = -(e.clientY - xrState.dragLastY) * 0.0022;
          xrState.dragLastX = e.clientX;
          xrState.dragLastY = e.clientY;
          const localRight = new xrState.THREE.Vector3(1, 0, 0).applyQuaternion(xrState.placedGroup.quaternion);
          const localUp = new xrState.THREE.Vector3(0, 1, 0).applyQuaternion(xrState.placedGroup.quaternion);
          xrState.placedGroup.position.addScaledVector(localRight, dx);
          xrState.placedGroup.position.addScaledVector(localUp, dy);
        }
      });

      const stopDrag = () => {
        fallbackDragging = false;
        xrState.dragActive = false;
      };
      window.addEventListener("pointerup", stopDrag);
      window.addEventListener("pointercancel", stopDrag);
    }

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isOpen()) close();
    });

    window.addEventListener("pagehide", () => {
      createdBlobUrls.forEach((u) => { try { URL.revokeObjectURL(u); } catch {} });
      createdBlobUrls = [];
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initBindings);
  } else {
    initBindings();
  }

  window.PlatenkoARViewer = { open, close, isOpen };
})();
