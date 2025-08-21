const sharp = require('sharp');
const toIco = require('to-ico');
const fs = require('fs');
const path = require('path');

async function createIcon() {
  const inputPath = path.join(__dirname, '../apps/web/public/assets/logo-v4.png');
  const outputPath = path.join(__dirname, '../build/icon.ico');
  
  // Backup existing icon
  if (fs.existsSync(outputPath)) {
    const backupPath = path.join(__dirname, '../build/icon-old.ico');
    if (fs.existsSync(backupPath)) {
      fs.unlinkSync(backupPath);
    }
    fs.renameSync(outputPath, backupPath);
    console.log('Backed up existing icon to icon-old.ico');
  }
  
  // Create multiple sizes for ICO (Windows standard sizes)
  const sizes = [16, 32, 48, 256];
  const buffers = [];
  
  for (const size of sizes) {
    const buffer = await sharp(inputPath)
      .resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toBuffer();
    
    buffers.push(buffer);
    console.log(`Created ${size}x${size} image`);
  }
  
  // Create ICO file
  const icoBuffer = await toIco(buffers);
  fs.writeFileSync(outputPath, icoBuffer);
  
  const stats = fs.statSync(outputPath);
  console.log(`ICO file created successfully at: ${outputPath}`);
  console.log(`File size: ${(stats.size / 1024).toFixed(2)} KB`);
}

createIcon().catch(console.error);