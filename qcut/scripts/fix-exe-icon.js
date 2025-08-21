const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

async function fixExeIcon() {
  const exePath = 'd:/AI_play/AI_Code/build_qcut/win-unpacked/QCut Video Editor.exe';
  const icoPath = path.join(__dirname, '../build/icon.ico');
  
  // Check if files exist
  if (!fs.existsSync(exePath)) {
    console.error('Executable not found at:', exePath);
    return;
  }
  
  if (!fs.existsSync(icoPath)) {
    console.error('Icon not found at:', icoPath);
    return;
  }
  
  console.log('Fixing executable icon...');
  console.log('Exe path:', exePath);
  console.log('Icon path:', icoPath);
  
  // Download rcedit if not available
  const rceditUrl = 'https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe';
  const rceditPath = path.join(__dirname, 'rcedit.exe');
  
  if (!fs.existsSync(rceditPath)) {
    console.log('Downloading rcedit...');
    const https = require('https');
    const file = fs.createWriteStream(rceditPath);
    
    await new Promise((resolve, reject) => {
      https.get(rceditUrl, (response) => {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          console.log('rcedit downloaded successfully');
          resolve();
        });
      }).on('error', reject);
    });
  }
  
  // Use rcedit to set the icon
  exec(`"${rceditPath}" "${exePath}" --set-icon "${icoPath}"`, (error, stdout, stderr) => {
    if (error) {
      console.error('Error setting icon:', error);
      return;
    }
    console.log('Icon set successfully!');
    if (stdout) console.log('Output:', stdout);
    if (stderr) console.log('Stderr:', stderr);
  });
}

fixExeIcon().catch(console.error);