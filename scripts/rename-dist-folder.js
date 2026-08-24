// electron-builder's "dir" target always names its output folder something
// like "win-unpacked" -- not meaningful to a non-technical person receiving
// this folder. Renames it to something recognizable right after the build.
const fs = require('fs');
const path = require('path');

const DIST_DIR = path.join(__dirname, '..', 'dist');
const FRIENDLY_NAME = '航线比价打开器';

function findUnpackedDir() {
  if (!fs.existsSync(DIST_DIR)) return null;
  const candidate = fs.readdirSync(DIST_DIR).find((name) => name.endsWith('-unpacked'));
  return candidate ? path.join(DIST_DIR, candidate) : null;
}

const source = findUnpackedDir();
if (!source) {
  console.log('rename-dist-folder: no "*-unpacked" folder found under dist/, nothing to rename.');
  process.exit(0);
}

const target = path.join(DIST_DIR, FRIENDLY_NAME);
if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
fs.renameSync(source, target);
console.log(`rename-dist-folder: ${path.relative(DIST_DIR, source)} -> ${FRIENDLY_NAME}`);
