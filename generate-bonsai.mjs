import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const USERNAME = 'ppolkadot';
const TOKEN = process.env.GH_TOKEN;
const OUT_DIR = 'output';

const defaultEngineDir = path.join(os.tmpdir(), 'git-bonsai', 'dist', 'src');
const ENGINE_DIR = process.env.BONSAI_ENGINE || defaultEngineDir;

if (!fs.existsSync(path.join(ENGINE_DIR, 'index.js'))) {
  console.error(`git-bonsai engine not found at: ${ENGINE_DIR}`);
  console.error('Set BONSAI_ENGINE or clone https://github.com/egorthinks/git-bonsai.git into temp.');
  process.exit(1);
}

const { fetchMetrics, synthMetrics } = require(path.join(ENGINE_DIR, 'data.js'));
const { makeRng } = require(path.join(ENGINE_DIR, 'seed.js'));
const { deriveDna } = require(path.join(ENGINE_DIR, 'dna.js'));
const { buildSkeleton } = require(path.join(ENGINE_DIR, 'skeleton.js'));
const { applyThickness } = require(path.join(ENGINE_DIR, 'thickness.js'));
const { buildPalette, LANG_RAMPS } = require(path.join(ENGINE_DIR, 'palette.js'));
const { renderFrame } = require(path.join(ENGINE_DIR, 'render.js'));
const { fitBox, cropFrame } = require(path.join(ENGINE_DIR, 'raster.js'));
const { windFrames, growthFrames } = require(path.join(ENGINE_DIR, 'animate.js'));
const { frameToSvg, frameToPng, framesToGif } = require(path.join(ENGINE_DIR, 'encode.js'));

// Japanese sakura cherry-blossom ramps for the 3 canopy epochs
LANG_RAMPS['Sakura-Old'] = ['#8c2d57', '#ba4b7b', '#e37aa6', '#f7b2ce'];
LANG_RAMPS['Sakura-Mid'] = ['#9e3866', '#c95e8e', '#eb92b9', '#fbd3e3'];
LANG_RAMPS['Sakura-New'] = ['#7a2349', '#a83c6b', '#d66997', '#f5a6c7'];

async function run() {
  let metrics;
  if (TOKEN) {
    metrics = await fetchMetrics(USERNAME, TOKEN);
  } else {
    console.warn('No GH_TOKEN provided, using deterministic synthetic metrics for preview.');
    metrics = synthMetrics(USERNAME);
  }

  const rng = makeRng(metrics.username.toLowerCase());
  const dna = deriveDna(metrics, rng);

  // Force cherry/sakura archetype with abundant blossoms & spring palette
  dna.species = 'cherry';
  dna.flowers = Math.max(dna.flowers, 4);
  dna.palettes = ['Sakura-Old', 'Sakura-Mid', 'Sakura-New'];

  const skel = buildSkeleton(dna, rng);
  applyThickness(skel, dna);

  const palette = buildPalette(dna.palettes, 'cherry', 'spring');
  const still = renderFrame(dna, skel, { growthT: 1, windPhase: null });
  const wind = windFrames(dna, skel, 24);
  const growth = growthFrames(dna, skel, 44);

  const box = fitBox([still, ...wind.frames, ...growth.frames]);
  const crop = (frame) => cropFrame(frame, box);

  const scale = 3;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'bonsai.svg'), frameToSvg(crop(still), palette, scale));
  fs.writeFileSync(path.join(OUT_DIR, 'bonsai.png'), frameToPng(crop(still), palette, scale));
  fs.writeFileSync(
    path.join(OUT_DIR, 'bonsai.gif'),
    framesToGif({ frames: wind.frames.map(crop), delays: wind.delays }, palette)
  );
  fs.writeFileSync(
    path.join(OUT_DIR, 'bonsai-growth.gif'),
    framesToGif({ frames: growth.frames.map(crop), delays: growth.delays }, palette)
  );

  console.log(`Generated Sakura Bonsai (${dna.style}, ${dna.sizeClass}) in ${OUT_DIR}/`);
}

run().catch((err) => {
  console.error('Failed to generate Sakura Bonsai:', err);
  process.exit(1);
});
