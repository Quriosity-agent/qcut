const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function createIcon() {
  const inputPath = path.join(__dirname, '../apps/web/public/assets/logo-v4.png');
  const outputPath = path.join(__dirname, '../build/icon-new.png');
  const icoPath = path.join(__dirname, '../build/icon.ico');
  
  // First, make the image square (786x786) and save as PNG
  await sharp(inputPath)
    .resize(786, 786, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .toFile(outputPath);
  
  console.log('Square PNG created at:', outputPath);
  console.log('Now converting to ICO...');
  
  // Now convert the square PNG to ICO
  const { exec } = require('child_process');
  exec(`npx png-to-ico "${outputPath}" -o "${icoPath}"`, (error, stdout, stderr) => {
    if (error) {
      console.error('Error converting to ICO:', error);
      return;
    }
    console.log('ICO file created at:', icoPath);
    
    // Clean up temporary square PNG
    fs.unlinkSync(outputPath);
    console.log('Temporary file cleaned up');
  });
}

createIcon().catch(console.error);