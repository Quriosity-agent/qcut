// Test script to verify Freesound API key
const https = require('https');

const API_KEY = 'h650BnTkps2suLENRVXD8LdADgrYzVm1dQxmxQqc';
const testUrl = `https://freesound.org/apiv2/search/text/?query=dog&token=${API_KEY}&page_size=1`;

console.log('Testing Freesound API key...');
console.log('URL:', testUrl.replace(API_KEY, '***'));

https.get(testUrl, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log('Status Code:', res.statusCode);
    
    if (res.statusCode === 200) {
      console.log('✅ API key is valid!');
      const json = JSON.parse(data);
      console.log('Results found:', json.count);
      if (json.results && json.results.length > 0) {
        console.log('First result:', json.results[0].name);
      }
    } else {
      console.log('❌ API request failed');
      console.log('Response:', data.substring(0, 200));
    }
  });
}).on('error', (err) => {
  console.error('Error:', err.message);
});