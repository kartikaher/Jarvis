const express = require('express');
const https = require('https');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json({ limit: '1mb' }));

// Serve frontend static files from ../frontend
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Health check endpoint - Render uses this to verify the service is running
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'jarvis', timestamp: new Date().toISOString() });
});

// Proxy endpoint for AI API calls
app.post('/api/chat', (req, res) => {
  const apiKey = (process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || '').trim();

  if (!apiKey) {
    return res.status(500).json({
      error: { message: 'Server API key is missing. Please set GROQ_API_KEY in server environment settings.' }
    });
  }

  const isGroq = apiKey.startsWith('gsk_') || Boolean(process.env.GROQ_API_KEY);
  const targetUrl = isGroq ? 'https://api.groq.com/openai/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
  const defaultModel = isGroq ? 'llama3-8b-8192' : 'gpt-3.5-turbo';

  const bodyData = {
    model: req.body.model || defaultModel,
    messages: req.body.messages,
    max_tokens: req.body.max_tokens || 500
  };

  const postData = JSON.stringify(bodyData);

  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch (e) {
    return res.status(400).json({ error: { message: 'Invalid target URL: ' + e.message } });
  }

  const options = {
    hostname: parsedUrl.hostname,
    path: parsedUrl.pathname + parsedUrl.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
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

// Fallback: serve index.html for any non-API route (SPA support)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`JARVIS running on port ${PORT}`);
});
