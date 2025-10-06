#!/usr/bin/env node

/**
 * Script to set Gemini API key via Electron IPC
 * Run this after the app is running to configure the API key
 */

const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

// API key from .env file
const GEMINI_API_KEY = 'AIzaSyBIPgJqlXmEFxuskumUvIi59nafF6O1DN8';

async function setApiKey() {
  // Wait for app to be ready
  await app.whenReady();

  const userDataPath = app.getPath('userData');
  const apiKeysFilePath = path.join(userDataPath, 'api-keys.json');

  console.log('📁 User data path:', userDataPath);
  console.log('📄 API keys file:', apiKeysFilePath);

  // Check if encryption is available
  const encryptionAvailable = safeStorage.isEncryptionAvailable();
  console.log('🔒 Encryption available:', encryptionAvailable);

  // Prepare data to store
  const dataToStore = {};

  if (encryptionAvailable) {
    console.log('🔐 Encrypting API key...');
    const encryptedGemini = safeStorage.encryptString(GEMINI_API_KEY);
    dataToStore.geminiApiKey = encryptedGemini.toString('base64');
  } else {
    console.log('📝 Storing as plain text (encryption not available)');
    dataToStore.geminiApiKey = GEMINI_API_KEY;
  }

  // Ensure directory exists
  const dir = path.dirname(apiKeysFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write to file
  fs.writeFileSync(apiKeysFilePath, JSON.stringify(dataToStore, null, 2));

  console.log('✅ API key saved successfully!');
  console.log('📁 File location:', apiKeysFilePath);
  console.log('🔑 Key length:', GEMINI_API_KEY.length);

  app.quit();
}

setApiKey().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
