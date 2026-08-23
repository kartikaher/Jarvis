require('dotenv').config();
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const https = require('https');
const path = require('path');
const fs = require('fs');
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

// ============================================================
// LOCAL WINDOWS DESKTOP AGENT BRIDGE & SECURITY
// ============================================================

const DESKTOP_AGENT_TOKEN = (process.env.DESKTOP_AGENT_TOKEN || 'jarvis_desktop_secure_token_default').trim();

let desktopAgentState = {
  online: false,
  deviceId: null,
  deviceName: 'Local Windows PC',
  lastSeen: null,
  pendingCommands: new Map(), // requestId -> { command, resolve, timeout }
  commandQueue: [] // commands waiting for agent to poll
};

// Check if agent is considered online (heartbeat received within last 20 seconds)
function isDesktopAgentOnline() {
  if (!desktopAgentState.online || !desktopAgentState.lastSeen) return false;
  const timeSinceLastSeen = Date.now() - new Date(desktopAgentState.lastSeen).getTime();
  return timeSinceLastSeen < 20000;
}

// Queue a command for the desktop agent and wait for completion
function dispatchDesktopCommand(action, target = '', params = {}, timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (!isDesktopAgentOnline()) {
      return resolve({
        success: false,
        error: 'DESKTOP_AGENT_OFFLINE',
        message: 'Sir, the desktop agent is currently offline.'
      });
    }

    const requestId = `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const commandPayload = {
      requestId,
      action,
      target,
      params,
      timestamp: new Date().toISOString()
    };

    const timer = setTimeout(() => {
      desktopAgentState.pendingCommands.delete(requestId);
      resolve({
        success: false,
        error: 'TIMEOUT',
        message: 'Sir, the desktop agent did not respond in time.'
      });
    }, timeoutMs);

    desktopAgentState.pendingCommands.set(requestId, { resolve, timer });
    desktopAgentState.commandQueue.push(commandPayload);
  });
}


// ============================================================
// LONG-TERM MEMORY SYSTEM — File-based persistence
// ============================================================

const MEMORY_FILE = path.join(__dirname, 'data', 'memories.json');
const MAX_MEMORIES = 1000;

function readMemoryFile() {
  try {
    if (!fs.existsSync(MEMORY_FILE)) {
      const dir = path.dirname(MEMORY_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const initial = { memories: [], settings: { enabled: true } };
      fs.writeFileSync(MEMORY_FILE, JSON.stringify(initial, null, 2));
      return initial;
    }
    return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8'));
  } catch (e) {
    console.error('Memory file read error:', e.message);
    return { memories: [], settings: { enabled: true } };
  }
}

function writeMemoryFile(data) {
  try {
    const dir = path.dirname(MEMORY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Memory file write error:', e.message);
  }
}

function generateMemoryId() {
  return `mem_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
}

// Sensitive data patterns — never store these
const SENSITIVE_PATTERNS = [
  /password\s*[:=]\s*\S+/i,
  /\bmy password\b/i,
  /api[_\-]?key\s*[:=]\s*\S+/i,
  /token\s*[:=]\s*\S+/i,
  /secret\s*[:=]\s*\S+/i,
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,
  /\b\d{3}-\d{2}-\d{4}\b/,
  /Bearer\s+[A-Za-z0-9\-._~+\/]+=*/i,
  /sk-[A-Za-z0-9]{20,}/i,
  /gsk_[A-Za-z0-9]{20,}/i,
  /\bpin\s*[:=]\s*\d{4,}/i,
  /\bcvv\s*[:=]\s*\d{3,4}/i,
];

function containsSensitiveData(text) {
  return SENSITIVE_PATTERNS.some(pattern => pattern.test(text));
}

// Get relevant memories for a user message (returns up to maxCount, or all if <= maxCount)
function getRelevantMemories(userMessage, memories, maxCount = 50) {
  if (!memories || memories.length === 0) return [];
  if (memories.length <= maxCount) return memories;

  const words = userMessage.toLowerCase().split(/\s+/).filter(w => w.length > 2);

  const scored = memories.map(mem => {
    const memWords = mem.content.toLowerCase().split(/\s+/);
    let score = 0;
    for (const word of words) {
      if (memWords.some(mw => mw.includes(word) || word.includes(mw))) {
        score += 2;
      }
    }
    // Boost recent memories
    const ageMs = Date.now() - new Date(mem.updatedAt || mem.createdAt).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays < 7) score += 2;
    else if (ageDays < 30) score += 1;
    return { ...mem, _score: score };
  });

  scored.sort((a, b) => b._score - a._score);
  return scored.slice(0, maxCount).map(({ _score, ...mem }) => mem);
}

// Make a Groq API call (used for memory detection)
function callGroqAPI(messages, maxTokens = 200) {
  return new Promise((resolve, reject) => {
    const apiKey = (process.env.GROQ_API_KEY || '').trim();
    if (!apiKey || apiKey === 'your_groq_api_key') {
      return reject(new Error('GROQ_API_KEY not configured'));
    }

    const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
    const postData = JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature: 0.1
    });

    const options = {
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.choices && data.choices[0]) {
            resolve(data.choices[0].message?.content || '');
          } else {
            reject(new Error(data.error?.message || 'No response from Groq'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// Detect and save memories from a user message (async, fire-and-forget)
async function detectAndSaveMemories(userMessage) {
  try {
    const data = readMemoryFile();
    if (!data.settings.enabled) return;
    if (containsSensitiveData(userMessage)) return;
    if (data.memories.length >= MAX_MEMORIES) return;

    const existingList = data.memories.length > 0
      ? '\n\nEXISTING MEMORIES (do NOT re-extract identical facts):\n' +
        data.memories.map(m => `- ${m.content}`).join('\n')
      : '';

    const systemPrompt = `You are a memory extraction system for a personal AI assistant named JARVIS. Analyze the user's message and extract any personal facts, preferences, background, goals, habits, interests, or instructions they stated about themselves.

Rules:
1. Extract ALL useful facts or preferences the user states about themselves (e.g. name, role, studies, goals, favorite tools/languages/hobbies, preferences, location).
2. Do NOT extract: questions, generic conversational filler, things the user is asking about (not stating), or temporary one-time chatter.
3. NEVER extract sensitive data: passwords, API keys, tokens, bank details, credit cards, SSN, security credentials, secret keys, PINs.
4. Keep each memory concise (one short factual statement starting with "User", e.g. "User prefers C++", "User is studying B.Tech CSE", "User's name is Kartik").
5. Categorize as: "preference", "fact", or "instruction".
6. Never overwrite unrelated existing memories. Return each distinct fact as a separate memory item in the array.
7. Return ONLY valid JSON: {"memories": [{"content": "...", "category": "preference|fact|instruction"}]} or {"memories": []} if nothing to save.${existingList}`;

    const response = await callGroqAPI([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ], 400);

    // Clean response — extract JSON
    let cleaned = response.trim();
    cleaned = cleaned.replace(/```json\s*/gi, '').replace(/```\s*/gi, '');
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '');
    cleaned = cleaned.replace(/<thought>[\s\S]*?<\/thought>/gi, '');
    cleaned = cleaned.trim();

    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;

    const result = JSON.parse(jsonMatch[0]);
    if (!result.memories || !Array.isArray(result.memories) || result.memories.length === 0) return;

    const now = new Date().toISOString();

    for (const mem of result.memories) {
      if (!mem.content || typeof mem.content !== 'string') continue;
      if (containsSensitiveData(mem.content)) continue;
      const trimmed = mem.content.trim();
      if (trimmed.length < 3 || trimmed.length > 500) continue;

      const category = ['preference', 'fact', 'instruction'].includes(mem.category) ? mem.category : 'fact';

      // Check if identical memory already exists
      const alreadyExists = data.memories.some(m => m.content.toLowerCase().trim() === trimmed.toLowerCase());
      if (alreadyExists) continue;

      // Add new memory without overwriting old memories
      if (data.memories.length < MAX_MEMORIES) {
        const newMem = {
          id: generateMemoryId(),
          content: trimmed,
          category,
          createdAt: now,
          updatedAt: now
        };
        data.memories.push(newMem);
        console.log(`Memory saved [${newMem.id}]: ${trimmed}`);
      }
    }

    writeMemoryFile(data);
  } catch (e) {
    console.error('Memory detection error:', e.message);
  }
}

// ============================================================
// API ROUTES
// ============================================================

// ============================================================
// DESKTOP AGENT API ENDPOINTS
// ============================================================

// Middleware to authenticate local desktop agent requests
function authenticateDesktopAgent(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : req.headers['x-agent-token'] || req.body?.token;
  if (!token || token !== DESKTOP_AGENT_TOKEN) {
    return res.status(401).json({ error: { message: 'Unauthorized: Invalid Desktop Agent authentication token.' } });
  }
  next();
}

// Public: Get Desktop Agent connection status for Frontend UI
app.get('/api/desktop/status', (req, res) => {
  const online = isDesktopAgentOnline();
  res.json({
    online,
    deviceName: desktopAgentState.deviceName,
    lastSeen: desktopAgentState.lastSeen
  });
});

// Execute a desktop command (dispatched from Frontend or internal AI)
app.post('/api/desktop/command', async (req, res) => {
  const { action, target, params } = req.body;
  if (!action) {
    return res.status(400).json({ error: { message: 'Action is required.' } });
  }

  const result = await dispatchDesktopCommand(action, target, params);
  res.json(result);
});

// Desktop Agent Polling & Heartbeat (Used by Local Windows Agent)
app.post('/api/desktop/agent/poll', authenticateDesktopAgent, (req, res) => {
  const { deviceId, deviceName } = req.body;
  desktopAgentState.online = true;
  desktopAgentState.deviceId = deviceId || desktopAgentState.deviceId;
  desktopAgentState.deviceName = deviceName || desktopAgentState.deviceName;
  desktopAgentState.lastSeen = new Date().toISOString();

  // Return any pending commands in the queue
  const commands = [...desktopAgentState.commandQueue];
  desktopAgentState.commandQueue = [];

  res.json({
    status: 'ok',
    commands,
    timestamp: new Date().toISOString()
  });
});

// Desktop Agent Report Execution Result (Used by Local Windows Agent)
app.post('/api/desktop/agent/report', authenticateDesktopAgent, (req, res) => {
  const { requestId, success, message, result, error } = req.body;
  if (!requestId) {
    return res.status(400).json({ error: { message: 'requestId is required.' } });
  }

  desktopAgentState.lastSeen = new Date().toISOString();

  const pending = desktopAgentState.pendingCommands.get(requestId);
  if (pending) {
    clearTimeout(pending.timer);
    desktopAgentState.pendingCommands.delete(requestId);
    pending.resolve({
      success: success !== false,
      message: message || (success ? 'Action executed successfully.' : 'Action failed.'),
      result: result || null,
      error: error || null
    });
  }

  res.json({ status: 'received' });
});

// Health check endpoint - Render uses this to verify the service is running
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'jarvis',
    desktopAgentOnline: isDesktopAgentOnline(),
    timestamp: new Date().toISOString()
  });
});


// ---- Memory CRUD Endpoints ----

// Get all memories
app.get('/api/memories', (req, res) => {
  const data = readMemoryFile();
  res.json({ memories: data.memories, count: data.memories.length });
});

// Create a memory
app.post('/api/memories', (req, res) => {
  const { content, category } = req.body;
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return res.status(400).json({ error: { message: 'Memory content is required.' } });
  }
  if (containsSensitiveData(content)) {
    return res.status(400).json({ error: { message: 'Cannot store sensitive information.' } });
  }

  const data = readMemoryFile();
  if (data.memories.length >= MAX_MEMORIES) {
    return res.status(400).json({ error: { message: `Memory limit reached (${MAX_MEMORIES}).` } });
  }

  const validCategory = ['preference', 'fact', 'instruction'].includes(category) ? category : 'fact';
  const trimmed = content.trim();
  const now = new Date().toISOString();

  // If exact duplicate already exists, return existing
  const existing = data.memories.find(m => m.content.toLowerCase().trim() === trimmed.toLowerCase());
  if (existing) {
    return res.json({ success: true, memory: existing, action: 'existing' });
  }

  const newMemory = {
    id: generateMemoryId(),
    content: trimmed,
    category: validCategory,
    createdAt: now,
    updatedAt: now
  };

  data.memories.push(newMemory);
  writeMemoryFile(data);
  res.json({ success: true, memory: newMemory, action: 'created' });
});

// Update a memory
app.put('/api/memories/:id', (req, res) => {
  const { id } = req.params;
  const { content, category } = req.body;

  const data = readMemoryFile();
  const memory = data.memories.find(m => m.id === id);
  if (!memory) {
    return res.status(404).json({ error: { message: 'Memory not found.' } });
  }

  if (content) {
    if (containsSensitiveData(content)) {
      return res.status(400).json({ error: { message: 'Cannot store sensitive information.' } });
    }
    memory.content = content.trim();
  }
  if (category && ['preference', 'fact', 'instruction'].includes(category)) {
    memory.category = category;
  }
  memory.updatedAt = new Date().toISOString();

  writeMemoryFile(data);
  res.json({ success: true, memory });
});

// Delete a single memory
app.delete('/api/memories/:id', (req, res) => {
  const { id } = req.params;
  const data = readMemoryFile();
  const index = data.memories.findIndex(m => m.id === id);
  if (index === -1) {
    return res.status(404).json({ error: { message: 'Memory not found.' } });
  }

  data.memories.splice(index, 1);
  writeMemoryFile(data);
  res.json({ success: true });
});

// Delete all memories (requires ?confirm=true)
app.delete('/api/memories', (req, res) => {
  if (req.query.confirm !== 'true') {
    return res.status(400).json({ error: { message: 'Add ?confirm=true to delete all memories.' } });
  }

  const data = readMemoryFile();
  data.memories = [];
  writeMemoryFile(data);
  res.json({ success: true, message: 'All memories deleted.' });
});

// ---- Memory Settings ----

app.get('/api/memory-settings', (req, res) => {
  const data = readMemoryFile();
  res.json({ enabled: data.settings?.enabled !== false });
});

app.put('/api/memory-settings', (req, res) => {
  const { enabled } = req.body;
  const data = readMemoryFile();
  if (!data.settings) data.settings = {};
  data.settings.enabled = enabled !== false;
  writeMemoryFile(data);
  res.json({ success: true, enabled: data.settings.enabled });
});

// ---- File Upload & Text Extraction Endpoint (UNCHANGED) ----

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

// Build optimized conversation messages with context window and summarization for long chats
function buildOptimizedContext(messages, maxRecentTurns = 12) {
  if (!messages || !Array.isArray(messages) || messages.length <= 1) return messages;

  const systemMsg = messages[0];
  const turns = messages.slice(1);

  // If conversation turns fit within the recent window, send all turns verbatim
  if (turns.length <= maxRecentTurns) {
    return messages;
  }

  // Older turns that need summarization
  const olderTurns = turns.slice(0, turns.length - maxRecentTurns);
  const recentTurns = turns.slice(turns.length - maxRecentTurns);

  // Build a structured concise recap of older turns
  const summaryLines = [];
  for (let i = 0; i < olderTurns.length; i++) {
    const t = olderTurns[i];
    if (!t || !t.content) continue;
    const roleLabel = t.role === 'user' ? 'User asked' : 'JARVIS answered';
    const cleanSnippet = t.content.replace(/\s+/g, ' ').trim();
    const snippet = cleanSnippet.length > 140 ? cleanSnippet.substring(0, 140) + '...' : cleanSnippet;
    summaryLines.push(`- ${roleLabel}: "${snippet}"`);
  }

  const olderSummaryBlock = summaryLines.length > 0
    ? `\n\nPREVIOUS CONVERSATION RECAP (Topics discussed earlier in this chat session):\n${summaryLines.join('\n')}`
    : '';

  // Enhanced system message with earlier session recap
  const enhancedSystemMsg = {
    ...systemMsg,
    content: systemMsg.content + olderSummaryBlock
  };

  return [enhancedSystemMsg, ...recentTurns];
}

// ---- Proxy endpoint for AI API calls (WITH MEMORY & CONVERSATION CONTEXT) ----

app.post('/api/chat', (req, res) => {
  const apiKey = (process.env.GROQ_API_KEY || '').trim();

  if (!apiKey || apiKey === 'your_groq_api_key') {
    return res.status(500).json({
      error: { message: 'Server GROQ_API_KEY environment variable is missing or unconfigured. Please set GROQ_API_KEY in server environment settings.' }
    });
  }

  let inputMessages = Array.isArray(req.body.messages) ? req.body.messages : [];

  if (inputMessages.length === 0) {
    return res.status(400).json({ error: { message: 'No messages provided.' } });
  }

  // Clone messages array to prevent mutating input
  inputMessages = inputMessages.map(m => ({ ...m }));

  // ---- MEMORY INJECTION ----
  const memData = readMemoryFile();
  const memoryEnabled = memData.settings?.enabled !== false;
  let userMessage = '';

  // Extract the latest user message
  const userMsg = [...inputMessages].reverse().find(m => m.role === 'user');
  userMessage = userMsg?.content || '';

  // Inject relevant memories into system prompt
  if (memoryEnabled && memData.memories.length > 0) {
    const relevant = getRelevantMemories(userMessage, memData.memories, 50);
    if (relevant.length > 0) {
      const systemMsg = inputMessages.find(m => m.role === 'system');
      if (systemMsg) {
        const memoryContext = relevant.map(m => `- ${m.content}`).join('\n');
        systemMsg.content += `\n\nLONG-TERM MEMORY (important things you remember about the user across conversations — use these to naturally personalize your answers. If the user explicitly asks what you remember or know about them, summarize these details naturally and warmly in conversation without mentioning any internal database, IDs, categories, or raw list formatting):\n${memoryContext}`;
      }
    }
  }
  // ---- END MEMORY INJECTION ----

  // ---- CONVERSATION CONTEXT OPTIMIZATION ----
  // Keeps recent turns verbatim and summarizes earlier turns for long chats
  const optimizedMessages = buildOptimizedContext(inputMessages, 14);
  // ---- END CONVERSATION CONTEXT OPTIMIZATION ----

  const targetUrl = 'https://api.groq.com/openai/v1/chat/completions';
  const selectedModel = process.env.GROQ_MODEL || req.body.model || 'openai/gpt-oss-120b';

  const bodyData = {
    model: selectedModel,
    messages: optimizedMessages,
    max_tokens: req.body.max_tokens || 800
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
    // Buffer response so we can trigger async memory detection after sending
    let responseBody = '';
    proxyRes.on('data', chunk => responseBody += chunk);
    proxyRes.on('end', () => {
      res.status(proxyRes.statusCode);
      res.set('Content-Type', proxyRes.headers['content-type'] || 'application/json');
      res.send(responseBody);

      // Async memory detection (fire-and-forget — does NOT block the response)
      if (memoryEnabled && userMessage && userMessage.length > 3) {
        detectAndSaveMemories(userMessage).catch(err =>
          console.error('Async memory detection error:', err.message)
        );
      }
    });
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
