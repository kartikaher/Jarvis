const express = require('express');
const cors = require('cors');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 10000;

// CORS configuration - allow frontend origin
const allowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(',').map(url => url.trim())
  : ['http://localhost:5500', 'http://127.0.0.1:5500', 'http://localhost:3000'];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like curl, Postman, or server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.some(allowed => origin.startsWith(allowed))) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Target-Url']
}));

app.use(express.json({ limit: '1mb' }));

// Health check endpoint - Render uses this to verify the service is running
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'jarvis-backend', timestamp: new Date().toISOString() });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ message: 'JARVIS Backend API', version: '1.0.0', endpoints: ['/api/chat', '/health'] });
});

// Proxy endpoint for AI API calls
app.post('/api/chat', (req, res) => {
  const targetUrl = req.headers['x-target-url'];

  if (!targetUrl) {
    return res.status(400).json({ error: { message: 'Missing X-Target-Url header' } });
  }

  const postData = JSON.stringify(req.body);

  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch (e) {
    return res.status(400).json({ error: { message: 'Invalid X-Target-Url: ' + e.message } });
  }

  const options = {
    hostname: parsedUrl.hostname,
    path: parsedUrl.pathname + parsedUrl.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': req.headers['authorization'] || '',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  const proxyReq = https.request(options, (proxyRes) => {
    res.status(proxyRes.statusCode);
    res.set('Content-Type', proxyRes.headers['content-type'] || 'application/json');
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (e) => {
    console.error('Proxy error:', e.message);
    res.status(500).json({ error: { message: 'Backend proxy error: ' + e.message } });
  });

  proxyReq.write(postData);
  proxyReq.end();
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`JARVIS Backend running on port ${PORT}`);
  console.log(`Allowed origins: ${allowedOrigins.join(', ')}`);
});
