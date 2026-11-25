/**
 * Platenko Admin CMS - Interactive 4-Point Projective Homography & Crop Tool
 * Rectifies angled photos into flat rectangles while keeping original photos untouched.
 * Supports 90-degree rotations, -15..+15 deg fine rotation, Swapped/Free/Dimension aspect ratios, and 3x loupe.
 */
(function () {
  "use strict";

  const CORNER_META = [
    { label: "1", color: "#3b82f6" },
    { label: "2", color: "#10b981" },
    { label: "3", color: "#f59e0b" },
    { label: "4", color: "#ef4444" },
  ];

  function computeHomography(dstPts, srcPts) {
    const A = [];
    const b = [];
    for (let i = 0; i < 4; i++) {
      const dx = dstPts[i].x;
      const dy = dstPts[i].y;
      const sx = srcPts[i].x;
      const sy = srcPts[i].y;
      A.push([dx, dy, 1, 0, 0, 0, -dx * sx, -dy * sx]);
      b.push(sx);
      A.push([0, 0, 0, dx, dy, 1, -dx * sy, -dy * sy]);
      b.push(sy);
    }

    const n = 8;
    for (let col = 0; col < n; col++) {
      let maxRow = col;
      let maxVal = Math.abs(A[col][col]);
      for (let r = col + 1; r < n; r++) {
        const val = Math.abs(A[r][col]);
        if (val > maxVal) {
          maxVal = val;
          maxRow = r;
        }
      }
      if (maxRow !== col) {
        [A[col], A[maxRow]] = [A[maxRow], A[col]];
        [b[col], b[maxRow]] = [b[maxRow], b[col]];
      }
      const pivot = A[col][col];
      if (Math.abs(pivot) < 1e-10) return null;

      for (let r = col + 1; r < n; r++) {
        const factor = A[r][col] / pivot;
        if (factor === 0) continue;
        for (let c = col; c < n; c++) {
          A[r][c] -= factor * A[col][c];
        }
        b[r] -= factor * b[col];
      }
    }

    const h = new Array(n);
    for (let r = n - 1; r >= 0; r--) {
      let sum = b[r];
      for (let c = r + 1; c < n; c++) {
        sum -= A[r][c] * h[c];
      }
      h[r] = sum / A[r][r];
    }
    return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  }

  function warpPerspectiveCanvas(srcCanvas, quadPts, outW, outH) {
    const outCanvas = document.createElement("canvas");
    outCanvas.width = outW;
    outCanvas.height = outH;
    const outCtx = outCanvas.getContext("2d");

    const srcW = srcCanvas.width;
    const srcH = srcCanvas.height;
    const srcCtx = srcCanvas.getContext("2d");
    const srcData = srcCtx.getImageData(0, 0, srcW, srcH).data;
    const outImg = outCtx.createImageData(outW, outH);
    const dst = outImg.data;

    const dstQuad = [
      { x: 0, y: 0 },
      { x: outW, y: 0 },
      { x: outW, y: outH },
      { x: 0, y: outH },
    ];
    const H = computeHomography(dstQuad, quadPts);
    if (!H) {
      outCtx.drawImage(srcCanvas, 0, 0, outW, outH);
      return outCanvas;
    }

    const h0 = H[0], h1 = H[1], h2 = H[2];
    const h3 = H[3], h4 = H[4], h5 = H[5];
    const h6 = H[6], h7 = H[7];

    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        const denom = h6 * x + h7 * y + 1;
        if (Math.abs(denom) < 1e-6) continue;
        const sx = (h0 * x + h1 * y + h2) / denom;
        const sy = (h3 * x + h4 * y + h5) / denom;

        const x0 = Math.floor(sx);
        const y0 = Math.floor(sy);
        if (x0 < 0 || y0 < 0 || x0 >= srcW - 1 || y0 >= srcH - 1) continue;

        const fx = sx - x0;
        const fy = sy - y0;
        const w00 = (1 - fx) * (1 - fy);
        const w10 = fx * (1 - fy);
        const w01 = (1 - fx) * fy;
        const w11 = fx * fy;

        const i00 = (y0 * srcW + x0) * 4;
        const i10 = i00 + 4;
        const i01 = i00 + srcW * 4;
        const i11 = i01 + 4;
        const outIdx = (y * outW + x) * 4;

        dst[outIdx]     = srcData[i00] * w00 + srcData[i10] * w10 + srcData[i01] * w01 + srcData[i11] * w11;
        dst[outIdx + 1] = srcData[i00 + 1] * w00 + srcData[i10 + 1] * w10 + srcData[i01 + 1] * w01 + srcData[i11 + 1] * w11;
        dst[outIdx + 2] = srcData[i00 + 2] * w00 + srcData[i10 + 2] * w10 + srcData[i01 + 2] * w01 + srcData[i11 + 2] * w11;
        dst[outIdx + 3] = 255;
      }
    }

    outCtx.putImageData(outImg, 0, 0);
    return outCanvas;
  }

  function downscaleCanvasToJpeg(srcCanvas, maxDim, quality) {
    const w = srcCanvas.width;
    const h = srcCanvas.height;
    const maxSide = Math.max(w, h);
    const scale = maxSide > maxDim ? maxDim / maxSide : 1;
    const nw = Math.max(1, Math.round(w * scale));
    const nh = Math.max(1, Math.round(h * scale));
    const tmp = document.createElement("canvas");
    tmp.width = nw;
    tmp.height = nh;
    const ctx = tmp.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(srcCanvas, 0, 0, nw, nh);
    return tmp.toDataURL("image/jpeg", quality);
  }

  // ---- Interactive UI State ----
  const state = {
    img: null,
    rotatedCanvas: null,
    rotW: 0,
    rotH: 0,
    baseQuarterTurns: 0,
    rotationDeg: 0,
    corners: [],
    widthCm: 50,
    heightCm: 70,
    aspectMode: "free", // "free" (derived from 4 corners) | "dims" (locked to widthCm x heightCm)
    isNewUpload: true,
    onApply: null,
    onSwapDims: null,
    activeCorner: -1,
    dispScale: 1,
    previewTimer: null,
  };

  const ui = {};
  function cacheUi() {
    if (ui.modal) return;
    ui.modal = document.getElementById("warpModal");
    ui.sourceCanvas = document.getElementById("warpSourceCanvas");
    ui.previewCanvas = document.getElementById("warpPreviewCanvas");
    ui.loupeCanvas = document.getElementById("warpLoupeCanvas");
    ui.rotSlider = document.getElementById("warpRotationSlider");
    ui.rotLabel = document.getElementById("warpRotationValue");
    ui.rotLeftBtn = document.getElementById("warpRotLeftBtn");
    ui.rotRightBtn = document.getElementById("warpRotRightBtn");
    ui.swapAspectBtn = document.getElementById("warpSwapAspectBtn");
    ui.aspectMode = document.getElementById("warpAspectMode");
    ui.aspectLabel = document.getElementById("warpAspectLabel");
    ui.resetBtn = document.getElementById("warpResetBtn");
    ui.cancelBtn = document.getElementById("warpCancelBtn");
    ui.closeBtn = document.getElementById("warpCloseBtn");
    ui.applyBtn = document.getElementById("warpApplyBtn");
  }

  function getOutputRatio() {
    if (state.aspectMode === "dims") {
      return state.widthCm / state.heightCm;
    }
    if (state.corners.length === 4) {
      const p = state.corners;
      const topW = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);
      const botW = Math.hypot(p[2].x - p[3].x, p[2].y - p[3].y);
      const leftH = Math.hypot(p[3].x - p[0].x, p[3].y - p[0].y);
      const rightH = Math.hypot(p[2].x - p[1].x, p[2].y - p[1].y);
      const avgW = (topW + botW) * 0.5;
      const avgH = Math.max(10, (leftH + rightH) * 0.5);
      return avgW / avgH;
    }
    return state.widthCm / state.heightCm;
  }

  function updateAspectLabel() {
    if (!ui.aspectLabel) return;
    if (state.aspectMode === "dims") {
      ui.aspectLabel.textContent = `Cieľový pomer: ${state.widthCm} × ${state.heightCm} cm`;
    } else {
      const ratio = getOutputRatio();
      ui.aspectLabel.textContent = `Voľný pomer podľa rohov (${ratio.toFixed(2)}:1)`;
    }
  }

  function buildRotatedSourceCanvas() {
    if (!state.img) return;
    const srcW = state.img.naturalWidth;
    const srcH = state.img.naturalHeight;
    const maxWork = 1600;
    const workScale = Math.max(srcW, srcH) > maxWork ? maxWork / Math.max(srcW, srcH) : 1;
    const w = Math.max(1, Math.round(srcW * workScale));
    const h = Math.max(1, Math.round(srcH * workScale));

    const totalDeg = state.baseQuarterTurns * 90 + state.rotationDeg;
    const rad = (totalDeg * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const rw = Math.max(2, Math.round(w * cos + h * sin));
    const rh = Math.max(2, Math.round(w * sin + h * cos));

    const canvas = document.createElement("canvas");
    canvas.width = rw;
    canvas.height = rh;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#18181B";
    ctx.fillRect(0, 0, rw, rh);
    ctx.translate(rw / 2, rh / 2);
    ctx.rotate(rad);
    ctx.drawImage(state.img, -w / 2, -h / 2, w, h);

    state.rotatedCanvas = canvas;
    state.rotW = rw;
    state.rotH = rh;
  }

  function resetCorners() {
    const padX = Math.round(state.rotW * 0.08);
    const padY = Math.round(state.rotH * 0.08);
    state.corners = [
      { x: padX, y: padY },
      { x: state.rotW - padX, y: padY },
      { x: state.rotW - padX, y: state.rotH - padY },
      { x: padX, y: state.rotH - padY },
    ];
  }

  function drawSourceOverlay() {
    if (!ui.sourceCanvas || !state.rotatedCanvas) return;
    const maxDispW = Math.min(640, Math.max(280, window.innerWidth - 80));
    const maxDispH = 440;
    const scale = Math.min(maxDispW / state.rotW, maxDispH / state.rotH, 1);
    state.dispScale = scale;

    const dw = Math.max(1, Math.round(state.rotW * scale));
    const dh = Math.max(1, Math.round(state.rotH * scale));
    ui.sourceCanvas.width = dw;
    ui.sourceCanvas.height = dh;

    const ctx = ui.sourceCanvas.getContext("2d");
    ctx.clearRect(0, 0, dw, dh);
    ctx.drawImage(state.rotatedCanvas, 0, 0, dw, dh);

    const dPts = state.corners.map((c) => ({ x: c.x * scale, y: c.y * scale }));

    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.52)";
    ctx.beginPath();
    ctx.rect(0, 0, dw, dh);
    ctx.moveTo(dPts[0].x, dPts[0].y);
    ctx.lineTo(dPts[3].x, dPts[3].y);
    ctx.lineTo(dPts[2].x, dPts[2].y);
    ctx.lineTo(dPts[1].x, dPts[1].y);
    ctx.closePath();
    ctx.fill("evenodd");
    ctx.restore();

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    dPts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();

    const lerpPt = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.lineWidth = 1;
    for (const t of [1 / 3, 2 / 3]) {
      const top = lerpPt(dPts[0], dPts[1], t);
      const bot = lerpPt(dPts[3], dPts[2], t);
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(bot.x, bot.y);
      ctx.stroke();

      const left = lerpPt(dPts[0], dPts[3], t);
      const right = lerpPt(dPts[1], dPts[2], t);
      ctx.beginPath();
      ctx.moveTo(left.x, left.y);
      ctx.lineTo(right.x, right.y);
      ctx.stroke();
    }

    dPts.forEach((p, idx) => {
      const meta = CORNER_META[idx];
      ctx.beginPath();
      ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
      ctx.fillStyle = meta.color;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(meta.label, p.x, p.y + 0.5);
    });
  }

  function renderMagnifiedLoupe(srcPt, clientX, clientY) {
    if (!ui.loupeCanvas || !state.rotatedCanvas) return;
    const loupeSize = 128;
    const zoomFactor = 3;
    const srcSampleHalf = loupeSize / (2 * zoomFactor);

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
      state.rotatedCanvas,
      srcPt.x - srcSampleHalf,
      srcPt.y - srcSampleHalf,
      srcSampleHalf * 2,
      srcSampleHalf * 2,
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

  function renderLivePreview() {
    if (!ui.previewCanvas || !state.rotatedCanvas || state.corners.length !== 4) return;
    const ratio = getOutputRatio();
    const maxPrev = 340;
    const prevW = ratio >= 1 ? maxPrev : Math.max(60, Math.round(maxPrev * ratio));
    const prevH = ratio >= 1 ? Math.max(60, Math.round(maxPrev / ratio)) : maxPrev;

    const warped = warpPerspectiveCanvas(state.rotatedCanvas, state.corners, prevW, prevH);
    ui.previewCanvas.width = prevW;
    ui.previewCanvas.height = prevH;
    ui.previewCanvas.getContext("2d").drawImage(warped, 0, 0);
    updateAspectLabel();
  }

  function scheduleLivePreview() {
    if (state.previewTimer) clearTimeout(state.previewTimer);
    state.previewTimer = setTimeout(renderLivePreview, 25);
  }

  function open(opts) {
    cacheUi();
    if (!ui.modal || !opts || !opts.imageSrc) return;

    state.widthCm = Number(opts.widthCm) > 0 ? Number(opts.widthCm) : 50;
    state.heightCm = Number(opts.heightCm) > 0 ? Number(opts.heightCm) : 70;
    state.isNewUpload = Boolean(opts.isNewUpload);
    state.onApply = opts.onApply || null;
    state.onSwapDims = opts.onSwapDims || null;
    state.baseQuarterTurns = 0;
    state.rotationDeg = 0;

    if (ui.rotSlider) ui.rotSlider.value = "0";
    if (ui.rotLabel) ui.rotLabel.textContent = "0°";

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      state.img = img;
      // Default to "free" if aspect doesn't match portrait/landscape of widthCm x heightCm cleanly, else "dims"
      const imgLand = img.naturalWidth > img.naturalHeight * 1.05;
      const dimsLand = state.widthCm > state.heightCm * 1.05;
      state.aspectMode = imgLand === dimsLand ? "dims" : "free";
      if (ui.aspectMode) ui.aspectMode.value = state.aspectMode;

      buildRotatedSourceCanvas();
      resetCorners();
      drawSourceOverlay();
      renderLivePreview();
      ui.modal.classList.add("open");
      document.body.style.overflow = "hidden";
    };
    img.onerror = () => {
      alert("Nepodarilo sa načítať fotku do nástroja na vyrovnanie.");
    };
    img.src = opts.imageSrc;
  }

  function close() {
    if (!ui.modal) return;
    ui.modal.classList.remove("open");
    document.body.style.overflow = "";
    hideLoupe();
    state.activeCorner = -1;
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
        state.baseQuarterTurns = 0;
        state.rotationDeg = 0;
        if (ui.rotSlider) ui.rotSlider.value = "0";
        if (ui.rotLabel) ui.rotLabel.textContent = "0°";
        buildRotatedSourceCanvas();
        resetCorners();
        drawSourceOverlay();
        renderLivePreview();
      });
    }

    const rotateQuarter = (delta) => {
      state.baseQuarterTurns = (state.baseQuarterTurns + delta + 4) % 4;
      buildRotatedSourceCanvas();
      resetCorners();
      drawSourceOverlay();
      renderLivePreview();
    };
    if (ui.rotLeftBtn) ui.rotLeftBtn.addEventListener("click", () => rotateQuarter(-1));
    if (ui.rotRightBtn) ui.rotRightBtn.addEventListener("click", () => rotateQuarter(1));

    if (ui.swapAspectBtn) {
      ui.swapAspectBtn.addEventListener("click", () => {
        const tmp = state.widthCm;
        state.widthCm = state.heightCm;
        state.heightCm = tmp;
        state.aspectMode = "dims";
        if (ui.aspectMode) ui.aspectMode.value = "dims";
        if (typeof state.onSwapDims === "function") {
          state.onSwapDims(state.widthCm, state.heightCm);
        }
        renderLivePreview();
      });
    }

    if (ui.aspectMode) {
      ui.aspectMode.addEventListener("change", () => {
        state.aspectMode = ui.aspectMode.value === "dims" ? "dims" : "free";
        renderLivePreview();
      });
    }

    if (ui.rotSlider) {
      ui.rotSlider.addEventListener("input", () => {
        state.rotationDeg = parseFloat(ui.rotSlider.value) || 0;
        if (ui.rotLabel) ui.rotLabel.textContent = `${state.rotationDeg > 0 ? "+" : ""}${state.rotationDeg.toFixed(1)}°`;
        buildRotatedSourceCanvas();
        resetCorners();
        drawSourceOverlay();
        scheduleLivePreview();
      });
    }

    if (ui.sourceCanvas) {
      const getSourcePos = (e) => {
        const rect = ui.sourceCanvas.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * state.rotW;
        const y = ((e.clientY - rect.top) / rect.height) * state.rotH;
        return {
          x: Math.max(0, Math.min(state.rotW, x)),
          y: Math.max(0, Math.min(state.rotH, y)),
        };
      };

      ui.sourceCanvas.addEventListener("pointerdown", (e) => {
        const pos = getSourcePos(e);
        const hitDist = 28 / Math.max(0.1, state.dispScale);
        let bestIdx = -1;
        let bestD = Infinity;
        state.corners.forEach((c, idx) => {
          const d = Math.hypot(c.x - pos.x, c.y - pos.y);
          if (d < hitDist && d < bestD) {
            bestD = d;
            bestIdx = idx;
          }
        });
        if (bestIdx !== -1) {
          state.activeCorner = bestIdx;
          try { ui.sourceCanvas.setPointerCapture(e.pointerId); } catch {}
          renderMagnifiedLoupe(state.corners[bestIdx], e.clientX, e.clientY);
        }
      });

      ui.sourceCanvas.addEventListener("pointermove", (e) => {
        if (state.activeCorner === -1) return;
        const pos = getSourcePos(e);
        state.corners[state.activeCorner] = pos;
        drawSourceOverlay();
        renderMagnifiedLoupe(pos, e.clientX, e.clientY);
        scheduleLivePreview();
      });

      const stopDrag = () => {
        if (state.activeCorner !== -1) {
          state.activeCorner = -1;
          hideLoupe();
          renderLivePreview();
        }
      };
      ui.sourceCanvas.addEventListener("pointerup", stopDrag);
      ui.sourceCanvas.addEventListener("pointercancel", stopDrag);
    }

    if (ui.applyBtn) {
      ui.applyBtn.addEventListener("click", () => {
        if (!state.rotatedCanvas || !state.img) return;
        const ratio = getOutputRatio();
        const maxOut = 1800;
        const outW = ratio >= 1 ? maxOut : Math.max(200, Math.round(maxOut * ratio));
        const outH = ratio >= 1 ? Math.max(200, Math.round(maxOut / ratio)) : maxOut;

        const fullRectified = warpPerspectiveCanvas(state.rotatedCanvas, state.corners, outW, outH);
        const hiresDataUrl = fullRectified.toDataURL("image/jpeg", 0.92);
        const thumbDataUrl = downscaleCanvasToJpeg(fullRectified, 600, 0.8);

        let rawDataUrl = null;
        let rawThumbDataUrl = null;
        if (state.isNewUpload) {
          const rawCanvas = document.createElement("canvas");
          const nw = state.img.naturalWidth;
          const nh = state.img.naturalHeight;
          const maxRaw = 2000;
          const sc = Math.max(nw, nh) > maxRaw ? maxRaw / Math.max(nw, nh) : 1;
          rawCanvas.width = Math.max(1, Math.round(nw * sc));
          rawCanvas.height = Math.max(1, Math.round(nh * sc));
          rawCanvas.getContext("2d").drawImage(state.img, 0, 0, rawCanvas.width, rawCanvas.height);
          rawDataUrl = rawCanvas.toDataURL("image/jpeg", 0.88);
          rawThumbDataUrl = downscaleCanvasToJpeg(rawCanvas, 600, 0.8);
        }

        const cb = state.onApply;
        close();
        if (typeof cb === "function") {
          cb({ hiresDataUrl, thumbDataUrl, rawDataUrl, rawThumbDataUrl });
        }
      });
    }
  });

  window.PlatenkoPerspectiveWarp = { open, close };
})();
