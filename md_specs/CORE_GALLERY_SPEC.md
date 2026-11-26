# Plátenko Akryl — Core Gallery Spec (White Cube 2D, In-Situ, Deep Zoom & Admin)

## Project Context & Scope
This specification defines the core, high-priority features for the **Plátenko Akryl** online art gallery (deployed on Cloudflare Workers at `https://platenko.lm-olexicak.workers.dev/`).
- **Focus:** Exclusively physical **acrylic paintings on stretched canvas**.
- **Exclusions:** Do NOT include multi-profile switching, photography features, passepartout/mat-board configurators, or EXIF metadata parsing. Keep the codebase lean and focused solely on paintings.
- **Language:** All public UI and `/admin` controls must be in clean, natural **Slovak**.

---

## Phase 0: Audit & Fine-Tuning of Existing 2D Catalog ("White Cube" Standard)
Before building new features, inspect the existing codebase and styles to verify whether the current live version meets the ultra-clean **"White Cube"** gallery standard. Report findings to the user and apply fine-tuning fixes where needed:

1. **Color Palette & Visual Calm:**
   - Background should be off-white (`#F8F8F6` or `#FAFAFA`) with charcoal typography (`#18181B`), hairline borders, and generous whitespace.
   - Remove any heavy drop shadows, neon accents, cluttered cards, or distracting UI chrome that competes with the paintings.
2. **True Aspect Ratios (Zero Cropping):**
   - Every painting in the 2D grid MUST render in its exact physical aspect ratio (`dimensionsCm.width / dimensionsCm.height`). Never use `object-cover` that crops edges of the canvas.
3. **Subtle Canvas Depth:**
   - Give paintings a realistic, subtle physical presence (slight edge depth/shadow representing a stretched canvas) without artificial blurred backgrounds or heavy 3D gimmicks.
4. **Clean Metadata & Filtering:**
   - Beneath each painting, show only essential, understated info: **Title**, **Dimensions (`Š × V cm`)**, **Medium**, and a minimal **Availability pill** (*Dostupné* / *Rezervované* / *Predané*).
   - Provide a clean, unobtrusive filter bar (by Availability and Size category).

---

## Phase 1: Audit & Fine-Tuning of High-Res Asset Pipeline & Texture Optimization
Inspect that the gallery loads instantly while preserving museum-grade detail for close inspection:
1. **Dual-Resolution Strategy:**
   - `hiresImage`: Full-resolution original stored in Cloudflare R2 (loaded on-demand ONLY when the user opens the Deep Zoom modal).
   - `webTextureImage`: Automatically downscaled WebP/JPEG (max `1280px` on the longest side) used for the 2D catalog grid and In-Situ preview so the site stays fast on mobile and desktop.
2. **Preserve Originals:** Always keep the raw/original uploaded file alongside the cropped/rectified version in case the artist wants to re-crop later.

---

## Phase 2: Artwork Detail Modal — Deep Zoom & "Bočné nasvietenie" (Raking Light)
Clicking any painting in the 2D catalog opens a clean, full-screen detail view with three tabs:

### Tab 1: Detail & Štruktúra
- **Deep Zoom:** Load `hiresImage` with smooth mouse-wheel / pinch-to-zoom and pan controls so visitors can inspect acrylic textures, brushstrokes, and metallic details.
- **Raking Light ("Bočné nasvietenie"):** Add a toggleable directional lighting mode (lightweight WebGL/Canvas shader) driven by cursor/touch movement that simulates side gallery spotlighting across the canvas surface to highlight impasto relief.

### Tab 2: V interiéri (True-Scale In-Situ Simulator)
- Render the painting mathematically scaled to its exact `dimensionsCm` (`width × height`) above a minimalist reference sofa at gallery eye-level (`145 cm` center).
- **Custom Room Dimensions:** Allow the visitor to adjust the reference sofa/wall width in centimeters (`140–350 cm`, default `220 cm`, numeric input + slider) and ceiling height (`260 cm`) so proportions recalculate dynamically in real time.
- **Wall Color Switcher:** Include quick swatches (*Teplá biela*, *Surový betón*, *Tmavý antracit*, *Šalviová*).
- **Full-Screen View:** Ensure the simulator uses available screen space cleanly on both desktop and mobile without distorting sofa-to-painting proportions.

### Tab 3: Informácie & Dopyt
- Display exact physical dimensions (`Š × V × H cm`), medium, curatorial description, direct Instagram link (if set), and a clean inquiry form / pre-filled `mailto:` action containing the painting's title and ID.

---

## Phase 3: Artist Admin CMS (`/admin`) with 4-Point Perspective Straightening
Build or refine the PIN-protected `/admin` dashboard (never display the PIN value in the UI):

1. **Mobile Camera & File Upload:**
   - Support direct mobile camera capture (`<input type="file" accept="image/*" capture="environment" />`) as well as standard drag-and-drop file upload.
2. **Interactive 4-Point Perspective Straightening ("Vyrovnanie perspektívy"):**
   - Automatically open this tool for BOTH camera captures and uploaded files (and keep it accessible via an "Upraviť orez" button on existing artworks).
   - Render the raw photo on an HTML5 Canvas with **4 draggable corner handles** (with a magnified loupe on drag for precision) + fine rotation (`-15°` to `+15°`).
   - Apply a clean TypeScript **2D projective homography warp** to rectify angled photos into a flat, distortion-free rectangle matching the painting's exact aspect ratio (`width / height`).
   - Auto-generate and upload both the rectified `hiresImage` and the `1280px` `webTextureImage` to Cloudflare R2.
3. **Dimensions & Inventory Management:**
   - Numeric inputs for **Šírka (cm)**, **Výška (cm)**, and **Hĺbka plátna (cm)** + quick format presets (`30×40`, `50×50`, `60×80`, `80×100`, `100×120 cm`).
   - Live miniature scale preview next to a `220 cm` sofa while editing dimensions.
   - Fields for Title, Year, Medium, Status (*Dostupné* / *Rezervované* / *Predané*), Instagram URL, Description, and ordering.

---

## Execution Instructions for AI Agent
1. **Start with Phase 0:** Inspect the existing repository and report back a brief checklist of what already matches the "White Cube" standard and what needs fine-tuning.
2. **Proceed iteratively:** Complete and verify Phase 0 before moving to Phases 1, 2, and 3 one by one.
3. **Cloudflare Compatibility:** Ensure all image uploads, D1 database updates, and R2 storage operations remain fully compatible with the existing Cloudflare Workers deployment.