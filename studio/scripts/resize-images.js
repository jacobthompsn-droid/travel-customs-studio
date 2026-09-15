// Shrinks oversized post images in place, before every publish.
// Runs as a child process (ELECTRON_RUN_AS_NODE) using the site's own sharp.
// Keeps each file's name and format so nothing that references it breaks:
// - caps the long edge at 2000px (plenty for the site's largest rendering)
// - re-encodes JPEG/PNG/WebP at sensible quality
// - strips EXIF (camera/GPS metadata) after baking in the orientation
const path = require('node:path');
const fs = require('node:fs');

// The project location comes from the app (works both in development and
// when this script runs unpacked from the installed app).
const projectRoot = process.env.TC_PROJECT_ROOT || path.resolve(__dirname, '..', '..');
const sharp = require(path.join(projectRoot, 'node_modules', 'sharp'));

const POSTS_DIR = path.join(projectRoot, 'src', 'content', 'posts');
const MAX_EDGE = 2000;
const SIZE_THRESHOLD = 600 * 1024; // re-encode anything bigger than ~600KB
const EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

async function processImage(file) {
  const ext = path.extname(file).toLowerCase();
  if (!EXTENSIONS.has(ext)) return;

  const stat = fs.statSync(file);
  const meta = await sharp(file).metadata();
  const longEdge = Math.max(meta.width || 0, meta.height || 0);
  if (longEdge <= MAX_EDGE && stat.size <= SIZE_THRESHOLD) return;

  let pipeline = sharp(file)
    .rotate() // bake EXIF orientation in before metadata is stripped
    .resize({
      width: MAX_EDGE,
      height: MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    });
  if (ext === '.jpg' || ext === '.jpeg') pipeline = pipeline.jpeg({ quality: 82, mozjpeg: true });
  else if (ext === '.png') pipeline = pipeline.png({ compressionLevel: 9 });
  else if (ext === '.webp') pipeline = pipeline.webp({ quality: 82 });

  const tmp = file + '.tmp-resize';
  await pipeline.toFile(tmp);
  const newSize = fs.statSync(tmp).size;
  if (newSize < stat.size) {
    fs.renameSync(tmp, file);
    console.log(
      `resized ${path.relative(POSTS_DIR, file)}: ${(stat.size / 1024 / 1024).toFixed(1)}MB -> ${(newSize / 1024 / 1024).toFixed(1)}MB`,
    );
  } else {
    fs.unlinkSync(tmp); // already efficient — keep the original
  }
}

(async () => {
  if (!fs.existsSync(POSTS_DIR)) return;
  let failures = 0;
  for (const file of walk(POSTS_DIR)) {
    try {
      await processImage(file);
    } catch (err) {
      failures += 1;
      console.error(`could not process ${file}: ${err.message}`);
    }
  }
  // Failing to shrink an image is not fatal — the build gate still decides.
  process.exit(failures > 0 ? 0 : 0);
})();
