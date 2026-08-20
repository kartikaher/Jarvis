# JARVIS AI

A personal AI assistant with voice and text interaction, powered by OpenAI/Groq APIs.

## Project Structure

```
jarvis-ai/
├── frontend/          # Static frontend (Render Static Site)
│   ├── index.html     # Main HTML page
│   ├── style.css      # Styles
│   └── app.js         # Frontend JavaScript
├── backend/           # Node.js API server (Render Web Service)
│   ├── server.js      # Express proxy server
│   └── package.json   # Backend dependencies
├── render.yaml        # Render Blueprint for deployment
└── README.md
```

## Deployment on Render

### Option 1: Blueprint (Recommended)

1. Push this repo to GitHub
2. Go to [Render Dashboard](https://dashboard.render.com)
3. Click **New → Blueprint**
4. Connect your GitHub repo and select this repository
5. Render will auto-detect `render.yaml` and create both services

### Option 2: Manual Setup

#### Backend (Web Service)
1. **New → Web Service** on Render
2. Connect your repo
3. Settings:
   - **Root Directory**: `backend`
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. Add environment variable:
   - `FRONTEND_URL` = your frontend URL (e.g., `https://jarvis-frontend.onrender.com`)

#### Frontend (Static Site)
1. **New → Static Site** on Render
2. Connect your repo
3. Settings:
   - **Root Directory**: `frontend`
   - **Publish Directory**: `.` (current directory)

### Post-Deployment Configuration

After both services are deployed:

1. **Get your backend URL** from Render (e.g., `https://jarvis-backend.onrender.com`)
2. **Update the frontend** `app.js`: Change the `API_BASE_URL` line:
   ```javascript
   const API_BASE_URL = window.JARVIS_API_URL || 'https://jarvis-backend.onrender.com';
   ```
   Or add a config script tag in `index.html` before `app.js`:
   ```html
   <script>window.JARVIS_API_URL = 'https://jarvis-backend.onrender.com';</script>
   ```
3. **Set FRONTEND_URL** on the backend service environment variables to your frontend's URL

## Local Development

### Backend
```bash
cd backend
npm install
npm start
# Server runs on http://localhost:10000
```

### Frontend
Open `frontend/index.html` directly in a browser, or use a simple HTTP server:
```bash
cd frontend
npx serve .
```

For local development, the frontend defaults to same-origin requests, so you can run both together or set `window.JARVIS_API_URL = 'http://localhost:10000'` in the browser console.

## Features

- 🎤 Voice input via Web Speech API
- 🔊 Text-to-speech responses
- 💬 Text chat interface
- 🔑 Supports OpenAI and Groq API keys
- 🎨 Premium glassmorphism UI with animated orb
- 💾 Chat history persisted in localStorage
