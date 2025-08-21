const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function copyIconAssets() {
  const inputPath = path.join(__dirname, '../apps/web/public/assets/logo-v4.png');
  
  // Ensure build directory exists
  const buildDir = path.join(__dirname, '../build');
  fs.mkdirSync(buildDir, { recursive: true });
  
  // Create icon.png in build folder (256x256)
  const iconPngPath = path.join(buildDir, 'icon.png');
  await sharp(inputPath)
    .resize(256, 256, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .toFile(iconPngPath);
  process.stdout.write('Created icon.png in build folder\n');
  
  // Copy to various locations that might be used
  const destinations = [
    '../apps/web/public/favicon.ico',
    '../apps/web/dist/favicon.ico',
  ];
  
  const icoPath = path.join(__dirname, '../build/icon.ico');
  
  // Check if ICO file exists before trying to copy it
  if (!fs.existsSync(icoPath)) {
    process.stderr.write(`Skipping ICO copies: ${icoPath} not found\n`);
    return;
  }
  
  for (const dest of destinations) {
    const destPath = path.join(__dirname, dest);
    const destDir = path.dirname(destPath);
    
    // Ensure destination directory exists
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(icoPath, destPath);
    process.stdout.write(`Copied icon to ${dest}\n`);
  }
}

copyIconAssets().catch(err => {
  process.stderr.write(`Error copying icon assets: ${err}\n`);
  process.exit(1);
});