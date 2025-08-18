const https = require('https');

// Test the Freesound API directly
const API_KEY = 'tVwrM3F4w0zQrNiBwNJ10SIazGBx6VEK4ZWYytRp';
const baseUrl = 'https://freesound.org/apiv2/search/text/';

// Simple test query
const params = new URLSearchParams({
  query: 'test',
  token: API_KEY,
  page: '1',
  page_size: '5',
  fields: 'id,name,description,previews'
});

const testUrl = `${baseUrl}?${params.toString()}`;

console.log('🧪 Testing Freesound API...');
console.log('📡 URL:', testUrl.replace(API_KEY, '***'));

const req = https.get(testUrl, (res) => {
  let data = '';
  
  console.log('📊 Status Code:', res.statusCode);
  console.log('📋 Headers:', res.headers);
  
  res.on('data', chunk => data += chunk);
  
  res.on('end', () => {
    console.log('📥 Raw Response Length:', data.length);
    
    if (res.statusCode >= 200 && res.statusCode < 300) {
      try {
        const parsed = JSON.parse(data);
        console.log('✅ Success! Found', parsed.results?.length || 0, 'results');
        console.log('📋 Sample result:', parsed.results?.[0]?.name || 'No results');
        console.log('🎯 Total count:', parsed.count);
      } catch (parseError) {
        console.error('❌ Failed to parse JSON:', parseError);
        console.log('📄 Raw response:', data.substring(0, 500) + '...');
      }
    } else {
      console.error('❌ API request failed');
      console.log('📄 Error response:', data);
    }
  });
});

req.on('error', (error) => {
  console.error('💥 Request error:', error.message);
});

req.setTimeout(10000, () => {
  req.destroy();
  console.error('⏰ Request timeout');
});