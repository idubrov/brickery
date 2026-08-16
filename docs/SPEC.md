# Game Specification: "Bricks"

## 1. Overview & Core Objective
**"Bricks"** is a pseudo-3D tactical puzzle arcade game rendered with Three.js and modern web technologies.
The visual presentation in both 2D and 3D modes is purposefully crafted around a signature **"Glossy Candy / Jewel Tile"** aesthetic: delicious solid colors, smooth pillowy rounded corners, satiny beveled highlights, and tactile carved directional glyphs.

The player clears bricks from a central **10×10 grid** by launching bricks inward from 4 surrounding walls (Top, Bottom, Left, Right). 

### Primary Goal
- Clear all bricks in the central playing field.
- In **Arcade / Wave Mode**: Clearing the central field completes the current wave, awards a wave clear bonus (+2,500 pts), and initiates the next wave with increased central field density.

### Loss Condition
- **Board Jam / Overflow**: If no valid moves are possible across all 4 walls while uncleared bricks remain in the field.

---

## 2. Playfield Layout & Architecture

```
                  Top Wall (10 cols × 3 rows)
              ┌─────────────────────────────────┐
              │ [2] [2] [2] [2] [2] [2] ... [2] │ (Layer 2: Outermost / Ejected / Replenished)
              │ [1] [1] [1] [1] [1] [1] ... [1] │ (Layer 1: Middle)
              │ [0] [0] [0] [0] [0] [0] ... [0] │ (Layer 0: Innermost / Clickable)
              └─────────────────────────────────┘
  Left Wall                                             Right Wall
(3 cols × 10 rows)                                  (3 cols × 10 rows)
┌──────┬──────┬──────┐ ┌──────────────────────────┐ ┌──────┬──────┬──────┐
│ [2]  │ [1]  │ [0]  │ │                          │ │ [0]  │ [1]  │ [2]  │
│ [2]  │ [1]  │ [0]  │ │   Central 10×10 Field    │ │ [0]  │ [1]  │ [2]  │
│ [2]  │ [1]  │ [0]  │ │                          │ │ [0]  │ [1]  │ [2]  │
│ ...  │ ...  │ ...  │ │   [R]  [G]  [B]          │ │ ...  │ ...  │ ...  │
│ [2]  │ [1]  │ [0]  │ │        [Y]  [R]          │ │ [0]  │ [1]  │ [2]  │
│ [2]  │ [1]  │ [0]  │ │                          │ │ [0]  │ [1]  │ [2]  │
└──────┴──────┴──────┘ └──────────────────────────┘ └──────┴──────┴──────┘
              ┌─────────────────────────────────┐
              │ [0] [0] [0] [0] [0] [0] ... [0] │ (Layer 0: Innermost / Clickable)
              │ [1] [1] [1] [1] [1] [1] ... [1] │ (Layer 1: Middle)
              │ [2] [2] [2] [2] [2] [2] ... [2] │ (Layer 2: Outermost / Ejected / Replenished)
              └─────────────────────────────────┘
                Bottom Wall (10 cols × 3 rows)
```

1. **Central Field**:
   - Size: 10 rows × 10 columns (100 cells total).
   - Coordinates: `(x, y)` where $x, y \in [0, 9]$.
   - Initial State: 5–14 random colored bricks in the central area.
   - Initial center bricks are **static** (`direction = NONE`).

2. **Surrounding Walls**:
   - 4 Walls: **Top**, **Bottom**, **Left**, **Right**.
   - Depth: 3 layers deep (indices 0, 1, 2).
   - **Layer 0**: Innermost layer directly bordering the 10×10 grid. This is the **only clickable layer** for the player.
   - **Layer 1**: Middle layer.
   - **Layer 2**: Outermost layer.

3. **High-Contrast 4-Quadrant Color Palette**:
   - 4 Unambiguously Distinct Colors separated uniformly across the color wheel (~90° apart):
     - **Vivid Fire Red**: `#e60026` (Deep vibrant scarlet, $350^\circ$)
     - **Royal Cobalt Blue**: `#2962ff` (Deep electric royal blue, $225^\circ$, completely separated from green/cyan)
     - **Radiant Emerald Green**: `#00c853` (Vibrant pure green, $140^\circ$)
     - **Bright Golden Yellow**: `#ffd600` (Warm luminous canary yellow, $50^\circ$)

---

## 3. Game Mechanics & State Machine

### 3.1 Aiming & Launching Rules
- The player can click any brick on **Layer 0** of any wall.
- **Empty Lane Launch Prevention & Trajectory Highlighting**:
  - A brick **CANNOT** be launched by the player if the lane in the 10×10 central field is completely empty (no obstacles to hit). Clicking on a wall brick in an empty lane is disabled and does nothing.
  - **Full-Path Aim Highlighting**: When hovering over a Layer 0 brick on an empty lane, the aim trajectory line is highlighted across the entire 10×10 central field, ending directly at the opposite wall's Layer 0 boundary (showing the full path the brick would traverse across the board).
  - When obstacles exist in the lane, the aim line terminates at the calculated landing cell, accompanied by a ghost landing preview box.
- **Launch Directions**:
  - **Left Wall**: Shoots East `(+1, 0)`
  - **Right Wall**: Shoots West `(-1, 0)`
  - **Top Wall**: Shoots South `(0, +1)`
  - **Bottom Wall**: Shoots North `(0, -1)`
- **Source Wall Inward Feed**:
  - When an innermost brick is fired from `(side, lane, 0)`:
  - Layer 1 moves to Layer 0.
  - Layer 2 moves to Layer 1.
  - A new random brick drops into Layer 2.

### 3.2 Obstacle Collision & Landings
- When launched, the projectile travels along its lane until it hits the first obstacle brick in the 10×10 field.
- It comes to rest at the empty cell immediately adjacent to the obstacle it hit.
- The landed brick retains its flight direction vector $D \in \{\text{East, West, South, North}\}$ and displays a high-contrast direction glyph on its top face.

### 3.3 Match-3 Elimination
- After bricks settle, the board checks for **strict straight lines** of **3 or more consecutive bricks of the same color**:
  - Horizontal runs: $\ge 3$ consecutive same-color bricks in a row.
  - Vertical runs: $\ge 3$ consecutive same-color bricks in a column.
  - Intersecting lines (T-shape, L-shape, cross) clear all participating cells simultaneously.
- Scoring:
  - Base: 100 pts per brick.
  - 4-in-a-row: $1.5\times$ bonus.
  - 5-in-a-row: $2.0\times$ bonus.

### 3.4 Continuous Momentum Recalculation & Equilibrium Loop
- Turn resolution executes a continuous **Equilibrium Loop**:
  1. **Match Phase**: Find and eliminate all 3+ line matches on the board. Award score with current combo multiplier ($1\times, 2\times, 3\times, \dots$).
  2. **Slide Phase**: Check ALL bricks on the board with active momentum ($D \ne \text{NONE}$). Any brick whose forward path is unobstructed slides forward simultaneously.
  3. **Off-Board Wall Push-Out**: Any brick that slides off the grid perimeter edge enters the opposite wall as **Layer 0**, pushing that wall queue outward (0 $\to$ 1, 1 $\to$ 2, 2 ejected).
  4. **Iterate until Static**: If any matches occurred OR any bricks slid/flew away, repeat from Step 1.
  5. The loop concludes only when **no bricks can slide and no matches exist**.
  6. **Wave Completion**: If all field bricks are eliminated or have flown away into the walls (`grid.isFieldEmpty() == true`), the wave is immediately completed!

---

## 4. Dual-Renderer Architecture & Visual Presentation

The game engine is strictly decoupled from presentation. The display layer supports two hot-swappable renderers that can be toggled at any time during gameplay without losing game state:

### 4.1 Pluggable Renderer Interface
All renderers implement a unified contract:
- `mount(container)`: Mount renderer DOM elements or canvas into host container.
- `unmount()`: Unmount or hide renderer DOM elements.
- `syncFromGrid(grid)`: Synchronize all active central field cells and 4 wall queues with the current engine state.
- `playTurnTimeline(timelineData)`: Execute smooth animated step sequences for launches, shifts, pops, matches, and cascading slides.
- `setEnabled(enabled)`: Enable or disable user input / hover interactions.
- `destroy()`: Dispose of renderer resources, listeners, geometries, textures, or timers.

### 4.2 3D Three.js Renderer (`Renderer3D`) - Tactile Glossy Candy & Jewel Tile Aesthetics
- **Camera & Projection**:
  - Near-orthographic, top-down isometric perspective (33° FOV, ~63° elevation angle) with camera shake on combos.
  - Camera position (`(0, 27.5, 15.0)`) and focal target (`(0, -0.2, 0.8)`) calibrated to fit the entire board and all 4 wall layers comfortably within the screen height with generous margins under the top HUD bar and on desktop/laptop displays.
  - Responsive framing automatically adapts on resize, ensuring both width and height remain completely in view across aspect ratios.
- **Tone Mapping & Exposure**:
  - `THREE.ACESFilmicToneMapping` with balanced exposure (`toneMappingExposure: 0.98`) for calm, comfortable contrast without harsh blown-out highlights or eye fatigue.
- **Calm, High-Clarity Multi-Light Studio Rig**:
  - **Key Directional Sun Light**: Warm directional light (`1.4` intensity) with crisp PCF soft shadow mapping (`THREE.PCFSoftShadowMap`, 2048×2048 shadow maps) carving out clean, calm 3D depth.
  - **Balanced Hemispherical Fill**: Low-to-moderate fill (`0.50`) pairing soft sky ambient (`0xe0f2fe`) with deep midnight navy ground bounce (`0x0f172a`), preserving clear 3D definition.
  - **Soft Cyan Rim Light**: Subtle cool directional rim light (`0x7dd3fc`, `0.45` intensity) catching top beveled edges.
  - **Ambient Point Glow**: Subtle central warmth (`0xffffff`, `0.2` intensity) ensuring center board clarity.
- **Refined Physical Materials & Rounded Corner Geometry (`RoundedBoxGeometry` / `MeshPhysicalMaterial`)**:
  - Bricks rendered with **pronounced rounded vertical corners and smooth beveled edges** (`RoundedBoxGeometry`, corner radius `0.16`, 5 bevel segments) delivering a smooth, tactile candy/jewel tile feel.
  - Satiny physical material properties:
    - Satiny clearcoat layer (`clearcoat: 0.65`, `clearcoatRoughness: 0.18`, `roughness: 0.28`, `reflectivity: 0.50`).
    - **100% Exact Color Parity with 2D Mode**:
      - Crimson: `#e60026` (`0xe60026`)
      - Cobalt: `#2962ff` (`0x2962ff`)
      - Emerald: `#00c853` (`0x00c853`)
      - Amber: `#ffd600` (`0xffd600`)
    - Zero resting self-emission for calm, glare-free viewing, with responsive interactive hover illumination (`clearcoat: 1.0`, `emissiveIntensity: 0.55`, `y` elevation +0.18).
- **High-DPI Solid Color Top Face Textures with Deep Carved Indent Arrows**:
  - 256×256 crisp vector canvas textures rendered in sRGB color space (`THREE.SRGBColorSpace`).
  - Top face features a **uniform, vibrant solid color face of identical intensity** throughout (matching 2D mode) with a rounded beveled perimeter highlight.
  - **Deep Carved Indent Arrows**: Directional moving bricks render their directional arrows (▲ North, ▼ South, ◄ West, ► East) as **deep carved/sunken indents** with dark cast shadow cavities, inner shadow bevels, and lower specular lip highlights catching the light.
  - Static obstacles and resting wall bricks are completely solid with **zero center dots or markings**, identical to 2D mode.
- **Refined Navy-Slate Board Base & Floor (2D Parity)**:
  - Central field floor rendered in calm, refined **navy-slate** (`0x16243b`), directly matching the 2D board background (`#131c2e`) with crisp slate grid lines (`0x475569` / `0x27364f`), softly recessed wall trays (`0x0e1726`), and deep chassis frame (`0x090f1a`).
- **Robust 40-Lane Interactive Hitboxes & Parallax-Free Precision**:
  - The 3D scene equips all 40 wall lanes (10 lanes × 4 sides) with dedicated 3D interactive hitboxes covering the entire 3-layer channel of each lane.
  - Hitbox height and vertical centering (`height = 0.58, posY = 0.29`) are calibrated exactly to the physical top surface of the bricks (`height = 0.55`), eliminating perspective parallax shifts and guaranteeing 1:1 mouse tracking across Left, Right, Top, and Bottom walls.
  - Raycasting targets both the individual brick meshes and the lane hitboxes, guaranteeing that clicking or hovering anywhere over a wall lane reliably registers the intended `(side, lane)` action without dead-zones or row offsets.
- **Authoritative Scene State Synchronization & Defensive Mesh Healing**:
  - End-of-turn callbacks, state restorations, and mode switches execute an authoritative `syncFromGrid()` ensuring every brick in the 10×10 central field and all 120 wall slots (4 sides × 10 lanes × 3 layers) has an exact, fully positioned 3D mesh.
  - Wall animations defensively self-heal missing meshes during shifts and pushes, preventing visual holes or orphan states.
- **Aim Trajectory Laser Beam & High-Visibility Landing Indicator**:
  - Features a **bold, wide luminous laser beam** (`width = 0.20` cell width) with an inner high-intensity laser core running down the center of the lane in the brick's matching color.
  - Spans cleanly from the active wall mouth to the obstacle impact point (or across to the opposite wall on empty lanes) without obscuring the board floor.
  - Target landing cell is illuminated with a **matching rounded 3D ghost landing pad** (`RoundedBoxGeometry`, corner radius `0.16`, translucent volume with glowing silhouette) for seamless visual consistency.
- **Particles, Dramatic Fireworks & Confetti Celebration**:
  - 3D explosion particle bursts on match eliminations.
  - **Dramatic Wave Completion Celebration**: Upon clearing all bricks on the board, a 2.0-second celebratory spectacle triggers with staggered multi-stage fireworks (rocket ascent, vibrant radial bursts, glittering spark trails) and realistic 3D fluttering confetti ribbons ($1\text{ width} \times 4\text{ height}$ double-sided rectangular strips with aerodynamic tilt, angled drift, and full vertical end-over-end tumbling) blanketing the entire 10×10 field, all 4 surrounding walls, and bottom quadrants before the Wave Clear modal is displayed.
- **Lifecycle & Power Optimization**: When switched away (deactivated), the 3D render loop (`requestAnimationFrame`) is completely paused, stopping GPU utilization.

### 4.3 2D High-Efficiency Battery-Saver Renderer (`Renderer2D`) - Crisp Candy Tile Aesthetics
- **Ultra-Low Power**: Built using lightweight semantic HTML/DOM and CSS transforms. Zero WebGL/GPU overhead, maximizing battery life on laptops and mobile devices.
- **Idle Power**: When idle (no active tweens), 0 `requestAnimationFrame` cycles are executed. Animations only run on demand during turns.
- **Unified 16×16 Grid Board & Wall Layout**:
  - The 2D board uses a unified **16×16 grid of identical square cells** (each cell is exactly 1/16th × 1/16th of the board dimension):
    - **Central 10×10 Field**: Spans rows 4..13 and columns 4..13.
    - **Top Wall (10 cols × 3 rows)**: Spans rows 1..3 and columns 4..13, aligning 1:1 with central field columns 0..9.
    - **Bottom Wall (10 cols × 3 rows)**: Spans rows 14..16 and columns 4..13, aligning 1:1 with central field columns 0..9.
    - **Left Wall (3 cols × 10 rows)**: Spans rows 4..13 and columns 1..3, aligning 1:1 with central field rows 0..9.
    - **Right Wall (3 cols × 10 rows)**: Spans rows 4..13 and columns 14..16, aligning 1:1 with central field rows 0..9.
    - **4 Corner Frames (3 cols × 3 rows)**: Top-Left, Top-Right, Bottom-Left, and Bottom-Right corner bezels.
  - **Full-Row/Column Interactive Launching (Zero Pixel Hunting)**:
    - Hovering or clicking anywhere across the entire 3-depth channel of a wall lane/row (Layers 0, 1, or 2) activates and launches the innermost Layer 0 projectile.
    - All slots in the hovered lane highlight synchronously with clear visual focus on Layer 0, delivering smooth, frictionless input without requiring precision clicking on a single 1×1 tile.
- **Unified Color Palette & Glyphs Parity**:
  - Uses the **exact same 4-quadrant color definitions** as 3D:
    - Vivid Fire Red: `#e60026` (`crimson`)
    - Royal Cobalt Blue: `#2962ff` (`cobalt`)
    - Radiant Emerald Green: `#00c853` (`emerald`)
    - Bright Golden Yellow: `#ffd600` (`amber`)
  - Identical color values applied across 2D/3D brick faces, hover highlights, laser aim lines, ghost landing indicators, and particle bursts.
  - In 2D mode, static bricks are rendered as clean **solid color bricks** (no center dots). Active moving/directional bricks display high-contrast directional indicators (▲ North, ▼ South, ◄ West, ► East).
- **Animations & FX**:
  - CSS/JS eased transitions for sliding projectiles, source wall inward feeds, target wall outward push/ejection, and cascading slides.
  - **Wall Push Queue Synchronization**: When a brick enters a wall (off-board slide or cross-board flight), the target wall queue is atomically updated (layer 2 ejected, layers 1 and 0 shift outward, arriving brick docks in layer 0 with `direction = NONE`) ensuring no blank slots or rendering holes.
  - Match pop animations with 2D celebratory particle bursts.
  - **2D Wave Clear Celebration**: 2.0-second celebratory spectacle with synchronized multi-stage fireworks and a continuous 1-second wide shower of tumbling confetti ribbons drifting down across the board.

### 4.4 Seamless Mode Switching & Clean-Slate Scene Reconstruction
- A compact, icon-free mode switch button in the HUD header (`#mode-toggle-btn`) displays purely **"2D"** (when in 3D mode) or **"3D"** (when in 2D mode) without icons or badge clutter to keep the button small and streamlined.
- **Clean-Slate Scene Teardown & Rebuild**:
  - Whenever toggling between 3D and 2D modes (or during wave resets, restarts, and game state restorations), the outgoing renderer performs an exhaustive teardown (canceling any active animations/tweens, clearing hover highlights, hiding aim laser lines & ghost preview meshes, and purging all lingering brick meshes).
  - The newly active renderer completely flushes its scene hierarchy and reconstructs the visual board **100% from scratch** directly from the live `GameEngine.grid` model.
  - Guarantees zero "ghost" bricks, orphan Three.js meshes, detached textures, or lingering aiming indicators when switching back and forth between 2D and 3D views.
- **State Invariance**:
  - The player's active game, score, high score, current wave, board layout, and wall queues remain 100% intact.
- **Persistence**:
  - The user's preferred render mode is persisted in `localStorage` (`bricks_render_mode`).

### 4.5 Audio & Synthesized FX
- Synthesized launch whooshes, impact clacks, harmonic match chords, pitch-ascending combo chimes, and dramatic multi-stage wave clear fireworks (whistling ascent, deep explosive booms, and sizzling crackles) run identically across both 2D and 3D render modes.

### 4.6 HUD, Wave Dropdown Menu & Fullscreen Controls
- **Interactive Wave Brand Badge & Dropdown Menu**:
  - The left HUD group features an interactive **Wave Brand Badge** (`[BRICKS Wave N ▾]`).
  - Clicking/tapping the badge toggles a clean glassmorphic dropdown popup menu directly underneath, saving top-bar horizontal space on mobile.
  - **Menu Actions**:
    - **↻ Restart Current Wave**: Rolls back score to `waveStartScore` and regenerates a fresh field and wall queues for that wave.
    - **⏮ Reset to Wave 1 (New Game)**: Completely resets the game to Wave 1 with 0 score, generating a new Wave 1 field and wall queues.
  - Rendered with top-layer positioning (`z-index: 100`) and viewport coordinates, guaranteeing it stays strictly on top of the 2D/3D board grid and field tiles without clipping.
  - Supports click-outside dismissal, ESC key dismissal, and item selection auto-close.
- **Fullscreen Toggle Button (`⛶` / `⤡`)**:
  - Positioned in the right HUD control group alongside mode, sound, and help buttons.
  - Allows entering and exiting browser fullscreen mode with a single click.
  - Automatically updates icon and tooltip dynamically via `fullscreenchange` events (e.g. when exiting via ESC key).
- **Game Over & Wave Modals**:
  - Wave Clear modal allows advancing to next wave (`Start Next Wave →`).
  - Game Over modal provides options to restart current wave (`Restart Wave N ↻`) or restart from the beginning (`Reset to Wave 1 ⏮`).
- **Help Modal ("How to Play")**:
  - Explains the 4 core gameplay rules (Launch Bricks, Form Lines, Momentum Cascades, Clear the Field).
  - Includes a direct link to the public GitHub repository (`https://github.com/AlexKorostov/bricks-game`) with GitHub branding for open-source visibility.
- **HUD Layout & Mobile Horizontal Swiping**:
  - **Left HUD Group**: `[BRICKS Wave N ▾]` interactive brand badge with dropdown menu for Restart and Reset options.
  - **Right HUD Group**: Score card, High Score card, compact text-only Mode Toggle button (`2D` / `3D`), Fullscreen Toggle button (`⛶`/`⤡`), Sound Toggle button (`🔊`/`🔇`), and Help button (`?`).
  - **Mobile Vertical / Narrow Viewport Horizontal Swiping & Affordance**:
    - When running in vertical/portrait orientation on mobile or narrow viewports where buttons exceed the screen width, the top HUD bar supports frictionless horizontal touch swiping (`overflow-x: auto; -webkit-overflow-scrolling: touch; touch-action: pan-x`).
    - Scrollbars remain hidden for clean aesthetics.
    - **Visual Swipe Cue Indicator**: When controls overflow to the right, an animated floating swipe cue (`›`) and edge fade appear dynamically to signal that more controls are accessible by swiping right.
    - Tapping the cue or swiping right scrolls smoothly to reveal the remaining buttons, and the indicator automatically fades out when the end of the bar is reached.

### 4.7 Full Browser State Persistence & Backward Compatibility Guarantee
- **State Persistence**: The active game state is automatically serialized and saved to `localStorage` (`bricks_puzzle_game_state`) on every turn completion, wave progression, restart, or reset.
- **Persisted Schema**:
  - `score`: Active game score.
  - `waveStartScore`: Score at the beginning of the current wave.
  - `highScore`: Persistent highest score achieved.
  - `wave`: Active wave number.
  - `state`: Current game state (`'READY'`, `'WAVE_CLEAR'`, `'GAME_OVER'`).
  - `turnCount`: Number of turns played in session.
  - `grid`: Full serialized grid state, containing:
    - 10×10 central field cells (`id`, `color`, `direction`).
    - 4 surrounding wall queues (`TOP`, `BOTTOM`, `LEFT`, `RIGHT`) with 10 lanes × 3 layers of bricks.
- **MANDATORY BACKWARD COMPATIBILITY DIRECTIVE**:
  - **Zero-Loss Redeployments**: All future code modifications, refactors, feature additions, or schema expansions **MUST remain strictly backward compatible** with previously stored states.
  - When users revisit or reload the application after a new version is rebuilt and redeployed to production, the engine must reliably load their existing session without state resets, data corruption, or crashes.
  - **Defensive Deserialization & Safe Defaults**:
    - `Grid.fromJSON()`, `Brick.fromJSON()`, and `GameEngine.loadState()` must validate all fields with safe fallback defaults.
    - If new state properties are added in future versions, existing older persisted JSON objects lacking those properties must seamlessly initialize with sensible default values.
    - If corrupted data is ever encountered, the application must catch errors gracefully without breaking the game loop.
- **Seamless Session Restoration**:
  - When reopening or refreshing the browser, the application automatically deserializes and restores the full board layout, wall queues, active wave, score, and UI state.
  - If the player closed during a `WAVE_CLEAR` or `GAME_OVER` modal, the modal overlay is restored appropriately.




---

## 5. Deterministic JS Architecture & Single-File Compilation

1. **Deterministic Dependency & Lockfile Architecture**:
   - Managed via **Bun** with strictly pinned dependencies in `package.json` (exact versions without floating caret `^` ranges or `latest` tags).
   - Strict lockfile enforcement via committed `bun.lock`.
   - CI/CD builds strictly execute `bun install --frozen-lockfile`, guaranteeing zero unexpected version upgrades and 100% reproducible builds.
   - Pinned Bun runtime version (`1.3.14`) across local development and GitHub Actions runners.
   - **Three.js** is managed as an exact npm dependency (`"three": "0.185.1"`).
   - All modules use standard package imports (`import * as THREE from 'three'`).

2. **Standard Single-File Compiler (Vite + `vite-plugin-singlefile`)**:
   - Development server with instant HMR: `bun run dev` (or `npx vite`).
   - Production single-file bundling: `bun run build`.
   - Produces a single, 100% self-contained, standalone offline artifact in `dist/index.html` with all JS, CSS, and Three.js runtime fully inlined.

3. **Continuous Integration & Automated Deployment (GitHub Actions)**:
   - **Automated Testing Workflow (`.github/workflows/test.yml`)**:
     - Triggers on every `push` and `pull_request` targeting `main`, plus manual `workflow_dispatch`.
     - Sets up pinned Bun runtime (`1.3.14`), installs deterministic dependencies (`bun install --frozen-lockfile`), and runs the entire unit test suite (`bun test`).
   - **Automated GitHub Pages Deployment Workflow (`.github/workflows/deploy.yml`)**:
     - Triggers on `push` to `main` and manual `workflow_dispatch`.
     - Sets up pinned Bun runtime (`1.3.14`), installs deterministic dependencies (`bun install --frozen-lockfile`), executes `bun run build` to compile the standalone single-file bundle, and deploys `dist/index.html` to the `gh-pages` branch.

---

## 6. Technical Implementation & Test Coverage

### Module Map:
- `.github/workflows/test.yml`: Continuous testing workflow running Vitest suite via Bun.
- `.github/workflows/deploy.yml`: Continuous deployment workflow compiling single-file bundle and deploying to GitHub Pages.
- `package.json`: Project manifest, scripts (`dev`, `build`, `test`), and dependencies (`three`, `vite`, `vite-plugin-singlefile`, `vitest`).
- `vite.config.js`: Vite & Vitest configuration bundling the single-file HTML game to `dist/index.html`.
- `src/core/Constants.js`: Definitions for grid size, wall depth, distinct 4-quadrant color palette, directions, and score multipliers.
- `src/core/Brick.js`: Brick data model with standard cryptographic UUIDs (`crypto.randomUUID()`), direction vectors, and serialization.
- `src/core/Grid.js`: Board state management, `popAndShiftWall()`, `pushInnermostWall()`, and defensive deserialization deduplication ensuring no ID collisions across sessions or game loads.
- `src/core/Physics.js`: Launch feasibility, obstacle landing calculation, and cascade simultaneous slides with off-board wall push.
- `src/core/Matcher.js`: Straight line match-3 detection and run scoring.
- `src/core/GameEngine.js`: Equilibrium loop turn orchestration, cascade chains, scoring, wave lifecycle.
- `src/render/Renderer3D.js`: Three.js WebGL renderer coordinating SceneManager, BoardView, BrickMesh, ParticleSystem, and 3D InputManager.
- `src/render/Renderer2D.js`: Ultra-lightweight HTML/DOM battery-saver renderer with 2D animations, aim preview, and direct pointer events.
- `src/render/SceneManager.js`: Three.js scene, camera, lighting, shadows, start/stop render loop.
- `src/render/BoardView.js`: 3D field platform, wall trays, aim lines, landing previews.
- `src/render/BrickMesh.js`: High-contrast 3D brick mesh with direction glyph textures.
- `src/render/Animator.js`: Eased tween animations for 3D slides, pops, and wall queue shifts.
- `src/render/ParticleSystem.js`: 3D explosion particle bursts.
- `src/input/InputManager.js`: 3D Raycaster mouse/touch events and hover previews (disabled on empty lanes).
- `src/audio/SoundSystem.js`: Procedural Web Audio effects.
- `src/ui/UIManager.js`: Score, high score, wave HUD, 2D/3D render mode switcher, combo badges, and modal dialogs.
- `src/index.js`: Application coordinator managing Engine, Renderers (2D/3D), Audio, and UI.

### Test Coverage (`tests/core.test.js`):
- 100% deterministic unit test coverage for Brick, Grid, Physics, Matcher, and GameEngine Equilibrium Cascades.
- Executed via standard **Vitest** (`bun test` or `bun run test`).

