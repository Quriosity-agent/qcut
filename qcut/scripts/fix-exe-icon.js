const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

async function fixExeIcon() {
  // Check platform - this script is Windows-only
  if (process.platform !== 'win32') {
    process.stderr.write('This script is intended for Windows only.\n');
    return;
  }
  
  const exePath = 'd:/AI_play/AI_Code/build_qcut/win-unpacked/QCut Video Editor.exe';
  const icoPath = path.join(__dirname, '../build/icon.ico');
  
  // Check if files exist
  if (!fs.existsSync(exePath)) {
    process.stderr.write(`Executable not found at: ${exePath}\n`);
    return;
  }
  
  if (!fs.existsSync(icoPath)) {
    process.stderr.write(`Icon not found at: ${icoPath}\n`);
    return;
  }
  
  process.stdout.write(`Fixing executable icon...\nExe path: ${exePath}\nIcon path: ${icoPath}\n`);
  
  // Download rcedit if not available
  const rceditUrl = 'https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe';
  const rceditPath = path.join(__dirname, 'rcedit.exe');
  
  if (!fs.existsSync(rceditPath)) {
    process.stdout.write('Downloading rcedit...\n');
    const https = require('https');
    const file = fs.createWriteStream(rceditPath);
    
    await new Promise((resolve, reject) => {
      https.get(rceditUrl, (response) => {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          process.stdout.write('rcedit downloaded successfully\n');
          resolve();
        });
      }).on('error', reject);
    });
  }
  
  // Use rcedit to set the icon
  exec(`"${rceditPath}" "${exePath}" --set-icon "${icoPath}"`, (error, stdout, stderr) => {
    if (error) {
      process.stderr.write(`Error setting icon: ${error}\n`);
      return;
    }
    process.stdout.write('Icon set successfully!\n');
    if (stdout) process.stdout.write(`Output: ${stdout}\n`);
    if (stderr) process.stderr.write(`Stderr: ${stderr}\n`);
  });
}

fixExeIcon().catch((err) => {
  process.stderr.write(`Error: ${err?.stack || err}\n`);
  process.exitCode = 1;
});