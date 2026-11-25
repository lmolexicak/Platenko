/**
 * Platenko Admin CMS - 3D Cover Mockup Studio
 * Always produces a non-destructive copy (add as album copy or set as cover).
 * Includes 3x magnified circular loupe + cursor-centered mouse-wheel zoom (1x-6x) & pan.
 */
(function () {
  "use strict";

  const CORNER_CONFIG = [
    { label: "1: Hore-Vľavo", color: "#3b82f6" },
    { label: "2: Hore-Vpravo", color: "#10b981" },
    { label: "3: Dole-Vpravo", color: "#f59e0b" },
    { label: "4: Dole-Vľavo", color: "#ef4444" },
  ];

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  let studioImg = new Image();
  let corners = [];
  let activeCornerIdx = -1;
  let canvasScale = 1;
  let onApplyCb = null;

  // Mouse-wheel zoom & pan state on pinningCanvas
  let viewZoom = 1;
  let viewPanX = 0;
  let viewPanY = 0;
  let isPanning = false;
  let panStartDx = 0;
  let panStartDy = 0;
  let panOriginX = 0;
  let panOriginY = 0;

  const ui = {};
  function cacheUi() {
    if (ui.modal) return;
    ui.modal = document.getElementById("coverStudioModal");
    ui.closeBtn = document.getElementById("coverStudioCloseBtn");
    ui.cancelBtn = document.getElementById("coverStudioCancelBtn");
    ui.detectBtn = document.getElementById("detectCornersBtn");
    ui.resetBtn = document.getElementById("resetCornersBtn");
    ui.zoomOutBtn = document.getElementById("coverZoomOutBtn");
    ui.zoomResetBtn = document.getElementById("coverZoomResetBtn");
    ui.zoomInBtn = document.getElementById("coverZoomInBtn");
    ui.pinningCanvas = document.getElementById("pinningCanvas");
    ui.previewCanvas = document.getElementById("previewCanvas");
    ui.loupeCanvas = document.getElementById("coverLoupeCanvas");
    ui.applyCopyBtn = document.getElementById("coverApplyCopyBtn");
    ui.applyCoverBtn = document.getElementById("coverApplyCoverBtn");
  }

  function updateZoomUI() {
    if (ui.zoomResetBtn) {
      ui.zoomResetBtn.textContent = `${Math.round(viewZoom * 100)}%`;
    }
    if (ui.pinningCanvas) {
      ui.pinningCanvas.style.cursor = viewZoom > 1.01 ? "grab" : "crosshair";
    }
  }

  function clampPan() {
    if (!ui.pinningCanvas) return;
    const pw = ui.pinningCanvas.width;
    const ph = ui.pinningCanvas.height;
    viewPanX = clamp(viewPanX, pw - pw * viewZoom, 0);
    viewPanY = clamp(viewPanY, ph - ph * viewZoom, 0);
  }

  function resetZoom() {
    viewZoom = 1;
    viewPanX = 0;
    viewPanY = 0;
    updateZoomUI();
  }

  function pinToDisp(pt) {
    return {
      x: pt.x * viewZoom + viewPanX,
      y: pt.y * viewZoom + viewPanY,
    };
  }

  function dispToPin(dx, dy) {
    const pw = ui.pinningCanvas ? ui.pinningCanvas.width : 800;
    const ph = ui.pinningCanvas ? ui.pinningCanvas.height : 600;
    return {
      x: clamp((dx - viewPanX) / viewZoom, 0, pw),
      y: clamp((dy - viewPanY) / viewZoom, 0, ph),
    };
  }

  function applyZoomAt(nextZoom, pivotDx, pivotDy) {
    const oldZ = viewZoom;
    const clampedZ = clamp(nextZoom, 1, 6);
    if (clampedZ <= 1.02) {
      resetZoom();
      drawPinningCanvas();
      return;
    }
    const anchorPinX = (pivotDx - viewPanX) / oldZ;
    const anchorPinY = (pivotDy - viewPanY) / oldZ;

    viewZoom = clampedZ;
    viewPanX = pivotDx - anchorPinX * clampedZ;
    viewPanY = pivotDy - anchorPinY * clampedZ;
    clampPan();
    updateZoomUI();
    drawPinningCanvas();
  }

  function renderMagnifiedLoupe(pinPt, clientX, clientY) {
    if (!ui.loupeCanvas || !studioImg.complete || studioImg.naturalWidth === 0) return;
    const loupeSize = 128;
    const zoomFactor = 3 * Math.min(2, viewZoom);
    const pinHalf = loupeSize / (2 * zoomFactor);
    const imgPtX = pinPt.x / Math.max(1e-6, canvasScale);
    const imgPtY = pinPt.y / Math.max(1e-6, canvasScale);
    const srcHalf = pinHalf / Math.max(1e-6, canvasScale);

    ui.loupeCanvas.width = loupeSize;
    ui.loupeCanvas.height = loupeSize;
    ui.loupeCanvas.style.display = "block";

    const left = Math.max(10, Math.min(window.innerWidth - loupeSize - 10, clientX - loupeSize - 24));
    const top = Math.max(10, Math.min(window.innerHeight - loupeSize - 10, clientY - loupeSize - 24));
    ui.loupeCanvas.style.left = `${left}px`;
    ui.loupeCanvas.style.top = `${top}px`;

    const ctx = ui.loupeCanvas.getContext("2d");
    ctx.fillStyle = "#18181B";
    ctx.fillRect(0, 0, loupeSize, loupeSize);
    ctx.drawImage(
      studioImg,
      imgPtX - srcHalf,
      imgPtY - srcHalf,
      srcHalf * 2,
      srcHalf * 2,
      0,
      0,
      loupeSize,
      loupeSize
    );

    const c = loupeSize / 2;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(c - 14, c);
    ctx.lineTo(c + 14, c);
    ctx.moveTo(c, c - 14);
    ctx.lineTo(c, c + 14);
    ctx.stroke();
  }

  function hideLoupe() {
    if (ui.loupeCanvas) ui.loupeCanvas.style.display = "none";
  }

  function resetCornersToDefault() {
    if (!ui.pinningCanvas) return;
    const w = ui.pinningCanvas.width;
    const h = ui.pinningCanvas.height;
    const padX = w * 0.12;
    const padY = h * 0.12;
    corners = [
      { x: padX, y: padY },
      { x: w - padX, y: padY },
      { x: w - padX, y: h - padY },
      { x: padX, y: h - padY },
    ];
  }

  function autoDetectCanvasEdges() {
    try {
      const w = ui.pinningCanvas.width;
      const h = ui.pinningCanvas.height;
      const off = document.createElement("canvas");
      off.width = w;
      off.height = h;
      const ctx = off.getContext("2d");
      ctx.drawImage(studioImg, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;

      const gray = new Float32Array(w * h);
      for (let i = 0; i < data.length; i += 4) {
        gray[i / 4] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      }

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

      const c0 = findEdge(w * 0.04, h * 0.04, cx, cy);
      const c1 = findEdge(w * 0.96, h * 0.04, cx, cy);
      const c2 = findEdge(w * 0.96, h * 0.96, cx, cy);
      const c3 = findEdge(w * 0.04, h * 0.96, cx, cy);
      const area = Math.abs((c1.x - c0.x) * (c3.y - c0.y) - (c3.x - c0.x) * (c1.y - c0.y));
      if (area > w * h * 0.25) {
        corners = [c0, c1, c2, c3];
      }
    } catch {
      // ignore if cross-origin
    }
    drawPinningCanvas();
  }

  function setupPinningCanvas() {
    const maxDim = 800;
    const imgRatio = studioImg.width / Math.max(1, studioImg.height);
    let w = maxDim;
    let h = w / imgRatio;
    if (imgRatio < 1) {
      h = maxDim;
      w = h * imgRatio;
    }
    ui.pinningCanvas.width = Math.round(w);
    ui.pinningCanvas.height = Math.round(h);
    canvasScale = ui.pinningCanvas.width / Math.max(1, studioImg.width);
    resetZoom();
    resetCornersToDefault();
    drawPinningCanvas();
  }

  function drawPinningCanvas() {
    if (!ui.pinningCanvas || !studioImg.complete) return;
    const ctx = ui.pinningCanvas.getContext("2d");
    const pw = ui.pinningCanvas.width;
    const ph = ui.pinningCanvas.height;

    ctx.clearRect(0, 0, pw, ph);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(studioImg, viewPanX, viewPanY, pw * viewZoom, ph * viewZoom);

    const dPts = corners.map(pinToDisp);

    // Dim area outside polygon cleanly using even-odd fill
    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.48)";
    ctx.beginPath();
    ctx.rect(0, 0, pw, ph);
    ctx.moveTo(dPts[0].x, dPts[0].y);
    ctx.lineTo(dPts[3].x, dPts[3].y);
    ctx.lineTo(dPts[2].x, dPts[2].y);
    ctx.lineTo(dPts[1].x, dPts[1].y);
    ctx.closePath();
    ctx.fill("evenodd");
    ctx.restore();

    ctx.strokeStyle = "#6366f1";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    dPts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    dPts.forEach((pt, idx) => {
      const cfg = CORNER_CONFIG[idx];
      const isCur = idx === activeCornerIdx;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, isCur ? 16 : 12, 0, Math.PI * 2);
      ctx.fillStyle = isCur ? "rgba(236, 72, 153, 0.4)" : "rgba(99, 102, 241, 0.3)";
      ctx.fill();

      ctx.beginPath();
      ctx.arc(pt.x, pt.y, isCur ? 12 : 9, 0, Math.PI * 2);
      ctx.fillStyle = cfg.color;
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 10px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(idx + 1), pt.x, pt.y);
    });
  }

  function drawTriangleWarp(ctx, img, s0, s1, s2, d0, d1, d2) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(d0.x, d0.y);
    ctx.lineTo(d1.x, d1.y);
    ctx.lineTo(d2.x, d2.y);
    ctx.closePath();
    ctx.clip();

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

  function warpPerspectiveGrid(ctx, img, p, w, h) {
    const GRID = 12;
    const interp = (c0, c1, c2, c3, u, v) => ({
      x: (1 - u) * (1 - v) * c0.x + u * (1 - v) * c1.x + u * v * c2.x + (1 - u) * v * c3.x,
      y: (1 - u) * (1 - v) * c0.y + u * (1 - v) * c1.y + u * v * c2.y + (1 - u) * v * c3.y,
    });

    for (let gy = 0; gy < GRID; gy++) {
      for (let gx = 0; gx < GRID; gx++) {
        const u0 = gx / GRID, u1 = (gx + 1) / GRID;
        const v0 = gy / GRID, v1 = (gy + 1) / GRID;
        const s00 = interp(p[0], p[1], p[2], p[3], u0, v0);
        const s10 = interp(p[0], p[1], p[2], p[3], u1, v0);
        const s11 = interp(p[0], p[1], p[2], p[3], u1, v1);
        const s01 = interp(p[0], p[1], p[2], p[3], u0, v1);
        const d00 = { x: u0 * w, y: v0 * h };
        const d10 = { x: u1 * w, y: v0 * h };
        const d11 = { x: u1 * w, y: v1 * h };
        const d01 = { x: u0 * w, y: v1 * h };
        drawTriangleWarp(ctx, img, s00, s10, s01, d00, d10, d01);
        drawTriangleWarp(ctx, img, s10, s11, s01, d10, d11, d01);
      }
    }
  }

  function generate3DPreview() {
    if (!ui.previewCanvas || !studioImg.complete || studioImg.naturalWidth === 0) return;
    const scale = 1 / canvasScale;
    const p = corners.map((c) => ({ x: c.x * scale, y: c.y * scale }));

    const topW = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);
    const botW = Math.hypot(p[2].x - p[3].x, p[2].y - p[3].y);
    const leftH = Math.hypot(p[3].x - p[0].x, p[3].y - p[0].y);
    const rightH = Math.hypot(p[2].x - p[1].x, p[2].y - p[1].y);

    const targetW = Math.round(Math.max(topW, botW, 300));
    const targetH = Math.round(Math.max(leftH, rightH, 300));

    const warpedCanvas = document.createElement("canvas");
    warpedCanvas.width = targetW;
    warpedCanvas.height = targetH;
    warpPerspectiveGrid(warpedCanvas.getContext("2d"), studioImg, p, targetW, targetH);

    const outW = 800;
    const outH = 1060;
    ui.previewCanvas.width = outW;
    ui.previewCanvas.height = outH;
    const pCtx = ui.previewCanvas.getContext("2d");

    pCtx.save();
    const bgScale = Math.max(outW / warpedCanvas.width, outH / warpedCanvas.height) * 1.35;
    const bgW = warpedCanvas.width * bgScale;
    const bgH = warpedCanvas.height * bgScale;
    if ("filter" in pCtx) {
      pCtx.filter = "blur(35px) brightness(1.2) saturate(1.15)";
    }
    pCtx.drawImage(warpedCanvas, (outW - bgW) / 2, (outH - bgH) / 2, bgW, bgH);
    pCtx.restore();

    const grad = pCtx.createRadialGradient(outW / 2, outH / 2, 80, outW / 2, outH / 2, outW * 0.8);
    grad.addColorStop(0, "rgba(255, 255, 255, 0.22)");
    grad.addColorStop(1, "rgba(255, 255, 255, 0.45)");
    pCtx.fillStyle = grad;
    pCtx.fillRect(0, 0, outW, outH);

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
    pCtx.shadowColor = "rgba(0, 0, 0, 0.45)";
    pCtx.shadowBlur = 35;
    pCtx.shadowOffsetX = 0;
    pCtx.shadowOffsetY = 16;
    pCtx.drawImage(warpedCanvas, artX, artY, artW, artH);
    pCtx.shadowColor = "rgba(0, 0, 0, 0.25)";
    pCtx.shadowBlur = 8;
    pCtx.shadowOffsetY = 4;
    pCtx.drawImage(warpedCanvas, artX, artY, artW, artH);
    pCtx.restore();

    pCtx.strokeStyle = "rgba(255, 255, 255, 0.45)";
    pCtx.lineWidth = 1.5;
    pCtx.strokeRect(artX, artY, artW, artH);
  }

  function createThumbDataUrl(srcCanvas, maxDim = 600, quality = 0.8) {
    const w = srcCanvas.width;
    const h = srcCanvas.height;
    const maxSide = Math.max(w, h);
    if (!maxSide) return null;
    const scale = maxSide > maxDim ? maxDim / maxSide : 1;
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));
    const tmp = document.createElement("canvas");
    tmp.width = tw;
    tmp.height = th;
    const tctx = tmp.getContext("2d");
    tctx.imageSmoothingEnabled = true;
    tctx.imageSmoothingQuality = "high";
    tctx.drawImage(srcCanvas, 0, 0, tw, th);
    return tmp.toDataURL("image/jpeg", quality);
  }

  function exportMockup(setAsCover) {
    if (!ui.previewCanvas) return;
    const hiresDataUrl = ui.previewCanvas.toDataURL("image/jpeg", 0.94);
    const thumbDataUrl = createThumbDataUrl(ui.previewCanvas, 600, 0.8);
    const cb = onApplyCb;
    close();
    if (typeof cb === "function") {
      cb({ hiresDataUrl, thumbDataUrl, setAsCover: Boolean(setAsCover) });
    }
  }

  function open({ imageSrc, onApply }) {
    cacheUi();
    if (!ui.modal || !imageSrc) return;
    onApplyCb = onApply || null;

    studioImg = new Image();
    studioImg.crossOrigin = "anonymous";
    studioImg.onload = () => {
      setupPinningCanvas();
      autoDetectCanvasEdges();
      generate3DPreview();
      ui.modal.classList.add("open");
      document.body.style.overflow = "hidden";
    };
    studioImg.onerror = () => {
      alert("Nepodarilo sa načítať obrázok pre 3D Cover Studio.");
    };
    studioImg.src = imageSrc;
  }

  function close() {
    if (!ui.modal) return;
    ui.modal.classList.remove("open");
    document.body.style.overflow = "";
    hideLoupe();
    activeCornerIdx = -1;
    isPanning = false;
  }

  document.addEventListener("DOMContentLoaded", () => {
    cacheUi();
    if (!ui.modal) return;

    if (ui.closeBtn) ui.closeBtn.addEventListener("click", close);
    if (ui.cancelBtn) ui.cancelBtn.addEventListener("click", close);
    ui.modal.addEventListener("click", (e) => {
      if (e.target === ui.modal) close();
    });

    if (ui.resetBtn) {
      ui.resetBtn.addEventListener("click", () => {
        resetZoom();
        resetCornersToDefault();
        drawPinningCanvas();
        generate3DPreview();
      });
    }
    if (ui.detectBtn) {
      ui.detectBtn.addEventListener("click", () => {
        resetZoom();
        autoDetectCanvasEdges();
        generate3DPreview();
      });
    }
    if (ui.zoomOutBtn && ui.pinningCanvas) {
      ui.zoomOutBtn.addEventListener("click", () => applyZoomAt(viewZoom / 1.35, ui.pinningCanvas.width / 2, ui.pinningCanvas.height / 2));
    }
    if (ui.zoomInBtn && ui.pinningCanvas) {
      ui.zoomInBtn.addEventListener("click", () => applyZoomAt(viewZoom * 1.35, ui.pinningCanvas.width / 2, ui.pinningCanvas.height / 2));
    }
    if (ui.zoomResetBtn) {
      ui.zoomResetBtn.addEventListener("click", () => {
        resetZoom();
        drawPinningCanvas();
      });
    }

    if (ui.applyCopyBtn) ui.applyCopyBtn.addEventListener("click", () => exportMockup(false));
    if (ui.applyCoverBtn) ui.applyCoverBtn.addEventListener("click", () => exportMockup(true));

    if (ui.pinningCanvas) {
      const getDispPos = (e) => {
        const rect = ui.pinningCanvas.getBoundingClientRect();
        return {
          x: ((e.clientX - rect.left) / Math.max(1, rect.width)) * ui.pinningCanvas.width,
          y: ((e.clientY - rect.top) / Math.max(1, rect.height)) * ui.pinningCanvas.height,
        };
      };

      ui.pinningCanvas.addEventListener("wheel", (e) => {
        e.preventDefault();
        const disp = getDispPos(e);
        const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
        applyZoomAt(viewZoom * factor, disp.x, disp.y);
      }, { passive: false });

      ui.pinningCanvas.addEventListener("pointerdown", (e) => {
        const disp = getDispPos(e);
        let bestIdx = -1;
        let bestD = Infinity;
        corners.forEach((pt, idx) => {
          const dp = pinToDisp(pt);
          const d = Math.hypot(dp.x - disp.x, dp.y - disp.y);
          if (d <= 22 && d < bestD) {
            bestD = d;
            bestIdx = idx;
          }
        });

        if (bestIdx !== -1) {
          activeCornerIdx = bestIdx;
          isPanning = false;
          try { ui.pinningCanvas.setPointerCapture(e.pointerId); } catch {}
          renderMagnifiedLoupe(corners[bestIdx], e.clientX, e.clientY);
        } else if (viewZoom > 1.01) {
          isPanning = true;
          panStartDx = disp.x;
          panStartDy = disp.y;
          panOriginX = viewPanX;
          panOriginY = viewPanY;
          ui.pinningCanvas.style.cursor = "grabbing";
          try { ui.pinningCanvas.setPointerCapture(e.pointerId); } catch {}
        }
      });

      ui.pinningCanvas.addEventListener("pointermove", (e) => {
        const disp = getDispPos(e);
        if (activeCornerIdx !== -1) {
          const pinPt = dispToPin(disp.x, disp.y);
          corners[activeCornerIdx] = pinPt;
          drawPinningCanvas();
          renderMagnifiedLoupe(pinPt, e.clientX, e.clientY);
          generate3DPreview();
        } else if (isPanning) {
          viewPanX = panOriginX + (disp.x - panStartDx);
          viewPanY = panOriginY + (disp.y - panStartDy);
          clampPan();
          drawPinningCanvas();
        }
      });

      const stop = () => {
        if (activeCornerIdx !== -1) {
          activeCornerIdx = -1;
          hideLoupe();
          drawPinningCanvas();
          generate3DPreview();
        }
        if (isPanning) {
          isPanning = false;
          updateZoomUI();
        }
      };
      ui.pinningCanvas.addEventListener("pointerup", stop);
      ui.pinningCanvas.addEventListener("pointercancel", stop);
    }
  });

  window.PlatenkoCoverStudio = { open, close };
})();
