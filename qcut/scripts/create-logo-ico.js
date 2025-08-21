const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const icoEndec = require('ico-endec');

async function createIcon() {
  const inputPath = path.join(__dirname, '../apps/web/public/assets/logo-v4.png');
  const outputPath = path.join(__dirname, '../build/icon.ico');
  
  // Backup existing icon
  if (fs.existsSync(outputPath)) {
    fs.renameSync(outputPath, path.join(__dirname, '../build/icon-backup.ico'));
    console.log('Backed up existing icon to icon-backup.ico');
  }
  
  // Create multiple sizes for ICO
  const sizes = [16, 32, 48, 64, 128, 256];
  const images = [];
  
  for (const size of sizes) {
    const buffer = await sharp(inputPath)
      .resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toBuffer();
    
    images.push({
      buffer: buffer,
      width: size,
      height: size,
      bpp: 32
    });
    console.log(`Created ${size}x${size} image`);
  }
  
  // Create ICO file
  const icoBuffer = icoEndec.encode(images);
  fs.writeFileSync(outputPath, icoBuffer);
  
  console.log('ICO file created successfully at:', outputPath);
}

createIcon().catch(console.error);