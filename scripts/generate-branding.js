const fs = require('fs');
const path = require('path');
const sharp = require('../frontend/node_modules/sharp');

// 1. Sleek, Premium "Sole What" Emblem Icon (512x512)
const iconSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Background Gradient -->
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0F172A"/>
      <stop offset="50%" stop-color="#1E1B4B"/>
      <stop offset="100%" stop-color="#0B0F19"/>
    </linearGradient>

    <!-- Subtle Glow Ring -->
    <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#6366F1" stop-opacity="0.8"/>
      <stop offset="50%" stop-color="#EC4899" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="#F59E0B" stop-opacity="0.8"/>
    </linearGradient>

    <!-- Main Ribbon 1: Electric Indigo to Vivid Purple to Rose -->
    <linearGradient id="ribbonS" x1="120" y1="120" x2="380" y2="380" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#818CF8"/>
      <stop offset="35%" stop-color="#6366F1"/>
      <stop offset="70%" stop-color="#A855F7"/>
      <stop offset="100%" stop-color="#EC4899"/>
    </linearGradient>

    <!-- Ribbon 2: Golden Amber to Coral Orange -->
    <linearGradient id="ribbonW" x1="150" y1="220" x2="360" y2="390" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#F59E0B"/>
      <stop offset="50%" stop-color="#F97316"/>
      <stop offset="100%" stop-color="#EF4444"/>
    </linearGradient>

    <!-- Soft Drop Shadow Filter -->
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%" filterUnits="userSpaceOnUse">
      <feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="#000000" flood-opacity="0.6"/>
    </filter>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%" filterUnits="userSpaceOnUse">
      <feGaussianBlur stdDeviation="8" result="coloredBlur"/>
      <feMerge>
        <feMergeNode in="coloredBlur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <!-- Squircle Base with Rim Glow -->
  <rect x="16" y="16" width="480" height="480" rx="112" fill="url(#bgGrad)"/>
  <rect x="18" y="18" width="476" height="476" rx="110" stroke="url(#ringGrad)" stroke-width="4" stroke-opacity="0.5"/>

  <!-- Geometric Interlocking Monogram (SW: Sole What) -->
  <g filter="url(#shadow)">
    <!-- The "S" Dynamic Continuous Curved Track -->
    <path d="M 330 148
             C 270 115, 175 130, 162 195
             C 152 248, 220 268, 275 285
             C 340 305, 360 340, 348 385
             C 330 445, 230 450, 170 410"
          stroke="url(#ribbonS)"
          stroke-width="44"
          stroke-linecap="round"
          stroke-linejoin="round"
          fill="none"/>

    <!-- The "W" Intersecting Accent Wings -->
    <path d="M 172 265
             L 216 385
             L 260 270
             L 304 385
             L 348 265"
          stroke="url(#ribbonW)"
          stroke-width="32"
          stroke-linecap="round"
          stroke-linejoin="round"
          fill="none"
          opacity="0.95"/>

    <!-- Central Diamond Apex Spark -->
    <circle cx="260" cy="270" r="10" fill="#FFFFFF" filter="url(#glow)"/>
  </g>
</svg>
`;

// 2. Full Horizontal Brand Logo with Sleek Typography (560x160)
const fullLogoSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="560" height="160" viewBox="0 0 560 160" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="logoBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0F172A"/>
      <stop offset="100%" stop-color="#1E1B4B"/>
    </linearGradient>
    <linearGradient id="logoRibbonS" x1="30" y1="30" x2="130" y2="130" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#818CF8"/>
      <stop offset="50%" stop-color="#6366F1"/>
      <stop offset="100%" stop-color="#EC4899"/>
    </linearGradient>
    <linearGradient id="logoRibbonW" x1="40" y1="60" x2="120" y2="130" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#F59E0B"/>
      <stop offset="100%" stop-color="#EF4444"/>
    </linearGradient>
    <linearGradient id="textGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="70%" stop-color="#F8FAFC"/>
      <stop offset="100%" stop-color="#CBD5E1"/>
    </linearGradient>
    <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#F59E0B"/>
      <stop offset="100%" stop-color="#EC4899"/>
    </linearGradient>
  </defs>

  <!-- Left Icon Emblem (Squircle) -->
  <g transform="translate(12, 16)">
    <rect width="128" height="128" rx="32" fill="url(#logoBg)"/>
    <rect x="1" y="1" width="126" height="126" rx="31" stroke="#6366F1" stroke-width="2" stroke-opacity="0.4"/>
    
    <!-- Mini SW Monogram -->
    <path d="M 88 40
             C 74 32, 48 35, 45 52
             C 42 66, 60 71, 75 75
             C 92 80, 98 89, 94 101
             C 89 116, 63 118, 48 107"
          stroke="url(#logoRibbonS)"
          stroke-width="12"
          stroke-linecap="round"
          stroke-linejoin="round"
          fill="none"/>

    <path d="M 47 70
             L 58 102
             L 70 72
             L 82 102
             L 93 70"
          stroke="url(#logoRibbonW)"
          stroke-width="8"
          stroke-linecap="round"
          stroke-linejoin="round"
          fill="none"/>
  </g>

  <!-- Brand Typography -->
  <!-- "SOLE WHAT" in Clean, Heavy Modern Display Font -->
  <text x="165" y="82"
        fill="url(#textGrad)"
        font-family="system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
        font-size="44"
        font-weight="900"
        letter-spacing="2">SOLE <tspan fill="url(#accentGrad)">WHAT</tspan></text>

  <!-- Subtitle: "POINT OF SALE SYSTEM" -->
  <text x="168" y="115"
        fill="#94A3B8"
        font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
        font-size="14"
        font-weight="700"
        letter-spacing="5">POINT OF SALE</text>

  <!-- Tiny Pro Badge -->
  <rect x="440" y="52" width="46" height="20" rx="6" fill="#6366F1" fill-opacity="0.2" stroke="#818CF8" stroke-width="1"/>
  <text x="451" y="66" fill="#A5B4FC" font-family="system-ui" font-size="10" font-weight="800" letter-spacing="1">PRO</text>
</svg>
`;

// Helper: Convert array of PNG buffers into a valid Windows .ico file buffer
function createIco(pngBuffers, sizes) {
  const numImages = pngBuffers.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const dirSize = headerSize + numImages * dirEntrySize;

  let currentOffset = dirSize;
  const entries = [];

  for (let i = 0; i < numImages; i++) {
    const size = sizes[i];
    const buf = pngBuffers[i];
    const width = size >= 256 ? 0 : size;
    const height = size >= 256 ? 0 : size;

    const entry = Buffer.alloc(16);
    entry.writeUInt8(width, 0); // bWidth
    entry.writeUInt8(height, 1); // bHeight
    entry.writeUInt8(0, 2); // bColorCount
    entry.writeUInt8(0, 3); // bReserved
    entry.writeUInt16LE(1, 4); // wPlanes
    entry.writeUInt16LE(32, 6); // wBitCount
    entry.writeUInt32LE(buf.length, 8); // dwBytesInRes
    entry.writeUInt32LE(currentOffset, 12); // dwImageOffset

    entries.push(entry);
    currentOffset += buf.length;
  }

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // idReserved
  header.writeUInt16LE(1, 2); // idType (1 = ICO)
  header.writeUInt16LE(numImages, 4); // idCount

  return Buffer.concat([header, ...entries, ...pngBuffers]);
}

async function run() {
  console.log('Generating "Sole What" Brand Assets...');

  const iconSvgBuf = Buffer.from(iconSvg);
  const fullLogoSvgBuf = Buffer.from(fullLogoSvg);

  // 1. Save SVGs
  fs.writeFileSync(path.join(__dirname, '../assets/icon.svg'), iconSvg);
  fs.writeFileSync(path.join(__dirname, '../frontend/public/logo.svg'), fullLogoSvg);
  fs.writeFileSync(path.join(__dirname, '../logo/Flo.svg'), fullLogoSvg);

  // 2. Generate PNGs across required resolutions
  const assetSizes = [16, 32, 64, 128, 256, 512];
  const icoBuffers = [];
  const icoSizes = [16, 32, 48, 64, 128, 256];

  for (const s of assetSizes) {
    const png = await sharp(iconSvgBuf).resize(s, s).png().toBuffer();
    fs.writeFileSync(path.join(__dirname, `../assets/icon-${s}.png`), png);
    if (s === 512) {
      fs.writeFileSync(path.join(__dirname, '../assets/icon.png'), png);
      fs.writeFileSync(path.join(__dirname, '../frontend/public/icon-512.png'), png);
    }
    if (s === 256) {
      fs.writeFileSync(path.join(__dirname, '../frontend/public/apple-touch-icon.png'), png);
    }
    if (s === 32) {
      fs.writeFileSync(path.join(__dirname, '../frontend/public/favicon-32x32.png'), png);
    }
    if (s === 16) {
      fs.writeFileSync(path.join(__dirname, '../frontend/public/favicon-16x16.png'), png);
    }
  }

  // 192px for PWA
  const pwa192 = await sharp(iconSvgBuf).resize(192, 192).png().toBuffer();
  fs.writeFileSync(path.join(__dirname, '../frontend/public/icon-192.png'), pwa192);

  // For Windows ICO (16, 32, 48, 64, 128, 256)
  for (const s of icoSizes) {
    const buf = await sharp(iconSvgBuf).resize(s, s).png().toBuffer();
    icoBuffers.push(buf);
  }
  const icoData = createIco(icoBuffers, icoSizes);
  fs.writeFileSync(path.join(__dirname, '../assets/icon.ico'), icoData);
  fs.writeFileSync(path.join(__dirname, '../frontend/src/app/favicon.ico'), icoData);
  fs.writeFileSync(path.join(__dirname, '../frontend/public/favicon.ico'), icoData);

  // Render Horizontal Full Logo PNGs
  const logoPng = await sharp(fullLogoSvgBuf).resize(560, 160).png().toBuffer();
  fs.writeFileSync(path.join(__dirname, '../frontend/public/logo.png'), logoPng);
  fs.writeFileSync(path.join(__dirname, '../frontend/public/flo-logo.png'), logoPng);
  fs.writeFileSync(path.join(__dirname, '../logo/logo-white.png'), logoPng);

  console.log('✅ "Sole What" Brand Logos & Icons successfully generated!');
}

run().catch(console.error);
