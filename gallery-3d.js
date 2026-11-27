/**
 * Platenko Art Portfolio - Minimalist 3D Virtual Gallery, Guided Tour & Phase 4 2D Crossfade
 * - Procedural White Cube multi-room space (#F7F7F5 matte walls, micro-cement floor, 3500K museum light)
 * - True physical scale stretched canvases + lazy texture window + strict WebGL disposal
 * - Guided Tour Mode ("Automatická prehliadka") with 5s dwell and minimal Stop Tour + #1/N pill
 * - Phase 4 Perpendicular Zoom-to-Fill & Glitch-Free 2D Hi-Res Crossfade (fade-out before camera move)
 */
(function () {
  "use strict";

  const ROOM_WIDTH = 8.4;
  const ROOM_HEIGHT = 3.8;
  const ROOM_LENGTH = 14.0;
  const PORTAL_WIDTH = 3.4;
  const PORTAL_HEIGHT = 3.05;
  const PER_WALL = 5;
  const PER_ROOM = PER_WALL * 2; // 10 paintings per White Cube room
  const EYE_HEIGHT = 1.52;
  const TOUR_PAUSE_MS = 5000;
  const CROSSFADE_EXIT_MS = 270;
  const TEXTURE_WINDOW_RADIUS = 18;
  const FRAME_GAP = 0.011;
  const FRAME_RAIL = 0.015;
  const FRAME_BACK_D = 0.010;

  let THREE = null;
  let isMounted = false;
  let artworksList = [];
  let callbacks = {};

  // Three.js scene state
  let renderer = null;
  let scene = null;
  let camera = null;
  let animRafId = null;
  let lastFrameTime = 0;
  let needsRender = true;
  let inAnimate = false;
  let roomCount = 1;
  let entries = []; // [{ index, art, roomIdx, dims, mesh, shadowMesh, frameGroup, washPlane, plaqueMesh, center, normal, loadedTexture, frontMat }]
  let raycastMeshes = [];
  let floorMesh = null;
  let waypointRing = null;
  let disposables = [];
  let sharedFrameOuterMat = null;
  let sharedFrameRecessMat = null;

  // Camera & Phase 4 Transition State
  // state: "free" | "moving" | "focused" | "exiting_crossfade"
  let camState = "free";
  let camPos = null;
  let camYaw = 0;
  let camPitch = -0.02;

  let moveStartPos = null;
  let moveEndPos = null;
  let moveCurve = null;
  let moveIsCrossRoom = false;
  let moveStartYaw = 0;
  let moveEndYaw = 0;
  let moveStartPitch = 0;
  let moveEndPitch = 0;
  let moveElapsed = 0;
  let moveDuration = 1.25;
  let moveTargetEntry = null;
  let focusedEntry = null;

  // Crossfade state
  let crossfadeVisible = false;
  let crossfadeToken = 0;
  let exitTimerId = null;

  // Tour state
  let tourActive = false;
  let tourPauseTimer = null;

  // Interaction state
  let pointerDown = false;
  let pointerStartX = 0;
  let pointerStartY = 0;
  let pointerLastX = 0;
  let pointerLastY = 0;
  let pointerMovedPx = 0;
  const keysDown = new Set();

  const el = {};
  function cacheDom() {
    if (el.root) return;
    el.root = document.getElementById("gallery3dRoot");
    el.canvasHost = document.getElementById("gallery3dCanvasHost");
    el.crossfadeLayer = document.getElementById("gallery3dCrossfadeLayer");
    el.crossfadeImg = document.getElementById("gallery3dCrossfadeImg");
    el.loading = document.getElementById("gallery3dLoading");
    el.topBar = document.getElementById("gallery3dTopBar");
    el.backBtn = document.getElementById("g3dBackBtn");
    el.roomBadge = document.getElementById("g3dRoomBadge");
    el.mobileMenuBtn = document.getElementById("g3dMobileMenuBtn");
    el.topControls = document.getElementById("g3dTopControls");
    el.tourBtn = document.getElementById("g3dTourBtn");
    el.fullscreenBtn = document.getElementById("g3dFullscreenBtn");
    el.prevBtn = document.getElementById("g3dPrevBtn");
    el.nextBtn = document.getElementById("g3dNextBtn");
    el.plaque = document.getElementById("gallery3dPlaque");
    el.plaqueTitle = document.getElementById("g3dPlaqueTitle");
    el.plaqueMeta = document.getElementById("g3dPlaqueMeta");
    el.overviewHint = document.getElementById("gallery3dOverviewHint");
    el.detailBtn = document.getElementById("g3dDetailBtn");
    el.arBtn = document.getElementById("g3dArBtn");
    el.shareBtn = document.getElementById("g3dShareBtn");
    el.tourPill = document.getElementById("gallery3dTourPill");
    el.stopTourBtn = document.getElementById("g3dStopTourBtn");
    el.tourCounter = document.getElementById("g3dTourCounter");
  }

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function lerpAngle(a, b, t) {
    let diff = b - a;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return a + diff * t;
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
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
      const isLand = natW > natH * 1.05;
      const isPort = natH > natW * 1.05;
      if ((isLand && wCm < hCm) || (isPort && wCm > hCm)) {
        [wCm, hCm] = [hCm, wCm];
      }
    }
    return { wCm, hCm, dCm, wM: wCm / 100, hM: hCm / 100, dM: dCm / 100 };
  }

  function track(res) {
    disposables.push(res);
    return res;
  }

  // ---- Procedural Textures (Micro-Cement Floor & Soft Shadow) ----
  function createMicroCementTexture() {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 512;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#E6E3DC";
    ctx.fillRect(0, 0, 512, 512);

    // Subtle organic plaster/cement tonal patches
    for (let i = 0; i < 420; i++) {
      const x = ((i * 73) % 512);
      const y = ((i * 137) % 512);
      const r = 18 + (i % 34);
      ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.045)" : "rgba(180,175,165,0.055)";
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Subtle architectural concrete expansion joints
    ctx.strokeStyle = "rgba(150, 146, 138, 0.14)";
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, 512, 512);

    const tex = track(new THREE.CanvasTexture(c));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  function createSoftShadowTexture() {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext("2d");
    const pad = 34;
    const w = 256 - pad * 2;
    const h = 256 - pad * 2;
    const r = 8;

    ctx.save();
    ctx.shadowColor = "rgba(18, 16, 14, 0.44)";
    ctx.shadowBlur = 24;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = "rgba(18, 16, 14, 0.44)";
    ctx.beginPath();
    ctx.moveTo(pad + r, pad);
    ctx.lineTo(pad + w - r, pad);
    ctx.quadraticCurveTo(pad + w, pad, pad + w, pad + r);
    ctx.lineTo(pad + w, pad + h - r);
    ctx.quadraticCurveTo(pad + w, pad + h, pad + w - r, pad + h);
    ctx.lineTo(pad + r, pad + h);
    ctx.quadraticCurveTo(pad, pad + h, pad, pad + h - r);
    ctx.lineTo(pad, pad + r);
    ctx.quadraticCurveTo(pad, pad, pad + r, pad);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    return track(new THREE.CanvasTexture(c));
  }

  function createWallSpotWashTexture() {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 512;
    const ctx = c.getContext("2d");
    const grad = ctx.createRadialGradient(128, 92, 16, 128, 220, 232);
    grad.addColorStop(0, "rgba(255, 249, 235, 0.46)");
    grad.addColorStop(0.42, "rgba(255, 248, 232, 0.20)");
    grad.addColorStop(0.76, "rgba(255, 247, 228, 0.06)");
    grad.addColorStop(1, "rgba(255, 246, 226, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 512);
    const tex = track(new THREE.CanvasTexture(c));
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function createWallPlaqueTexture() {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 160;
    const ctx = c.getContext("2d");

    ctx.fillStyle = "rgba(24, 24, 27, 0.14)";
    ctx.fillRect(10, 12, 238, 138);

    ctx.fillStyle = "#FAF9F6";
    ctx.fillRect(6, 8, 238, 138);
    ctx.strokeStyle = "rgba(24, 24, 27, 0.14)";
    ctx.lineWidth = 2;
    ctx.strokeRect(7, 9, 236, 136);

    ctx.fillStyle = "#27272A";
    ctx.fillRect(26, 38, 148, 11);
    ctx.fillStyle = "#71717A";
    ctx.fillRect(26, 68, 178, 7);
    ctx.fillStyle = "#A1A1AA";
    ctx.fillRect(26, 88, 124, 7);
    ctx.fillStyle = "#D4D4D8";
    ctx.fillRect(26, 112, 74, 5);

    const tex = track(new THREE.CanvasTexture(c));
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function buildArtworkFrameGroup(dims, frameOuterMat, frameRecessMat) {
    const group = new THREE.Group();
    const recessGeo = track(new THREE.BoxGeometry(dims.wM + FRAME_GAP * 2, dims.hM + FRAME_GAP * 2, FRAME_BACK_D));
    const recessMesh = new THREE.Mesh(recessGeo, frameRecessMat);
    recessMesh.position.set(0, 0, FRAME_BACK_D / 2);
    group.add(recessMesh);

    const ow = dims.wM + (FRAME_GAP + FRAME_RAIL) * 2;
    const oh = dims.hM + (FRAME_GAP + FRAME_RAIL) * 2;
    const fd = FRAME_BACK_D + dims.dM + 0.004;

    const topGeo = track(new THREE.BoxGeometry(ow, FRAME_RAIL, fd));
    const topRail = new THREE.Mesh(topGeo, frameOuterMat);
    topRail.position.set(0, oh / 2 - FRAME_RAIL / 2, fd / 2);
    group.add(topRail);

    const botGeo = track(new THREE.BoxGeometry(ow, FRAME_RAIL, fd));
    const botRail = new THREE.Mesh(botGeo, frameOuterMat);
    botRail.position.set(0, -(oh / 2 - FRAME_RAIL / 2), fd / 2);
    group.add(botRail);

    const sideH = Math.max(0.02, oh - FRAME_RAIL * 2);
    const leftGeo = track(new THREE.BoxGeometry(FRAME_RAIL, sideH, fd));
    const leftRail = new THREE.Mesh(leftGeo, frameOuterMat);
    leftRail.position.set(-(ow / 2 - FRAME_RAIL / 2), 0, fd / 2);
    group.add(leftRail);

    const rightGeo = track(new THREE.BoxGeometry(FRAME_RAIL, sideH, fd));
    const rightRail = new THREE.Mesh(rightGeo, frameOuterMat);
    rightRail.position.set(ow / 2 - FRAME_RAIL / 2, 0, fd / 2);
    group.add(rightRail);

    group.userData.outerW = ow;
    group.userData.outerH = oh;
    return group;
  }

  // ---- Build Multi-Room White Cube Architecture ----
  function buildArchitecture() {
    roomCount = Math.max(1, Math.ceil(artworksList.length / PER_ROOM));
    const totalLen = roomCount * ROOM_LENGTH;

    const wallMat = track(new THREE.MeshStandardMaterial({
      color: 0xF3F2ED,
      roughness: 0.94,
      metalness: 0.0,
    }));
    const baseboardMat = track(new THREE.MeshStandardMaterial({
      color: 0xE2E2DC,
      roughness: 0.88,
      metalness: 0.02,
    }));
    const ceilingMat = track(new THREE.MeshStandardMaterial({
      color: 0xF3F3F0,
      roughness: 0.96,
      metalness: 0.0,
    }));
    const trackMat = track(new THREE.MeshStandardMaterial({
      color: 0x222225,
      roughness: 0.55,
      metalness: 0.4,
    }));

    const floorTex = createMicroCementTexture();
    floorTex.repeat.set(Math.round(ROOM_WIDTH / 2.1), Math.round(totalLen / 2.1));
    const floorMat = track(new THREE.MeshStandardMaterial({
      map: floorTex,
      roughness: 0.86,
      metalness: 0.02,
    }));

    // Continuous micro-cement floor
    const fGeo = track(new THREE.PlaneGeometry(ROOM_WIDTH, totalLen));
    floorMesh = new THREE.Mesh(fGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.set(0, 0, -totalLen / 2);
    scene.add(floorMesh);

    // Ceiling
    const cGeo = track(new THREE.PlaneGeometry(ROOM_WIDTH, totalLen));
    const ceilMesh = new THREE.Mesh(cGeo, ceilingMat);
    ceilMesh.rotation.x = Math.PI / 2;
    ceilMesh.position.set(0, ROOM_HEIGHT, -totalLen / 2);
    scene.add(ceilMesh);

    // Side walls (continuous matte #F3F2ED)
    const sideWallGeo = track(new THREE.PlaneGeometry(totalLen, ROOM_HEIGHT));
    const leftWall = new THREE.Mesh(sideWallGeo, wallMat);
    leftWall.rotation.y = Math.PI / 2;
    leftWall.position.set(-ROOM_WIDTH / 2, ROOM_HEIGHT / 2, -totalLen / 2);
    scene.add(leftWall);

    const rightWall = new THREE.Mesh(sideWallGeo, wallMat);
    rightWall.rotation.y = -Math.PI / 2;
    rightWall.position.set(ROOM_WIDTH / 2, ROOM_HEIGHT / 2, -totalLen / 2);
    scene.add(rightWall);

    // Subtle baseboards along side walls
    const baseGeo = track(new THREE.BoxGeometry(0.02, 0.09, totalLen));
    const leftBase = new THREE.Mesh(baseGeo, baseboardMat);
    leftBase.position.set(-ROOM_WIDTH / 2 + 0.01, 0.045, -totalLen / 2);
    scene.add(leftBase);
    const rightBase = new THREE.Mesh(baseGeo, baseboardMat);
    rightBase.position.set(ROOM_WIDTH / 2 - 0.01, 0.045, -totalLen / 2);
    scene.add(rightBase);

    // Entrance & far-end solid walls
    const endWallGeo = track(new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_HEIGHT));
    const startWall = new THREE.Mesh(endWallGeo, wallMat);
    startWall.rotation.y = Math.PI;
    startWall.position.set(0, ROOM_HEIGHT / 2, 0);
    scene.add(startWall);

    const endWall = new THREE.Mesh(endWallGeo, wallMat);
    endWall.position.set(0, ROOM_HEIGHT / 2, -totalLen);
    scene.add(endWall);

    // Partition walls with architectural portals between rooms
    const pillarW = (ROOM_WIDTH - PORTAL_WIDTH) / 2;
    const pillarGeo = track(new THREE.BoxGeometry(pillarW, ROOM_HEIGHT, 0.34));
    const lintelGeo = track(new THREE.BoxGeometry(PORTAL_WIDTH, ROOM_HEIGHT - PORTAL_HEIGHT, 0.34));

    for (let r = 1; r < roomCount; r++) {
      const z = -r * ROOM_LENGTH;
      const lp = new THREE.Mesh(pillarGeo, wallMat);
      lp.position.set(-ROOM_WIDTH / 2 + pillarW / 2, ROOM_HEIGHT / 2, z);
      scene.add(lp);

      const rp = new THREE.Mesh(pillarGeo, wallMat);
      rp.position.set(ROOM_WIDTH / 2 - pillarW / 2, ROOM_HEIGHT / 2, z);
      scene.add(rp);

      const lintel = new THREE.Mesh(lintelGeo, wallMat);
      lintel.position.set(0, PORTAL_HEIGHT + (ROOM_HEIGHT - PORTAL_HEIGHT) / 2, z);
      scene.add(lintel);
    }

    // Minimalist black ceiling lighting tracks & fixtures
    const railGeo = track(new THREE.BoxGeometry(0.05, 0.04, totalLen - 1.2));
    [-ROOM_WIDTH / 2 + 1.55, ROOM_WIDTH / 2 - 1.55].forEach((rx) => {
      const rail = new THREE.Mesh(railGeo, trackMat);
      rail.position.set(rx, ROOM_HEIGHT - 0.03, -totalLen / 2);
      scene.add(rail);
    });

    // Clickable floor waypoint ring
    const ringGeo = track(new THREE.RingGeometry(0.16, 0.22, 32));
    const ringMat = track(new THREE.MeshBasicMaterial({
      color: 0x18181b,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
    }));
    waypointRing = new THREE.Mesh(ringGeo, ringMat);
    waypointRing.rotation.x = -Math.PI / 2;
    waypointRing.position.y = 0.015;
    waypointRing.visible = false;
    scene.add(waypointRing);

    // Museum-grade baked 3500K neutral-warm lighting (NO public sliders)
    scene.add(track(new THREE.HemisphereLight(0xFFFDF8, 0xE6E4DE, 1.38)));
    const keyLight = track(new THREE.DirectionalLight(0xFFF6EA, 0.36));
    keyLight.position.set(3, 8, 4);
    scene.add(keyLight);
    const fillLight = track(new THREE.DirectionalLight(0xF8F9FA, 0.24));
    fillLight.position.set(-4, 6, -6);
    scene.add(fillLight);

    // Populate artworks as true-scale stretched canvases in modern Shadow-Box floater frames
    entries = [];
    raycastMeshes = [];
    sharedFrameOuterMat = track(new THREE.MeshStandardMaterial({ color: 0x1E1E22, roughness: 0.52, metalness: 0.08 }));
    sharedFrameRecessMat = track(new THREE.MeshStandardMaterial({ color: 0x0E0E10, roughness: 0.96, metalness: 0.0 }));
    const canvasSideMat = track(new THREE.MeshStandardMaterial({ color: 0xDCD7CE, roughness: 0.86 }));
    const spotLensMat = track(new THREE.MeshBasicMaterial({ color: 0xFFF4DC }));
    const shadowTex = createSoftShadowTexture();
    const shadowMat = track(new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.85, depthWrite: false }));
    const spotWashTex = createWallSpotWashTexture();
    const spotWashMat = track(new THREE.MeshBasicMaterial({ map: spotWashTex, transparent: true, opacity: 0.78, depthWrite: false }));
    const plaqueTex = createWallPlaqueTexture();
    const plaqueMat = track(new THREE.MeshBasicMaterial({ map: plaqueTex, transparent: true }));
    const plaqueGeo = track(new THREE.PlaneGeometry(0.14, 0.088));
    const spotHeadGeo = track(new THREE.CylinderGeometry(0.035, 0.045, 0.14, 12));
    const spotLensGeo = track(new THREE.CircleGeometry(0.036, 12));

    artworksList.forEach((art, idx) => {
      const roomIdx = Math.floor(idx / PER_ROOM);
      const localIdx = idx % PER_ROOM;
      const isLeft = localIdx < PER_WALL;
      // Boustrophedon perimeter path: 0..4 down left wall, 4..0 back along right wall
      const slot = isLeft ? localIdx : (PER_WALL - 1) - (localIdx - PER_WALL);

      const dims = parseDimensionsCm(art);
      const stepZ = (ROOM_LENGTH - 3.2) / PER_WALL;
      const z = -roomIdx * ROOM_LENGTH - (1.6 + stepZ * (slot + 0.5));
      const xWall = isLeft ? -ROOM_WIDTH / 2 : ROOM_WIDTH / 2;
      const normalX = isLeft ? 1 : -1;
      const yCenter = clamp(Math.max(1.52, 0.52 + dims.hM / 2), 1.15, ROOM_HEIGHT - 0.42 - dims.hM / 2);

      const holder = new THREE.Group();
      holder.position.set(xWall, yCenter, z);
      holder.rotation.y = isLeft ? Math.PI / 2 : -Math.PI / 2;
      scene.add(holder);

      const frameGroup = buildArtworkFrameGroup(dims, sharedFrameOuterMat, sharedFrameRecessMat);
      const ow = frameGroup.userData.outerW;
      const oh = frameGroup.userData.outerH;

      // Soft rectangular wall contact drop shadow
      const shGeo = track(new THREE.PlaneGeometry(ow + 0.16, oh + 0.16));
      const shadowMesh = new THREE.Mesh(shGeo, shadowMat);
      shadowMesh.position.set(0.014, -0.024, 0.002);
      holder.add(shadowMesh);

      holder.add(frameGroup);

      // Stretched canvas mesh (1:1 meters) nested inside floater frame
      const boxGeo = track(new THREE.BoxGeometry(dims.wM, dims.hM, dims.dM));
      const frontMat = track(new THREE.MeshStandardMaterial({
        color: 0xE8E6E0,
        roughness: 0.68,
        metalness: 0.02,
      }));
      const mesh = new THREE.Mesh(boxGeo, [canvasSideMat, canvasSideMat, canvasSideMat, canvasSideMat, frontMat, canvasSideMat]);
      mesh.position.set(0, 0, FRAME_BACK_D + dims.dM / 2);
      mesh.userData.entryIndex = idx;
      holder.add(mesh);
      raycastMeshes.push(mesh);

      // Warm 3500K museum wall wash cone
      const washPlane = new THREE.Mesh(track(new THREE.PlaneGeometry(Math.max(1.4, ow * 1.9), 2.5)), spotWashMat);
      washPlane.position.set(0, Math.min(ROOM_HEIGHT - yCenter - 0.85, 0.58), 0.0015);
      holder.add(washPlane);

      // Minimalist gallery wall plaque beside lower-right corner
      const plaqueMesh = new THREE.Mesh(plaqueGeo, plaqueMat);
      plaqueMesh.position.set(ow / 2 + 0.105, -oh / 2 + 0.055, 0.003);
      plaqueMesh.userData.entryIndex = idx;
      holder.add(plaqueMesh);
      raycastMeshes.push(plaqueMesh);

      // Ceiling track spotlight fixture with lit warm lens
      const spotGroup = new THREE.Group();
      spotGroup.position.set(isLeft ? -ROOM_WIDTH / 2 + 1.55 : ROOM_WIDTH / 2 - 1.55, ROOM_HEIGHT - 0.1, z);
      spotGroup.rotation.z = isLeft ? -0.55 : 0.55;
      const spotHead = new THREE.Mesh(spotHeadGeo, trackMat);
      spotGroup.add(spotHead);
      const spotLens = new THREE.Mesh(spotLensGeo, spotLensMat);
      spotLens.position.set(0, -0.071, 0);
      spotLens.rotation.x = Math.PI / 2;
      spotGroup.add(spotLens);
      scene.add(spotGroup);

      entries.push({
        index: idx,
        art,
        roomIdx,
        dims,
        holder,
        mesh,
        shadowMesh,
        frameGroup,
        washPlane,
        plaqueMesh,
        xWall,
        normalX,
        zPos: z,
        frontMat,
        loadedTexture: null,
        loadingTexture: false,
        center: new THREE.Vector3(xWall + normalX * (FRAME_BACK_D + dims.dM), yCenter, z),
        normal: new THREE.Vector3(normalX, 0, 0),
      });
    });
  }

  function syncEntryOrientationFromImage(entry, natW, natH) {
    if (!entry || !THREE || !(natW > 0 && natH > 0)) return false;
    const updatedDims = parseDimensionsCm(entry.art, natW, natH);
    if (updatedDims.wCm === entry.dims.wCm && updatedDims.hCm === entry.dims.hCm) return false;
    entry.dims = updatedDims;

    const yCenter = clamp(Math.max(1.52, 0.52 + updatedDims.hM / 2), 1.15, ROOM_HEIGHT - 0.42 - updatedDims.hM / 2);
    entry.holder.position.y = yCenter;
    entry.center.set(entry.xWall + entry.normalX * (FRAME_BACK_D + updatedDims.dM), yCenter, entry.zPos);

    const newGeo = track(new THREE.BoxGeometry(updatedDims.wM, updatedDims.hM, updatedDims.dM));
    entry.mesh.geometry.dispose();
    entry.mesh.geometry = newGeo;
    entry.mesh.position.z = FRAME_BACK_D + updatedDims.dM / 2;

    if (entry.frameGroup) {
      entry.frameGroup.traverse((child) => {
        if (child.isMesh && child.geometry) {
          child.geometry.dispose();
        }
      });
      entry.holder.remove(entry.frameGroup);
    }
    const newFrameGroup = buildArtworkFrameGroup(updatedDims, sharedFrameOuterMat, sharedFrameRecessMat);
    entry.holder.add(newFrameGroup);
    entry.frameGroup = newFrameGroup;

    const ow = newFrameGroup.userData.outerW;
    const oh = newFrameGroup.userData.outerH;

    const newShGeo = track(new THREE.PlaneGeometry(ow + 0.16, oh + 0.16));
    entry.shadowMesh.geometry.dispose();
    entry.shadowMesh.geometry = newShGeo;

    if (entry.plaqueMesh) {
      entry.plaqueMesh.position.set(ow / 2 + 0.105, -oh / 2 + 0.055, 0.003);
    }
    if (entry.washPlane) {
      const newWashGeo = track(new THREE.PlaneGeometry(Math.max(1.4, ow * 1.9), 2.5));
      entry.washPlane.geometry.dispose();
      entry.washPlane.geometry = newWashGeo;
      entry.washPlane.position.y = Math.min(ROOM_HEIGHT - yCenter - 0.85, 0.58);
    }

    if (camState === "focused" && focusedEntry === entry && renderer && camera) {
      const target = computeViewingPose(entry);
      camPos.copy(target.pos);
      camYaw = target.yaw;
      camPitch = target.pitch;
      syncCameraTransform();
      showPlaqueFor(entry);
      alignCrossfadeOverlay(entry);
    } else if (camState === "moving" && moveTargetEntry === entry) {
      const target = computeViewingPose(entry);
      moveEndPos = target.pos;
      moveEndYaw = target.yaw;
      moveEndPitch = target.pitch;
      const pathInfo = buildTransitionPath(camPos, target.pos);
      moveCurve = pathInfo.curve;
      moveIsCrossRoom = pathInfo.isCrossRoom;
    }
    return true;
  }

  // ---- Lazy Rolling Texture Window (WebGL Memory Hygiene for 91 Paintings) ----
  function updateTextureWindow(centerIdx) {
    if (!THREE || entries.length === 0) return;
    const minIdx = Math.max(0, centerIdx - TEXTURE_WINDOW_RADIUS);
    const maxIdx = Math.min(entries.length - 1, centerIdx + TEXTURE_WINDOW_RADIUS);
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");

    entries.forEach((entry, idx) => {
      if (idx >= minIdx && idx <= maxIdx) {
        if (!entry.loadedTexture && !entry.loadingTexture) {
          entry.loadingTexture = true;
          loader.load(
            toThumbUrl(entry.art.coverImage),
            (tex) => {
              if (!isMounted) {
                tex.dispose();
                return;
              }
              tex.colorSpace = THREE.SRGBColorSpace;
              tex.anisotropy = Math.min(4, renderer ? renderer.capabilities.getMaxAnisotropy() : 2);
              entry.loadedTexture = tex;
              entry.loadingTexture = false;
              entry.frontMat.color.setHex(0xffffff);
              entry.frontMat.map = tex;
              entry.frontMat.needsUpdate = true;
              requestRender();

              // Auto-adjust default 50x70 orientation if photo is landscape
              if (tex.image && tex.image.naturalWidth > 0) {
                syncEntryOrientationFromImage(entry, tex.image.naturalWidth, tex.image.naturalHeight);
              }
            },
            undefined,
            () => {
              entry.loadingTexture = false;
            }
          );
        }
      } else if (entry.loadedTexture) {
        entry.frontMat.map = null;
        entry.frontMat.color.setHex(0xE8E6E0);
        entry.frontMat.needsUpdate = true;
        entry.loadedTexture.dispose();
        entry.loadedTexture = null;
        entry.loadingTexture = false;
        requestRender();
      }
    });
  }

  // ---- Collision Detection ----
  function clampWalkablePosition(vec) {
    const minZ = -roomCount * ROOM_LENGTH + 0.9;
    const maxZ = -0.9;
    vec.z = clamp(vec.z, minZ, maxZ);

    const absZ = Math.abs(vec.z);
    const localZ = absZ % ROOM_LENGTH;
    const nearDivider = localZ < 0.85 || localZ > ROOM_LENGTH - 0.85;
    const maxHalfX = nearDivider ? (PORTAL_WIDTH / 2 - 0.45) : (ROOM_WIDTH / 2 - 0.85);
    vec.x = clamp(vec.x, -maxHalfX, maxHalfX);
    vec.y = EYE_HEIGHT;
  }

  function setOverviewHintVisible(visible) {
    if (!el.overviewHint) return;
    el.overviewHint.hidden = !visible || tourActive;
  }

  function updateRoomBadge() {
    if (!el.roomBadge || !camPos) return;
    const r = clamp(Math.floor(Math.abs(camPos.z) / ROOM_LENGTH) + 1, 1, roomCount);
    if (focusedEntry && entries.length > 0) {
      el.roomBadge.textContent = `Sála ${r} / ${roomCount} · #${focusedEntry.index + 1}/${entries.length}`;
    } else {
      el.roomBadge.textContent = `Sála ${r} / ${roomCount}`;
    }
  }

  function updateNavArrowsState() {
    if (!el.prevBtn || !el.nextBtn) return;
    if (entries.length === 0) {
      el.prevBtn.disabled = true;
      el.nextBtn.disabled = true;
      return;
    }
    const active = moveTargetEntry || focusedEntry;
    if (active) {
      el.prevBtn.disabled = active.index <= 0;
      el.nextBtn.disabled = active.index >= entries.length - 1;
      return;
    }
    if (camPos && camPos.z > -3.2) {
      el.prevBtn.disabled = true;
      el.nextBtn.disabled = false;
      return;
    }
    const nearest = findNearestEntryIndex();
    el.prevBtn.disabled = nearest <= 0;
    el.nextBtn.disabled = nearest >= entries.length - 1;
  }

  // ---- Phase 4: Perpendicular Zoom-to-Fill & Glitch-Free 2D Photo Crossfade ----
  function computeViewingPose(entry) {
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const isMobile = window.innerWidth < 768;
    const marginV = isMobile ? 0.68 : 0.76;
    const marginH = isMobile ? 0.84 : 0.82;

    const distV = (entry.dims.hM / 2) / (Math.tan(vFov / 2) * marginV);
    const distH = (entry.dims.wM / 2) / (Math.tan(hFov / 2) * marginH);
    const dist = clamp(Math.max(distV, distH, 0.72), 0.72, 3.25);

    const pos = entry.center.clone().addScaledVector(entry.normal, dist);
    const yaw = Math.atan2(entry.normal.x, entry.normal.z);
    return { pos, yaw, pitch: 0 };
  }

  function alignCrossfadeOverlay(entry) {
    if (!el.crossfadeImg || !entry || !camera || !renderer) return false;
    camera.updateMatrixWorld(true);
    entry.holder.updateMatrixWorld(true);

    const camFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const toCenter = entry.center.clone().sub(camera.position);
    if (toCenter.lengthSq() < 1e-6) {
      el.crossfadeImg.style.opacity = "0";
      return false;
    }
    toCenter.normalize();
    if (camFwd.dot(toCenter) < 0.2) {
      el.crossfadeImg.style.opacity = "0";
      return false;
    }

    const rect = renderer.domElement.getBoundingClientRect();
    const hw = entry.dims.wM / 2;
    const hh = entry.dims.hM / 2;
    const frontZ = entry.dims.dM / 2;

    const cornersLocal = [
      new THREE.Vector3(-hw, hh, frontZ),
      new THREE.Vector3(hw, hh, frontZ),
      new THREE.Vector3(-hw, -hh, frontZ),
      new THREE.Vector3(hw, -hh, frontZ),
    ];

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (let i = 0; i < cornersLocal.length; i++) {
      const worldPt = cornersLocal[i].clone().applyMatrix4(entry.mesh.matrixWorld);
      worldPt.project(camera);
      if (worldPt.z < -1 || worldPt.z > 1) {
        el.crossfadeImg.style.opacity = "0";
        return false;
      }
      const sx = (worldPt.x * 0.5 + 0.5) * rect.width;
      const sy = (-worldPt.y * 0.5 + 0.5) * rect.height;
      if (sx < minX) minX = sx;
      if (sx > maxX) maxX = sx;
      if (sy < minY) minY = sy;
      if (sy > maxY) maxY = sy;
    }

    const w = Math.max(10, maxX - minX);
    const h = Math.max(10, maxY - minY);
    el.crossfadeImg.style.left = `${minX}px`;
    el.crossfadeImg.style.top = `${minY}px`;
    el.crossfadeImg.style.width = `${w}px`;
    el.crossfadeImg.style.height = `${h}px`;
    return true;
  }

  function showPlaqueFor(entry) {
    if (!el.plaque || !entry) return;
    if (el.plaqueTitle) el.plaqueTitle.textContent = entry.art.title || "Bez názvu";
    if (el.plaqueMeta) {
      el.plaqueMeta.textContent = `${entry.dims.wCm} × ${entry.dims.hCm} cm · ${entry.art.medium || "Akryl na plátne"}`;
    }
    el.plaque.hidden = tourActive;
  }

  function hidePlaque() {
    if (el.plaque) el.plaque.hidden = true;
  }

  function arriveAtPainting(entry) {
    camState = "focused";
    focusedEntry = entry;
    setOverviewHintVisible(false);
    updateRoomBadge();
    updateNavArrowsState();
    updateTextureWindow(entry.index);
    if (callbacks.onFocusArtwork) callbacks.onFocusArtwork(entry.art);
    if (tourActive && el.tourCounter) {
      el.tourCounter.textContent = `#${entry.index + 1}/${entries.length}`;
    }

    const token = ++crossfadeToken;
    alignCrossfadeOverlay(entry);
    showPlaqueFor(entry);

    if (el.crossfadeImg) {
      const hiresSrc = entry.art.coverImage;
      const preload = new Image();
      preload.crossOrigin = "anonymous";
      preload.onload = () => {
        if (!isMounted || token !== crossfadeToken || camState !== "focused" || focusedEntry !== entry) return;
        syncEntryOrientationFromImage(entry, preload.naturalWidth, preload.naturalHeight);
        const aligned = alignCrossfadeOverlay(entry);
        if (!aligned) return;
        el.crossfadeImg.src = hiresSrc;
        el.crossfadeImg.alt = entry.art.title || "";
        requestAnimationFrame(() => {
          if (!isMounted || token !== crossfadeToken || camState !== "focused" || focusedEntry !== entry) return;
          if (alignCrossfadeOverlay(entry)) {
            el.crossfadeImg.style.opacity = "1";
            crossfadeVisible = true;
          }
        });
      };
      preload.src = hiresSrc;
    }

    if (tourActive) {
      clearTimeout(tourPauseTimer);
      tourPauseTimer = setTimeout(() => {
        if (!tourActive || !isMounted) return;
        if (entry.index + 1 >= entries.length) {
          stopTour();
          if (window.PlatenkoApp && window.PlatenkoApp.showToast) {
            window.PlatenkoApp.showToast("Automatická prehliadka dokončená");
          }
          return;
        }
        navigateToIndex(entry.index + 1, true);
      }, TOUR_PAUSE_MS);
    }
  }

  // Glitch-Free Exit: FIRST fade 2D overlay -> 0 while camera stays locked, ONLY AFTER move camera
  function exitCrossfadeThen(callback) {
    crossfadeToken++;
    hidePlaque();
    if (exitTimerId) {
      clearTimeout(exitTimerId);
      exitTimerId = null;
    }
    if (crossfadeVisible && el.crossfadeImg) {
      camState = "exiting_crossfade";
      el.crossfadeImg.style.opacity = "0";
      exitTimerId = setTimeout(() => {
        exitTimerId = null;
        crossfadeVisible = false;
        if (!isMounted) return;
        el.crossfadeImg.removeAttribute("src");
        callback();
      }, CROSSFADE_EXIT_MS);
    } else {
      crossfadeVisible = false;
      if (el.crossfadeImg) {
        el.crossfadeImg.style.opacity = "0";
      }
      callback();
    }
  }

  function buildTransitionPath(startPos, endPos) {
    const startRoom = Math.floor(Math.abs(startPos.z) / ROOM_LENGTH);
    const endRoom = Math.floor(Math.abs(endPos.z) / ROOM_LENGTH);
    const pts = [startPos.clone()];
    const isCrossRoom = startRoom !== endRoom;

    if (isCrossRoom) {
      if (Math.abs(startPos.x) > 0.75) {
        pts.push(new THREE.Vector3(0, EYE_HEIGHT, startPos.z));
      }
      const midEnd = new THREE.Vector3(0, EYE_HEIGHT, endPos.z);
      if (pts[pts.length - 1].distanceTo(midEnd) > 0.25) {
        pts.push(midEnd);
      }
    }
    if (pts[pts.length - 1].distanceTo(endPos) > 0.05) {
      pts.push(endPos.clone());
    }

    if (pts.length < 2) {
      return { curve: null, isCrossRoom: false };
    }
    return {
      curve: new THREE.CatmullRomCurve3(pts, false, "centripetal", 0.5),
      isCrossRoom,
    };
  }

  function navigateToEntry(entry, instant) {
    if (!entry || !THREE) return;
    setOverviewHintVisible(false);
    exitCrossfadeThen(() => {
      if (!isMounted) return;
      updateTextureWindow(entry.index);
      const target = computeViewingPose(entry);
      focusedEntry = null;

      if (instant) {
        camPos.copy(target.pos);
        camYaw = target.yaw;
        camPitch = target.pitch;
        moveCurve = null;
        moveIsCrossRoom = false;
        moveTargetEntry = null;
        syncCameraTransform();
        arriveAtPainting(entry);
        return;
      }

      const pathInfo = buildTransitionPath(camPos, target.pos);
      moveStartPos = camPos.clone();
      moveEndPos = target.pos;
      moveCurve = pathInfo.curve;
      moveIsCrossRoom = pathInfo.isCrossRoom;
      moveStartYaw = camYaw;
      moveEndYaw = target.yaw;
      moveStartPitch = camPitch;
      moveEndPitch = target.pitch;
      const pathLen = moveCurve ? moveCurve.getLength() : moveStartPos.distanceTo(moveEndPos);
      moveDuration = clamp(0.75 + pathLen * 0.16, 0.85, tourActive ? 2.6 : 2.1);
      moveElapsed = 0;
      moveTargetEntry = entry;
      camState = "moving";
      updateNavArrowsState();
      requestRender();
    });
  }

  function navigateToIndex(idx, fromTour) {
    if (entries.length === 0) return;
    if (!fromTour && tourActive) stopTour();
    const safeIdx = clamp(idx, 0, entries.length - 1);
    navigateToEntry(entries[safeIdx], false);
  }

  function stepArtwork(delta) {
    if (entries.length === 0) return;
    if (tourActive) stopTour();
    const active = moveTargetEntry || focusedEntry;
    if (active) {
      const nextIdx = active.index + delta;
      if (nextIdx < 0 || nextIdx >= entries.length) return;
      navigateToEntry(entries[nextIdx], false);
      return;
    }

    if (delta > 0) {
      const targetIdx = camPos && camPos.z > -3.2 ? 0 : Math.min(entries.length - 1, findNearestEntryIndex());
      navigateToEntry(entries[targetIdx], false);
    } else if (delta < 0) {
      if (camPos && camPos.z > -3.2) return;
      const targetIdx = Math.max(0, findNearestEntryIndex() - 1);
      navigateToEntry(entries[targetIdx], false);
    }
  }

  function findNearestEntryIndex() {
    if (!camPos || entries.length === 0) return 0;
    let bestIdx = 0;
    let bestDist = Infinity;
    entries.forEach((e, i) => {
      const d = camPos.distanceToSquared(e.center);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    });
    return bestIdx;
  }

  // ---- Guided Tour ("Automatická prehliadka") ----
  function startTour() {
    if (entries.length === 0) return;
    tourActive = true;
    setOverviewHintVisible(false);
    if (el.root) el.root.classList.add("tour-active");
    if (el.topControls) el.topControls.classList.remove("mobile-open");
    if (el.mobileMenuBtn) el.mobileMenuBtn.setAttribute("aria-expanded", "false");
    if (el.tourPill) el.tourPill.hidden = false;
    hidePlaque();

    const startIdx = focusedEntry ? Math.min(entries.length - 1, focusedEntry.index + 1) : (camPos && camPos.z > -3.2 ? 0 : findNearestEntryIndex());
    if (el.tourCounter) el.tourCounter.textContent = `#${startIdx + 1}/${entries.length}`;
    navigateToEntry(entries[startIdx], false);
  }

  function stopTour() {
    if (!tourActive) return;
    tourActive = false;
    clearTimeout(tourPauseTimer);
    tourPauseTimer = null;
    if (el.root) el.root.classList.remove("tour-active");
    if (el.tourPill) el.tourPill.hidden = true;
    if (camState === "focused" && focusedEntry) {
      showPlaqueFor(focusedEntry);
    }
  }

  function requestRender() {
    needsRender = true;
    if (!isMounted || document.hidden) return;
    if (animRafId === null) {
      lastFrameTime = 0;
      animRafId = requestAnimationFrame(animate);
    }
  }

  function onVisibilityChange() {
    if (!isMounted) return;
    if (document.hidden) {
      if (animRafId !== null) {
        cancelAnimationFrame(animRafId);
        animRafId = null;
      }
      lastFrameTime = 0;
    } else {
      requestRender();
    }
  }

  function syncCameraTransform() {
    if (!camera || !camPos) return;
    camera.position.copy(camPos);
    camera.rotation.order = "YXZ";
    camera.rotation.y = camYaw;
    camera.rotation.x = camPitch;
    if (inAnimate) {
      needsRender = true;
    } else {
      requestRender();
    }
  }

  function animate(now) {
    animRafId = null;
    if (!isMounted || document.hidden) return;

    const dt = lastFrameTime ? Math.min(0.05, (now - lastFrameTime) / 1000) : 0.016;
    lastFrameTime = now;
    inAnimate = true;
    let shouldRender = needsRender;
    let shouldContinue = false;

    if (camState === "moving" && moveStartPos && moveEndPos) {
      moveElapsed += dt;
      const rawT = clamp(moveElapsed / moveDuration, 0, 1);
      const t = easeInOutCubic(rawT);
      if (moveCurve) {
        moveCurve.getPoint(t, camPos);
      } else {
        camPos.lerpVectors(moveStartPos, moveEndPos, t);
      }

      if (moveIsCrossRoom && moveCurve) {
        const tangent = moveCurve.getTangent(clamp(t, 0.02, 0.98));
        const flatLenSq = tangent.x * tangent.x + tangent.z * tangent.z;
        const travelYaw = flatLenSq > 1e-5 ? Math.atan2(-tangent.x, -tangent.z) : moveEndYaw;
        if (rawT < 0.55) {
          const legT = easeInOutCubic(clamp(rawT / 0.35, 0, 1));
          camYaw = lerpAngle(moveStartYaw, travelYaw, legT);
        } else {
          const endT = easeInOutCubic(clamp((rawT - 0.55) / 0.45, 0, 1));
          camYaw = lerpAngle(travelYaw, moveEndYaw, endT);
        }
      } else {
        camYaw = lerpAngle(moveStartYaw, moveEndYaw, t);
      }
      camPitch = moveStartPitch + (moveEndPitch - moveStartPitch) * t;
      syncCameraTransform();
      updateRoomBadge();
      shouldRender = true;

      if (rawT >= 1) {
        moveCurve = null;
        moveIsCrossRoom = false;
        if (waypointRing) waypointRing.visible = false;
        if (moveTargetEntry) {
          const arrived = moveTargetEntry;
          moveTargetEntry = null;
          arriveAtPainting(arrived);
        } else {
          camState = "free";
          updateTextureWindow(findNearestEntryIndex());
          updateRoomBadge();
          updateNavArrowsState();
        }
      } else {
        shouldContinue = true;
      }
    } else if (camState === "free") {
      let changed = false;
      if (Math.abs(camPos.y - EYE_HEIGHT) > 0.001) {
        camPos.y += (EYE_HEIGHT - camPos.y) * Math.min(1, dt * 8);
        changed = true;
      }
      if (keysDown.size > 0) {
        const speed = 2.6 * dt;
        const fwd = new THREE.Vector3(-Math.sin(camYaw), 0, -Math.cos(camYaw));
        const right = new THREE.Vector3(Math.cos(camYaw), 0, -Math.sin(camYaw));
        let moved = false;

        if (keysDown.has("KeyW") || keysDown.has("ArrowUp")) { camPos.addScaledVector(fwd, speed); moved = true; }
        if (keysDown.has("KeyS") || keysDown.has("ArrowDown")) { camPos.addScaledVector(fwd, -speed); moved = true; }
        if (keysDown.has("KeyA")) { camPos.addScaledVector(right, -speed); moved = true; }
        if (keysDown.has("KeyD")) { camPos.addScaledVector(right, speed); moved = true; }

        if (moved) {
          setOverviewHintVisible(false);
          clampWalkablePosition(camPos);
          updateRoomBadge();
          updateNavArrowsState();
          updateTextureWindow(findNearestEntryIndex());
          changed = true;
        }
      }
      if (changed) {
        syncCameraTransform();
        shouldRender = true;
      }
      if (keysDown.size > 0 || Math.abs(camPos.y - EYE_HEIGHT) > 0.001) {
        shouldContinue = true;
      }
    }

    inAnimate = false;

    if (shouldRender) {
      needsRender = false;
      renderer.render(scene, camera);
    }

    if ((shouldContinue || needsRender) && isMounted && !document.hidden) {
      animRafId = requestAnimationFrame(animate);
    } else {
      lastFrameTime = 0;
    }
  }

  // ---- Input & Raycast Handlers ----
  function onStagePointerDown(e) {
    if (!isMounted || e.target.closest("button")) return;
    if (tourActive) stopTour();
    pointerDown = true;
    pointerStartX = e.clientX;
    pointerStartY = e.clientY;
    pointerLastX = e.clientX;
    pointerLastY = e.clientY;
    pointerMovedPx = 0;
  }

  function onStagePointerMove(e) {
    if (!isMounted || !pointerDown) return;
    const dx = e.clientX - pointerLastX;
    const dy = e.clientY - pointerLastY;
    pointerLastX = e.clientX;
    pointerLastY = e.clientY;
    pointerMovedPx += Math.hypot(dx, dy);

    if (pointerMovedPx > 6) {
      setOverviewHintVisible(false);
      if (camState === "focused" || camState === "moving") {
        // Glitch-free exit before letting user rotate away
        exitCrossfadeThen(() => {
          if (!isMounted) return;
          camState = "free";
          focusedEntry = null;
          moveTargetEntry = null;
          moveCurve = null;
          moveIsCrossRoom = false;
          updateRoomBadge();
          updateNavArrowsState();
          if (callbacks.onLeaveArtwork) callbacks.onLeaveArtwork();
        });
        return;
      }
      if (camState === "free") {
        camYaw += dx * 0.0042;
        camPitch = clamp(camPitch + dy * 0.0032, -0.58, 0.58);
        syncCameraTransform();
      }
    }
  }

  function onStagePointerUp(e) {
    if (!isMounted) return;
    const wasTap = pointerDown && pointerMovedPx < 8;
    pointerDown = false;
    if (!wasTap || !renderer || !camera) return;

    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);

    const artHits = raycaster.intersectObjects(raycastMeshes, false);
    if (artHits.length > 0) {
      const idx = artHits[0].object.userData.entryIndex;
      if (typeof idx === "number" && entries[idx]) {
        navigateToEntry(entries[idx], false);
        return;
      }
    }

    if (floorMesh) {
      const floorHits = raycaster.intersectObject(floorMesh, false);
      if (floorHits.length > 0 && floorHits[0].distance < 16) {
        const pt = floorHits[0].point.clone();
        clampWalkablePosition(pt);
        setOverviewHintVisible(false);
        exitCrossfadeThen(() => {
          if (!isMounted) return;
          if (waypointRing) {
            waypointRing.position.set(pt.x, 0.015, pt.z);
            waypointRing.visible = true;
          }
          const pathInfo = buildTransitionPath(camPos, pt);
          moveStartPos = camPos.clone();
          moveEndPos = pt;
          moveCurve = pathInfo.curve;
          moveIsCrossRoom = pathInfo.isCrossRoom;
          moveStartYaw = camYaw;
          moveEndYaw = camYaw;
          moveStartPitch = camPitch;
          moveEndPitch = 0;
          const pathLen = moveCurve ? moveCurve.getLength() : moveStartPos.distanceTo(moveEndPos);
          moveDuration = clamp(0.6 + pathLen * 0.22, 0.6, 1.6);
          moveElapsed = 0;
          moveTargetEntry = null;
          focusedEntry = null;
          camState = "moving";
          updateRoomBadge();
          updateNavArrowsState();
          requestRender();
          if (callbacks.onLeaveArtwork) callbacks.onLeaveArtwork();
        });
      }
    }
  }

  function onWindowResize() {
    if (!isMounted || !renderer || !camera) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    requestRender();
    if (camState === "focused" && focusedEntry) {
      alignCrossfadeOverlay(focusedEntry);
    }
  }

  function onKeyDown(e) {
    if (!isMounted) return;
    if (window.PlatenkoDetailModal && window.PlatenkoDetailModal.isOpen()) return;
    if (window.PlatenkoARViewer && window.PlatenkoARViewer.isOpen()) return;

    if (tourActive && (e.key === "Escape" || e.key.startsWith("Arrow"))) {
      stopTour();
    }
    if (e.key === "ArrowRight") { e.preventDefault(); stepArtwork(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); stepArtwork(-1); }
    else if (e.key === "Escape") { close(); }
    else {
      const isMoveKey = e.code === "KeyW" || e.code === "KeyS" || e.code === "KeyA" || e.code === "KeyD" || e.code === "ArrowUp" || e.code === "ArrowDown";
      keysDown.add(e.code);
      if (isMoveKey) {
        setOverviewHintVisible(false);
        requestRender();
        if (camState === "focused") {
          exitCrossfadeThen(() => {
            if (!isMounted) return;
            camState = "free";
            focusedEntry = null;
            moveTargetEntry = null;
            updateRoomBadge();
            updateNavArrowsState();
            if (callbacks.onLeaveArtwork) callbacks.onLeaveArtwork();
          });
        }
      }
    }
  }

  function onKeyUp(e) {
    keysDown.delete(e.code);
  }

  // ---- Public Open / Close / Focus ----
  async function open(artworks, opts) {
    cacheDom();
    if (!el.root) return;

    artworksList = Array.isArray(artworks) ? artworks : [];
    callbacks = opts || {};

    if (isMounted) {
      if (opts && opts.initialArtworkId) focusArtworkById(opts.initialArtworkId);
      return;
    }

    el.root.hidden = false;
    el.loading.hidden = false;
    document.body.style.overflow = "hidden";

    // Mobile default: collapsed menu so art fills the screen
    if (el.topControls) el.topControls.classList.remove("mobile-open");
    if (el.mobileMenuBtn) el.mobileMenuBtn.setAttribute("aria-expanded", "false");

    try {
      if (!THREE) {
        THREE = await import("three");
      }

      isMounted = true;
      disposables = [];

      const isTouchDevice = Boolean(
        (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) ||
        (navigator.maxTouchPoints && navigator.maxTouchPoints > 0)
      );
      renderer = new THREE.WebGLRenderer({ antialias: !isTouchDevice, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouchDevice ? 1.5 : 2));
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;

      el.canvasHost.innerHTML = "";
      el.canvasHost.appendChild(renderer.domElement);

      scene = new THREE.Scene();
      scene.background = new THREE.Color(0xF5F5F2);
      scene.fog = new THREE.Fog(0xF5F5F2, 18, 42);

      camera = new THREE.PerspectiveCamera(56, window.innerWidth / window.innerHeight, 0.1, 60);
      camPos = new THREE.Vector3(0, EYE_HEIGHT, -1.1);
      camYaw = 0;
      camPitch = -0.02;
      camState = "free";
      focusedEntry = null;
      moveTargetEntry = null;
      moveCurve = null;
      moveIsCrossRoom = false;
      syncCameraTransform();

      buildArchitecture();

      // Bind DOM & window events
      renderer.domElement.addEventListener("pointerdown", onStagePointerDown);
      window.addEventListener("pointermove", onStagePointerMove);
      window.addEventListener("pointerup", onStagePointerUp);
      window.addEventListener("pointercancel", onStagePointerUp);
      window.addEventListener("resize", onWindowResize);
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);
      document.addEventListener("visibilitychange", onVisibilityChange);

      el.loading.hidden = true;
      lastFrameTime = 0;
      requestRender();

      const targetId = opts && opts.initialArtworkId;
      const targetEntry = targetId ? entries.find((e) => e.art.id === targetId) : null;
      if (targetEntry) {
        setOverviewHintVisible(false);
        updateTextureWindow(targetEntry.index);
        navigateToEntry(targetEntry, true);
      } else {
        hidePlaque();
        updateTextureWindow(0);
        updateRoomBadge();
        updateNavArrowsState();
        setOverviewHintVisible(entries.length > 0);
      }
    } catch (err) {
      console.error("3D Gallery init failed:", err);
      el.loading.hidden = true;
      close();
      if (window.PlatenkoApp && window.PlatenkoApp.showToast) {
        window.PlatenkoApp.showToast("Nepodarilo sa spustiť 3D WebGL galériu.");
      }
    }
  }

  function focusArtworkById(id) {
    if (!isMounted || !id) return;
    const found = entries.find((e) => e.art.id === id);
    if (found) navigateToEntry(found, false);
  }

  function close() {
    if (!isMounted && el.root && el.root.hidden) return;
    stopTour();
    clearTimeout(exitTimerId);
    exitTimerId = null;
    crossfadeToken++;
    crossfadeVisible = false;
    isMounted = false;

    if (animRafId) {
      cancelAnimationFrame(animRafId);
      animRafId = null;
    }

    if (renderer && renderer.domElement) {
      renderer.domElement.removeEventListener("pointerdown", onStagePointerDown);
    }
    window.removeEventListener("pointermove", onStagePointerMove);
    window.removeEventListener("pointerup", onStagePointerUp);
    window.removeEventListener("pointercancel", onStagePointerUp);
    window.removeEventListener("resize", onWindowResize);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    keysDown.clear();
    needsRender = false;
    inAnimate = false;

    // Strict WebGL Memory Hygiene: dispose all geometries, materials, textures & renderer
    entries.forEach((e) => {
      if (e.loadedTexture) {
        try { e.loadedTexture.dispose(); } catch {}
        e.loadedTexture = null;
      }
    });
    disposables.forEach((res) => {
      if (res && typeof res.dispose === "function") {
        try { res.dispose(); } catch {}
      }
    });
    disposables = [];
    entries = [];
    raycastMeshes = [];
    floorMesh = null;
    waypointRing = null;
    sharedFrameOuterMat = null;
    sharedFrameRecessMat = null;
    focusedEntry = null;
    moveTargetEntry = null;
    moveCurve = null;
    moveIsCrossRoom = false;

    if (renderer) {
      try { renderer.dispose(); } catch {}
      try { renderer.forceContextLoss(); } catch {}
      renderer = null;
    }
    scene = null;
    camera = null;

    if (el.crossfadeImg) {
      el.crossfadeImg.style.opacity = "0";
      el.crossfadeImg.removeAttribute("src");
    }
    if (el.canvasHost) el.canvasHost.innerHTML = "";
    if (el.plaque) el.plaque.hidden = true;
    if (el.overviewHint) el.overviewHint.hidden = true;
    if (el.root) el.root.hidden = true;

    if (document.fullscreenElement && document.exitFullscreen) {
      try { document.exitFullscreen(); } catch {}
    }
    document.body.style.overflow = "";
    if (callbacks.onClose) callbacks.onClose();
  }

  function isOpen() {
    return isMounted;
  }

  // ---- Static UI Bindings ----
  let bindingsDone = false;
  function initBindings() {
    if (bindingsDone) return;
    bindingsDone = true;
    cacheDom();
    if (!el.root) return;

    if (el.backBtn) el.backBtn.addEventListener("click", close);
    if (el.prevBtn) el.prevBtn.addEventListener("click", () => stepArtwork(-1));
    if (el.nextBtn) el.nextBtn.addEventListener("click", () => stepArtwork(1));
    if (el.tourBtn) el.tourBtn.addEventListener("click", startTour);
    if (el.stopTourBtn) el.stopTourBtn.addEventListener("click", stopTour);

    if (el.mobileMenuBtn && el.topControls) {
      el.mobileMenuBtn.addEventListener("click", () => {
        const nextOpen = !el.topControls.classList.contains("mobile-open");
        el.topControls.classList.toggle("mobile-open", nextOpen);
        el.mobileMenuBtn.setAttribute("aria-expanded", nextOpen ? "true" : "false");
      });
    }

    if (el.fullscreenBtn) {
      el.fullscreenBtn.addEventListener("click", () => {
        if (!document.fullscreenElement) {
          (el.root.requestFullscreen || el.root.webkitRequestFullscreen || (() => {})).call(el.root);
        } else if (document.exitFullscreen) {
          document.exitFullscreen();
        }
      });
    }

    if (el.detailBtn) {
      el.detailBtn.addEventListener("click", () => {
        if (focusedEntry && callbacks.onOpenDetail) {
          callbacks.onOpenDetail(focusedEntry.art);
        }
      });
    }
    if (el.arBtn) {
      el.arBtn.addEventListener("click", () => {
        if (focusedEntry && callbacks.onOpenAR) {
          callbacks.onOpenAR(focusedEntry.art);
        }
      });
    }
    if (el.shareBtn) {
      el.shareBtn.addEventListener("click", () => {
        if (focusedEntry && callbacks.onShare) {
          callbacks.onShare(focusedEntry.art, el.shareBtn);
        }
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initBindings);
  } else {
    initBindings();
  }

  window.Platenko3DGallery = { open, close, isOpen, focusArtworkById };
})();
