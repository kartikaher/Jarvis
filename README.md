# JARVIS AI — Windows Desktop Voice Assistant + Web Chatbot

A reliable personal AI assistant for Windows with continuous background wake-word voice interaction ("Hey JARVIS"), system tray control, safe computer actions, multi-turn AI reasoning, and a full-featured web chatbot.

---

## Architecture Overview

```
jarvis-ai/
├── desktop/                # Windows Desktop Voice Assistant (Background Agent)
│   ├── main.py             # Main entry point & state coordinator
│   ├── tray.py             # Windows System Tray icon & controls
│   ├── wake_word.py        # Continuous "Hey JARVIS" detector
│   ├── tts.py              # Exact Old JARVIS Voice (Microsoft David Desktop / UK-US English Male)
│   ├── audio_stt.py        # Sounddevice recording + Google STT with noise calibration
│   ├── state.py            # State machine (STANDBY -> LISTENING -> THINKING -> EXECUTING -> SPEAKING)
│   ├── actions.py          # Safe Action System (strict allowlists, zero raw shell commands)
│   ├── autostart.py        # Windows Startup registry management
│   ├── backend_client.py   # Secure client communicating with local backend proxy
│   ├── config.py           # Persistent configuration manager
│   ├── start_jarvis.vbs    # Invisible background launcher (no command windows)
│   ├── run_jarvis.bat      # Console launcher for testing
│   └── requirements.txt    # Python dependencies
├── backend/                # Node.js Express Backend Proxy
│   ├── server.js           # Groq proxy (gpt-oss-120b), file parser, long-term memory
│   ├── package.json        # Backend dependencies
│   ├── .env                # Protected environment variables (GROQ_API_KEY)
│   └── data/               # Persistent file-based memory database
├── frontend/               # Web Chatbot Interface (Preserved)
│   ├── index.html          # Web UI
│   ├── style.css           # Glassmorphism dark theme styling
│   └── app.js              # Multi-chat, file Q&A, voice & memory management
└── README.md
```

---

## Key Features

### 1. Windows Desktop Voice Assistant
- **Zero Popup Windows on Startup**: Starts in the background as a System Tray icon.
- **Start with Windows**: Toggle ON/OFF via tray menu or configuration.
- **Wake Word Detection**: Responds to **"Hey JARVIS"** or **"JARVIS"** in `STANDBY` mode without clicking any buttons.
- **Exact Voice Preservation**: SAPI5 male English voice (`Microsoft David Desktop`) tuned to `pitch: 0.9` and `rate: 1.0` matching the original JARVIS feel.
- **Voice States**: `STANDBY`, `LISTENING`, `THINKING`, `EXECUTING`, `SPEAKING`, `OFFLINE`, `DISABLED`.

### 2. Safe Computer Action System
- **Strict Allowlists**: Never executes raw shell commands or allows unsafe file/registry access.
- **Supported Direct Voice Commands**:
  - Open YouTube, Google, Gmail, Spotify, WhatsApp, Chrome
  - Open approved apps: Calculator, Notepad, File Explorer, VS Code, Task Manager, Settings
  - Open approved folders: Downloads, Documents, Desktop, Pictures, Videos, Project
  - Google Search & YouTube Search ("search youtube for ...")
  - System diagnostics: Battery percentage & charging status, current time & date, system health
  - Lock computer ("lock my computer")
  - Cancellation ("cancel", "stop", "never mind")
  - Standby ("go to sleep", "standby")

### 3. Sensitive Action Confirmation
- Sensitive actions (such as sending WhatsApp messages, shutdown, restart) trigger a confirmation state:
  > **User:** "Send Rahul: I will call you later."  
  > **JARVIS:** "I have the message for Rahul ready: 'I will call you later.'. Should I open WhatsApp to send it?"  
  > **User:** "Yes."  
  > **JARVIS:** Opens WhatsApp with the drafted message.

### 4. Multi-Turn AI Context & Long-Term Memory
- Maintains conversational memory for natural follow-ups (e.g. *"What is TCP?"* → *"Advantages?"* → *"Explain the second one."*).
- Long-term memory persists facts and user preferences across chats without overwriting old memories.
- `GROQ_API_KEY` is kept strictly on the backend and never exposed to the client.

### 5. Web Chatbot (100% Preserved)
- Web-based chat with multi-session history, file upload (PDF, TXT, DOCX), long-term memory toggle, and Web Speech API.

---

## Setup and Running

### 1. Configure Backend & API Key
1. Navigate to the `backend/` directory:
   ```bash
   cd backend
   npm install
   ```
2. Open `backend/.env` and set your Groq API key:
   ```env
   GROQ_API_KEY=gsk_your_actual_groq_api_key_here
   GROQ_MODEL=openai/gpt-oss-120b
   ```
3. Start the backend:
   ```bash
   npm start
   # Server runs on http://localhost:10000
   ```

### 2. Run Windows Desktop Voice Assistant
1. Install Python dependencies:
   ```bash
   python -m pip install -r desktop/requirements.txt
   ```
2. Start the Desktop Assistant:
   - **For testing with console logs**: Run `desktop/run_jarvis.bat` or `python desktop/main.py`.
   - **For silent background operation**: Double-click `desktop/start_jarvis.vbs`.

---

## System Tray Controls

Right-click the **JARVIS Arc-Reactor icon** in the Windows Taskbar Notification Area (System Tray) to access:
- **Status Indicator** (`Status: STANDBY`, `LISTENING`, `SPEAKING`, etc.)
- **JARVIS Enabled** (ON/OFF)
- **Wake Word ('Hey JARVIS')** (ON/OFF)
- **Voice Speech** (ON/OFF)
- **Start JARVIS with Windows** (ON/OFF)
- **Open Web JARVIS** (Launches `http://localhost:10000` in browser)
- **Exit JARVIS**
