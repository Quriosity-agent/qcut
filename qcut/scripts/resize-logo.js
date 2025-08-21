const sharp = require('sharp');
const path = require('path');

async function resizeLogo() {
  const inputPath = path.join(__dirname, '../apps/web/public/assets/logo-v4.png');
  const outputPath = path.join(__dirname, '../build/logo-v4-square.png');
  
  // Resize to exactly 256x256 (standard icon size)
  await sharp(inputPath)
    .resize(256, 256, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .toFile(outputPath);
  
  console.log('Square PNG (256x256) created at:', outputPath);
}

resizeLogo().catch(console.error);