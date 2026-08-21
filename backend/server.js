require('dotenv').config();
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const https = require('https');
const path = require('path');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json({ limit: '10mb' }));

// Multer Memory Storage Configuration (Max 5MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Serve frontend static files from ../frontend
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Health check endpoint - Render uses this to verify the service is running
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'jarvis', timestamp: new Date().toISOString() });
});

// File Upload & Text Extraction Endpoint
app.post('/api/upload', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: { message: 'File size exceeds 5MB limit. Please upload a smaller file.' } });
      }
      return res.status(400).json({ error: { message: 'File upload error: ' + err.message } });
    }

    if (!req.file) {
      return res.status(400).json({ error: { message: 'No file uploaded.' } });
    }

    const file = req.file;
    const ext = path.extname(file.originalname).toLowerCase();
    let extractedText = '';

    try {
      if (ext === '.txt') {
        extractedText = file.buffer.toString('utf-8');
      } else if (ext === '.pdf') {
        const pdfData = await pdfParse(file.buffer);
        extractedText = pdfData.text || '';
      } else if (ext === '.docx') {
        const result = await mammoth.extractRawText({ buffer: file.buffer });
        extractedText = result.value || '';
      } else {
        return res.status(400).json({
          error: { message: 'Unsupported file format. Only PDF, TXT, and DOCX files are allowed.' }
        });
      }

      extractedText = extractedText.trim();

      if (!extractedText) {
        return res.status(400).json({
          error: { message: 'Could not extract text from the file. The document may be empty or contain non-text media.' }
        });
      }

      // Safe character truncation limit (20,000 chars)
      const maxLength = 20000;
      if (extractedText.length > maxLength) {
        extractedText = extractedText.slice(0, maxLength) + '\n\n[Document truncated due to size]';
      }

      return res.json({
        success: true,
        filename: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
        textContent: extractedText
      });
    } catch (parseError) {
      console.error('File parsing error:', parseError.message);
      return res.status(400).json({
        error: { message: 'Failed to process file. The document may be corrupted or password-protected.' }
      });
    }
  });
});

// Proxy endpoint for AI API calls
app.post('/api/chat', (req, res) => {
  const apiKey = (process.env.GROQ_API_KEY || '').trim();

  if (!apiKey || apiKey === 'your_groq_api_key') {
    return res.status(500).json({
      error: { message: 'Server GROQ_API_KEY environment variable is missing or unconfigured. Please set GROQ_API_KEY in server environment settings.' }
    });
  }

  const targetUrl = 'https://api.groq.com/openai/v1/chat/completions';
  const selectedModel = process.env.GROQ_MODEL || req.body.model || 'openai/gpt-oss-120b';

  const bodyData = {
    model: selectedModel,
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
