const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function copyIconAssets() {
  const inputPath = path.join(__dirname, '../apps/web/public/assets/logo-v4.png');
  
  // Create icon.png in build folder (256x256)
  const iconPngPath = path.join(__dirname, '../build/icon.png');
  await sharp(inputPath)
    .resize(256, 256, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .toFile(iconPngPath);
  console.log('Created icon.png in build folder');
  
  // Copy to various locations that might be used
  const destinations = [
    '../apps/web/public/favicon.ico',
    '../apps/web/dist/favicon.ico',
  ];
  
  const icoPath = path.join(__dirname, '../build/icon.ico');
  
  for (const dest of destinations) {
    const destPath = path.join(__dirname, dest);
    const destDir = path.dirname(destPath);
    
    if (fs.existsSync(destDir)) {
      fs.copyFileSync(icoPath, destPath);
      console.log(`Copied icon to ${dest}`);
    }
  }
}

copyIconAssets().catch(console.error);