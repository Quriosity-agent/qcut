const path = require('path');
const { exec } = require('child_process');
const fs = require('fs');

exports.default = async function(context) {
  console.log('Running afterPack hook to fix icon...');
  
  const appOutDir = context.appOutDir;
  const exePath = path.join(appOutDir, 'QCut Video Editor.exe');
  const icoPath = path.join(context.packager.projectDir, 'build', 'icon.ico');
  
  console.log('Executable path:', exePath);
  console.log('Icon path:', icoPath);
  
  if (!fs.existsSync(exePath)) {
    console.error('Executable not found:', exePath);
    return;
  }
  
  if (!fs.existsSync(icoPath)) {
    console.error('Icon not found:', icoPath);
    return;
  }
  
  // Try to use our downloaded rcedit
  let rceditPath = path.join(context.packager.projectDir, 'scripts', 'rcedit.exe');
  
  // Fallback to electron-builder's cache
  if (!fs.existsSync(rceditPath)) {
    rceditPath = path.join(
      require('os').homedir(),
      'AppData/Local/electron-builder/Cache/winCodeSign/winCodeSign-2.6.0/rcedit-x64.exe'
    );
  }
  
  if (fs.existsSync(rceditPath)) {
    console.log('Using rcedit from:', rceditPath);
    
    return new Promise((resolve, reject) => {
      exec(`"${rceditPath}" "${exePath}" --set-icon "${icoPath}"`, (error, stdout, stderr) => {
        if (error) {
          console.error('Error setting icon:', error);
          reject(error);
        } else {
          console.log('Icon successfully embedded into executable!');
          resolve();
        }
      });
    });
  } else {
    console.log('rcedit not found in electron-builder cache, icon should be set by electron-builder');
  }
};