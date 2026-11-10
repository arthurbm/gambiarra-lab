// Moved from gambi packages/core/src/harness-workspace.ts (gambi@9980c2b).
// The gambi core no longer seeds this starter; the board owns it and applies
// it to hosted harnesses through createCityTileWorkspace().
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createLocalDirectoryWorkspace, type Workspace } from "gambi-sdk";

export interface HarnessTilePalette {
  accent: string;
  ground: string;
  sky: string;
}

const CURATED_TILE_PALETTES: HarnessTilePalette[] = [
  { sky: "#dce8e3", ground: "#d8c59e", accent: "#b9503f" },
  { sky: "#dfe5ee", ground: "#c9bc9d", accent: "#3f6674" },
  { sky: "#eadfcf", ground: "#c8c09f", accent: "#7b5548" },
  { sky: "#d9e8e8", ground: "#d6c29d", accent: "#a86432" },
  { sky: "#e5e0d4", ground: "#c5c49e", accent: "#4d6b58" },
  { sky: "#dce3d4", ground: "#d4bfa0", accent: "#755c84" },
];

export function deriveHarnessTilePalette(
  harness: string,
  model: string
): HarnessTilePalette {
  const key = `${harness.trim().toLowerCase()}:${model.trim().toLowerCase()}`;
  let hash = 0;
  for (const character of key) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) % 2_147_483_647;
  }
  return CURATED_TILE_PALETTES[
    Math.abs(hash) % CURATED_TILE_PALETTES.length
  ] as HarnessTilePalette;
}

function starterIndex(palette: HarnessTilePalette) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Gambi city tile</title>
    <style>
      :root { --sky: ${palette.sky}; --ground: ${palette.ground}; --accent: ${palette.accent}; }
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: var(--sky); }
      canvas { display: block; }
    </style>
  </head>
  <body>
    <script type="module">
      import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue("--sky"));

      // CITY CONTRACT: keep these camera bounds, position, and target unchanged.
      const camera = new THREE.OrthographicCamera(-6, 6, 6, -6, 0.1, 100);
      camera.position.set(8, 8, 8);
      camera.lookAt(0, 0, 0);

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.setSize(innerWidth, innerHeight);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      document.body.append(renderer.domElement);

      // CITY CONTRACT: one fixed hemisphere light and one fixed directional sun.
      scene.add(new THREE.HemisphereLight(0xffffff, 0x4c5266, 2));
      const sun = new THREE.DirectionalLight(0xffffff, 3);
      sun.position.set(4, 8, 6);
      scene.add(sun);

      // CITY CONTRACT: the lot is 10 x 10. Construction stays inside x/z ±4.5.
      const lot = new THREE.Mesh(
        new THREE.BoxGeometry(10, 0.25, 10),
        new THREE.MeshStandardMaterial({ color: getComputedStyle(document.documentElement).getPropertyValue("--ground") })
      );
      lot.position.y = -0.125;
      scene.add(lot);

      const landmark = new THREE.Mesh(
        new THREE.BoxGeometry(2.5, 3, 2.5),
        new THREE.MeshStandardMaterial({ color: getComputedStyle(document.documentElement).getPropertyValue("--accent") })
      );
      landmark.position.y = 1.5;
      scene.add(landmark);

      // Resize only the renderer. Fixed camera framing keeps every parcel aligned.
      addEventListener("resize", () => renderer.setSize(innerWidth, innerHeight));
      renderer.setAnimationLoop(() => renderer.render(scene, camera));
    </script>
  </body>
</html>
`;
}

const STARTER_README = `# Neighborhood sign

Replace this heading and first paragraph with the public plate copy. The board
renders README.md as plain text beside the tile, so write for people watching
the city: name the neighborhood, the harness/model, and what the place does.

## Fixed city fit

- Lot: exactly 10 x 10 units, centered at the origin.
- Build-safe footprint: keep every construction inside x/z -4.5 through 4.5.
  The remaining 0.5-unit edge clearance joins neighboring parcels cleanly.
- Camera: orthographic bounds -6/6/6/-6, position 8/8/8, target 0/0/0.
- Light: keep the starter hemisphere and directional lights unchanged.
- Framing: resize the renderer only. Do not resize, orbit, or animate the camera.
- Height: keep important geometry below y=8 so it remains inside the fixed view.

The starter palette is selected deterministically from normalized
\`harness + model\`. You may add colors inside the scene, but do not use board
status colors or draw UI outside the tile. Keep the generated sky, ground, and
accent values in manifest.json in sync with index.html.

## Manifest contract

\`manifest.json\` contains \`name\`, \`description\`, \`palette\`, and an optional
station. A station is either \`null\` or
\`{ "name": "...", "x": 0, "z": 0 }\`; x/z must stay within -4.5 through 4.5.

## Preview and publication

From this workspace run \`python3 -m http.server 4173\`, then open
\`http://localhost:4173\`. The shared board adds its own tiny status bridge when
serving the accepted artifact; runtime errors or a missing ready signal fall
back to the measured empty lot. Keep index.html self-contained apart from the
pinned Three.js module already used by the starter.
`;

function starterManifest(palette: HarnessTilePalette) {
  return `${JSON.stringify(
    {
      name: "New neighborhood",
      description: "Describe what this neighborhood does.",
      station: null,
      palette,
    },
    null,
    2
  )}\n`;
}

async function writeStarterFileIfMissing(
  path: string,
  content: string
): Promise<void> {
  if (await Bun.file(path).exists()) {
    return;
  }
  await Bun.write(path, content);
}

export interface CityTileStarterOptions {
  harness: string;
  model: string;
}

export interface CityTileStarterFile {
  content: string;
  path: string;
}

/** The city tile starter files, with the palette for `harness + model`. */
export function cityTileStarterFiles(
  options: CityTileStarterOptions
): CityTileStarterFile[] {
  const palette = deriveHarnessTilePalette(options.harness, options.model);
  return [
    { path: "index.html", content: starterIndex(palette) },
    { path: "README.md", content: STARTER_README },
    { path: "manifest.json", content: starterManifest(palette) },
  ];
}

/** Writes the city tile starter into a workspace without overwriting files. */
export async function seedCityTileStarter(
  workspacePath: string,
  options: CityTileStarterOptions
): Promise<void> {
  await mkdir(workspacePath, { recursive: true });
  await Promise.all(
    cityTileStarterFiles(options).map((file) =>
      writeStarterFileIfMissing(join(workspacePath, file.path), file.content)
    )
  );
}

/**
 * The starter as prompt text, for a harness the board cannot seed: one a
 * person runs on their own machine. The tunnel has no channel to write files
 * there, so the harness writes the missing files itself.
 */
export function cityTileStarterPrompt(options: CityTileStarterOptions): string {
  const files = cityTileStarterFiles(options).map(
    (file) =>
      `--- ${file.path} ---\n${file.content.trimEnd()}\n--- end ${file.path} ---`
  );
  return [
    "Before the task below, set up the city tile starter in your working directory.",
    "For each file listed here that does not exist yet, create it with exactly this content.",
    "Never overwrite a file that already exists. README.md explains the tile contract.",
    "",
    ...files,
    "",
    "Task:",
  ].join("\n");
}

/**
 * A gambi-sdk Workspace that seeds the city tile starter before the harness
 * starts. It wraps `base` (a local directory workspace by default).
 */
export function createCityTileWorkspace(
  base: Workspace = createLocalDirectoryWorkspace()
): Workspace {
  return {
    async prepare(context) {
      const prepared = await base.prepare(context);
      await seedCityTileStarter(prepared.path, {
        harness: context.harness,
        model: context.model,
      });
      return prepared;
    },
  };
}
