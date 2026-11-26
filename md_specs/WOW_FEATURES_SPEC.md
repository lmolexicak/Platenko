# Plátenko Akryl — "Wow" Features Spec (WebAR 1:1, 3D Tour, 2D Crossfade & Deep-Linking)

## Project Context & Scope
This specification extends the existing **Plátenko Akryl** web application (deployed on Cloudflare Workers at `https://platenko.lm-olexicak.workers.dev/`) with high-impact, optional experiential features that elevate the gallery without cluttering the core 2D "White Cube" experience.

- **Focus:** Exclusively physical **acrylic paintings on stretched canvas**.
- **Strict Exclusions (Keep it Museum-Grade):**
  - Do NOT add photography/passepartout modes, EXIF parsers, or multi-profile switching.
  - Do NOT expose gamma, brightness, lighting, or floor-darkness sliders to public visitors (bake ideal, color-accurate museum lighting directly into the scene defaults).
  - Do NOT add generic visitor silhouettes, footstep sound effects, or auto-playing background music.
- **Language:** All UI copy, buttons, and prompts must be in clean, natural **Slovak**.

---

## Phase 0: Codebase Audit
Before writing code, inspect the existing repository (`package.json`, routing, and artwork data schema):
1. Verify how artworks store `id`, `dimensionsCm` (`width`, `height`, `depth`), `hiresImage`, and `webTextureImage`.
2. Check if `three` or any AR/QR libraries are already installed.
3. Report a brief readiness summary to the user before proceeding to Phase 1.

---

## Phase 1: Deep-Linking & "Zdieľať" (Share) System
Make every individual painting directly linkable from Instagram, Facebook, or messages:
1. **URL Query Synchronization:**
   - `/?dielo={id}` — opens the 2D catalog and immediately launches the Detail Modal for that painting.
   - `/?view=3d&dielo={id}` — opens the 3D gallery positioned directly in front of that painting.
   - `/?dielo={id}&ar=1` — launches the Mobile WebAR Wall Preview for that painting.
2. **Share Button ("Zdieľať"):**
   - Add a clean share icon/button in both the Artwork Detail Modal and the 3D Gallery painting plaque.
   - Use the native `navigator.share` API on mobile, with a 1-click "Odkaz skopírovaný" clipboard fallback on desktop.

---

## Phase 2: Mobile WebAR Wall Preview — True 1:1 Scale (`WallARViewer.tsx`)
Allow visitors to hang paintings on their own walls at exact physical dimensions:
1. **Desktop Experience:**
   - Clicking **"Vyskúšať na stene (AR)"** opens a clean modal with a dynamically generated **QR code** pointing to `/?dielo={id}&ar=1` so the user can scan it with their phone.
2. **Mobile 3-Tier Cross-Platform AR:**
   - **Tier 1 — Android Chrome (Native WebXR `immersive-ar` via Three.js):**
     - Vertical wall hit-test snapping with a subtle cm-dimension reticle.
     - **Locked 1:1 True Scale:** Render the canvas mesh in exact physical meters (`dimensionsCm / 100`), disable pinch-to-scale by default, and display a subtle badge: `"Mierka 1:1 uzamknutá ({W} × {H} cm)"`.
     - Support one-finger sliding along the wall, a toggleable edge ruler (`Zobraziť pravítko`), and a **"Pridať ďalší obraz"** drawer to test 2–3 smaller paintings side-by-side (diptych/triptych) with `5 cm` / `8 cm` / `12 cm` spacing.
   - **Tier 2 — iOS Safari (On-the-Fly `USDZExporter`):**
     - Dynamically generate a true-scale `.usdz` 3D stretched-canvas mesh in memory using `three`'s `USDZExporter` with `webTextureImage` and open Apple AR Quick Look with `#allowsContentScaling=0`.
   - **Tier 3 — Universal Fallback (Older Devices):**
     - Open rear camera (`getUserMedia`) with a perspective-adjustable painting overlay and **1-Tap Payment Card Calibration** (`8.56 × 5.40 cm`) held against the wall to lock accurate 1:1 scale.

---

## Phase 3: Minimalist 3D Virtual Gallery & "Automatická prehliadka (Tour)"
Build a clean, high-performance 3D gallery accessible via top navigation (`Katalóg` | `3D Galéria`) as an optional experiential showcase:
1. **Architectural Space (Three.js):**
   - Procedural minimalist "White Cube" gallery room(s) with matte off-white walls (`#F7F7F5`), subtle micro-cement floor, and clean ceiling track spotlights (`3500K` warm-neutral) aimed softly at the paintings without harsh glare bands.
   - Render paintings at exact real-world scale with realistic stretched-canvas side depth and soft contact shadows.
   - Ensure strict memory hygiene (dispose geometries, materials, and textures on unmount) and cap `pixelRatio` to `Math.min(window.devicePixelRatio, 2)` for locked 60 FPS.
2. **Smooth, Uncluttered Navigation:**
   - Desktop: Click paintings or floor waypoints, drag to look, `<` / `>` buttons for previous/next painting.
   - Mobile: Touch drag to look, `<` / `>` buttons, fullscreen toggle, and wall collision detection (prevent walking through walls). Keep menus collapsed by default on mobile so the art fills the screen.
3. **Guided Tour Mode ("Automatická prehliadka"):**
   - One-click Tour button that automatically collapses all UI menus, starts from the nearest painting, and smoothly glides the camera from painting to painting at a calm walking pace.
   - Pauses at each painting (default `5 seconds`) before moving to the next.
   - Displays only a minimal **`Stop Tour` + counter (`#1/N`)** pill in the bottom-left corner; any user touch/click interrupts the tour cleanly.

---

## Phase 4: Zoom-to-Fill & Glitch-Free 2D Photo Crossfade
Solve the biggest visual flaw of 3D galleries (3D lighting distorting true paint colors):
1. **Perpendicular Zoom-to-Fill:**
   - When arriving at a painting (via click, `<` / `>`, or Tour mode), smoothly align the camera perpendicular to the canvas, center it vertically on the painting's midpoint, and glide forward so the painting fills the viewport cleanly without cropping any edge.
2. **Seamless 2D Real-Photo Crossfade:**
   - Once the camera settles in front of the painting, smoothly crossfade (`opacity 0 -> 1` over ~300ms) a crisp 2D overlay of the real `hiresImage` aligned pixel-for-pixel over the 3D canvas. This guarantees 100% accurate colors and brushstroke sharpness.
   - Show a minimal floating action bar with **"Detail & Mierka"**, **"Vyskúšať v AR"**, and **"Zdieľať"**.
3. **Glitch-Free Exit:**
   - When the user navigates away or the Tour advances to the next painting, **first** smoothly crossfade the 2D overlay back to `0` while keeping the camera locked in place, and **only after** the crossfade completes, begin moving/rotating the camera to prevent any vertical jump or texture flicker.

---

## Execution Instructions for AI Agent
1. **Work in order:** Complete Phase 0, then implement and verify Phases 1, 2, 3, and 4 one by one.
2. **Mobile-first testing:** Pay special attention to mobile viewport safe areas (`env(safe-area-inset-*)`), touch responsiveness, and WebGL memory limits on iOS/Android.
3. **Zero bloat:** Keep dependencies minimal (`three`, `@types/three`, and a lightweight QR generator) so Cloudflare Workers bundle sizes and load times remain fast.