// ============================================================
// JARVIS AI - Frontend Application (Multi-Chat, Voice & File Q&A)
// ============================================================

// DOM Elements
const orb = document.getElementById('jarvis-orb');
const orbLabel = document.getElementById('orb-status');
const chatHistory = document.getElementById('chat-history');
const scrollContainer = chatHistory ? (chatHistory.parentElement || chatHistory) : null;
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const voiceBtn = document.getElementById('voice-btn');

// File Upload Elements
const attachBtn = document.getElementById('attach-btn');
const fileInput = document.getElementById('file-input');
const filePreviewArea = document.getElementById('file-preview-area');

// Header & Navigation Buttons
const newChatBtn = document.getElementById('new-chat-btn');
const historyBtn = document.getElementById('history-btn');
const settingsBtn = document.getElementById('settings-btn');

// History Drawer Elements
const historyDrawer = document.getElementById('history-drawer');
const closeHistoryBtn = document.getElementById('close-history-btn');
const closeHistoryBackdrop = document.getElementById('close-history-backdrop');
const drawerNewChatBtn = document.getElementById('drawer-new-chat-btn');
const historyList = document.getElementById('history-list');
const historyEmpty = document.getElementById('history-empty');

// Modals & Settings
const settingsModal = document.getElementById('settings-modal');
const closeSettings = document.getElementById('close-settings');
const clearChatBtn = document.getElementById('clear-chat');
const autoSpeakToggle = document.getElementById('auto-speak-toggle');

const deleteModal = document.getElementById('delete-modal');
const cancelDeleteBtn = document.getElementById('cancel-delete-btn');
const confirmDeleteBtn = document.getElementById('confirm-delete-btn');

// Memory System Elements
const memoryToggle = document.getElementById('memory-toggle');

// State Management
let conversations = [];
let activeConversationId = null;
let pendingDeleteConvId = null;
let isUserScrolledUp = false;
let isRecording = false;
let currentlySpeakingMsgId = null;
let isAutoSpeakEnabled = localStorage.getItem('jarvis_auto_speak') !== 'false'; // default true
let isMemoryEnabled = true; // will be loaded from server
let pendingMemoryClear = false; // flag for "forget everything" confirmation

// Default System Welcome Message
const DEFAULT_WELCOME_MSG = "Hello. I am JARVIS. How can I assist you today?";

// Clean legacy key
localStorage.removeItem('jarvis_api_key');

// Helper: Generate Unique ID
function generateId(prefix = 'conv') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
}

// Track manual scrolling
if (scrollContainer) {
    scrollContainer.addEventListener('scroll', () => {
        const distanceFromBottom = scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight;
        isUserScrolledUp = distanceFromBottom > 100;
    });
}

function scrollToBottom(force = false) {
    if (!scrollContainer) return;
    if (force) {
        isUserScrolledUp = false;
    }
    if (!isUserScrolledUp) {
        requestAnimationFrame(() => {
            scrollContainer.scrollTo({
                top: scrollContainer.scrollHeight,
                behavior: 'smooth'
            });
        });
    }
}

// Data Persistence
function saveToStorage() {
    try {
        localStorage.setItem('jarvis_conversations', JSON.stringify(conversations));
        if (activeConversationId) {
            localStorage.setItem('jarvis_active_conv_id', activeConversationId);
        } else {
            localStorage.removeItem('jarvis_active_conv_id');
        }
        localStorage.setItem('jarvis_auto_speak', isAutoSpeakEnabled);
    } catch (e) {
        console.error('Failed to save to localStorage:', e);
    }
}

function loadFromStorage() {
    try {
        const storedConvs = localStorage.getItem('jarvis_conversations');
        conversations = storedConvs ? JSON.parse(storedConvs) : [];
        activeConversationId = localStorage.getItem('jarvis_active_conv_id') || null;

        // Auto speak toggle setting
        if (autoSpeakToggle) {
            autoSpeakToggle.checked = isAutoSpeakEnabled;
        }

        // Legacy single-chat migration
        const legacyHistory = localStorage.getItem('jarvis_chat_history');
        if (legacyHistory && conversations.length === 0) {
            try {
                const legacyMsgs = JSON.parse(legacyHistory);
                if (Array.isArray(legacyMsgs) && legacyMsgs.length > 0) {
                    const migratedConv = {
                        id: generateId('migrated'),
                        title: legacyMsgs.find(m => m.sender === 'user')?.text?.slice(0, 30) || 'Previous Chat',
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                        fileAttachment: null,
                        messages: legacyMsgs.map((m, idx) => ({
                            id: `msg_legacy_${idx}`,
                            text: m.text,
                            sender: m.sender,
                            timestamp: Date.now()
                        }))
                    };
                    conversations.push(migratedConv);
                    activeConversationId = migratedConv.id;
                }
            } catch (err) {
                console.error('Migration error:', err);
            }
            localStorage.removeItem('jarvis_chat_history');
            saveToStorage();
        }
    } catch (e) {
        console.error('Failed to load conversations:', e);
        conversations = [];
        activeConversationId = null;
    }
}

// Conversation Operations
function getActiveConversation() {
    return conversations.find(c => c.id === activeConversationId) || null;
}

function startNewChat(closeDrawer = true) {
    stopSpeech();

    const newConv = {
        id: generateId('conv'),
        title: 'New Conversation',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        fileAttachment: null,
        messages: [
            {
                id: generateId('msg'),
                text: DEFAULT_WELCOME_MSG,
                sender: 'system',
                timestamp: Date.now()
            }
        ]
    };

    conversations.unshift(newConv);
    activeConversationId = newConv.id;
    saveToStorage();

    renderActiveConversation();
    renderHistoryList();
    renderFilePreview();

    if (closeDrawer && historyDrawer) {
        historyDrawer.classList.remove('open');
    }
    if (userInput) userInput.focus();
}

function switchConversation(convId) {
    if (activeConversationId === convId) {
        if (historyDrawer) historyDrawer.classList.remove('open');
        return;
    }

    stopSpeech();
    const targetConv = conversations.find(c => c.id === convId);
    if (!targetConv) return;

    activeConversationId = convId;
    saveToStorage();

    renderActiveConversation();
    renderHistoryList();
    renderFilePreview();
    if (historyDrawer) historyDrawer.classList.remove('open');
}

function promptDeleteConversation(convId, e) {
    if (e) e.stopPropagation();
    pendingDeleteConvId = convId;
    if (deleteModal) deleteModal.style.display = 'flex';
}

function confirmDeleteConversation() {
    if (!pendingDeleteConvId) return;

    const index = conversations.findIndex(c => c.id === pendingDeleteConvId);
    if (index !== -1) {
        conversations.splice(index, 1);
        
        if (activeConversationId === pendingDeleteConvId) {
            if (conversations.length > 0) {
                activeConversationId = conversations[0].id;
            } else {
                activeConversationId = null;
            }
        }
        
        saveToStorage();

        if (!activeConversationId) {
            startNewChat(false);
        } else {
            renderActiveConversation();
            renderHistoryList();
            renderFilePreview();
        }
    }

    pendingDeleteConvId = null;
    if (deleteModal) deleteModal.style.display = 'none';
}

// File Attachment Operations
function renderFilePreview() {
    if (!filePreviewArea) return;
    filePreviewArea.innerHTML = '';

    const activeConv = getActiveConversation();
    if (!activeConv || !activeConv.fileAttachment) {
        filePreviewArea.style.display = 'none';
        return;
    }

    const file = activeConv.fileAttachment;
    const sizeKB = (file.fileSize / 1024).toFixed(1);

    const badge = document.createElement('div');
    badge.className = 'file-badge';
    badge.innerHTML = `
        <span class="file-badge-icon">📄</span>
        <div class="file-badge-info">
            <span class="file-badge-name" title="${escapeHTML(file.filename)}">${escapeHTML(file.filename)}</span>
            <span class="file-badge-size">${sizeKB} KB</span>
        </div>
        <button class="file-badge-remove" title="Remove attached file">
            <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/></svg>
        </button>
    `;

    badge.querySelector('.file-badge-remove').addEventListener('click', () => {
        activeConv.fileAttachment = null;
        saveToStorage();
        renderFilePreview();
    });

    filePreviewArea.appendChild(badge);
    filePreviewArea.style.display = 'flex';
}

async function handleFileUpload(file) {
    if (!file) return;

    const activeConv = getActiveConversation();
    if (!activeConv) return;

    // Validate size (5MB)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
        alert("File size exceeds 5MB limit. Please upload a smaller PDF, TXT, or DOCX file.");
        if (fileInput) fileInput.value = '';
        return;
    }

    // Validate type extension
    const validExts = ['.pdf', '.txt', '.docx'];
    const fileExt = '.' + file.name.split('.').pop().toLowerCase();
    if (!validExts.includes(fileExt)) {
        alert("Unsupported file format. Only PDF, TXT, and DOCX files are allowed.");
        if (fileInput) fileInput.value = '';
        return;
    }

    // Show processing indicator
    filePreviewArea.style.display = 'flex';
    filePreviewArea.innerHTML = `
        <div class="file-badge" style="border-color: var(--primary-color);">
            <span>⏳ Processing ${escapeHTML(file.name)}...</span>
        </div>
    `;

    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error?.message || `Upload failed (${response.status})`);
        }

        activeConv.fileAttachment = {
            filename: data.filename,
            fileSize: data.fileSize,
            textContent: data.textContent
        };

        saveToStorage();
        renderFilePreview();
    } catch (err) {
        console.error('Upload error:', err);
        alert(`File upload failed: ${err.message}`);
        activeConv.fileAttachment = null;
        saveToStorage();
        renderFilePreview();
    } finally {
        if (fileInput) fileInput.value = '';
    }
}

// Render Functions
function renderActiveConversation() {
    chatHistory.innerHTML = '';
    const activeConv = getActiveConversation();

    if (!activeConv || !activeConv.messages || activeConv.messages.length === 0) {
        renderMessageDOM(DEFAULT_WELCOME_MSG, 'system', 'msg_welcome');
        return;
    }

    activeConv.messages.forEach(msg => {
        renderMessageDOM(msg.text, msg.sender, msg.id, msg.attachedFile);
    });

    scrollToBottom(true);
}

function renderMessageDOM(text, sender, msgId = null, attachedFileName = null) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}`;
    if (msgId) messageDiv.setAttribute('data-msg-id', msgId);

    let contentHTML = '';

    if (attachedFileName) {
        contentHTML += `<div class="attached-file-tag">📄 ${escapeHTML(attachedFileName)}</div>`;
    }

    contentHTML += `<div class="message-content">${escapeHTML(text)}</div>`;

    if (sender === 'system') {
        const isSpeakingThis = currentlySpeakingMsgId === msgId;
        contentHTML += `
            <div class="message-action-bar">
                <button class="message-speaker-btn ${isSpeakingThis ? 'speaking' : ''}" title="${isSpeakingThis ? 'Stop speaking' : 'Read response aloud'}" data-msg-id="${msgId}">
                    ${isSpeakingThis ? '⏹ Stop' : '🔊 Listen'}
                </button>
            </div>
        `;
    }

    messageDiv.innerHTML = contentHTML;

    if (sender === 'system' && msgId) {
        const speakerBtn = messageDiv.querySelector('.message-speaker-btn');
        if (speakerBtn) {
            speakerBtn.addEventListener('click', () => toggleSpeechForMessage(text, msgId));
        }
    }

    chatHistory.appendChild(messageDiv);
}

function escapeHTML(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatDate(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    const yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();

    if (isToday) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (isYesterday) {
        return 'Yesterday';
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function renderHistoryList() {
    if (!historyList) return;
    historyList.innerHTML = '';

    if (conversations.length === 0) {
        if (historyEmpty) historyEmpty.style.display = 'flex';
        return;
    }

    if (historyEmpty) historyEmpty.style.display = 'none';

    // Sort by updatedAt desc
    const sortedConvs = [...conversations].sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));

    sortedConvs.forEach(conv => {
        const card = document.createElement('div');
        const isActive = conv.id === activeConversationId;
        card.className = `history-card ${isActive ? 'active' : ''}`;

        const lastMsg = conv.messages && conv.messages.length > 0 
            ? conv.messages[conv.messages.length - 1].text 
            : 'No messages';

        const fileTag = conv.fileAttachment ? ` 📄` : '';

        card.innerHTML = `
            <div class="history-card-header">
                <span class="history-title" title="${escapeHTML(conv.title)}">${escapeHTML(conv.title)}${fileTag}</span>
                <button class="history-delete-btn" title="Delete conversation" data-id="${conv.id}">
                    <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z"/></svg>
                </button>
            </div>
            <div class="history-date">${formatDate(conv.updatedAt || conv.createdAt)}</div>
            <div class="history-preview">${escapeHTML(lastMsg)}</div>
        `;

        card.addEventListener('click', () => switchConversation(conv.id));

        const deleteBtn = card.querySelector('.history-delete-btn');
        deleteBtn.addEventListener('click', (e) => promptDeleteConversation(conv.id, e));

        historyList.appendChild(card);
    });
}

// ============================================================
// DESKTOP AGENT STATUS & COMMAND DISPATCHER
// ============================================================

let isDesktopAgentOnline = false;
const desktopAgentPill = document.getElementById('desktop-agent-pill');
const desktopAgentDot = document.getElementById('desktop-agent-dot');
const desktopAgentText = document.getElementById('desktop-agent-text');
const enableVoiceBtn = document.getElementById('enable-voice-btn');
const enableVoiceText = document.getElementById('enable-voice-text');

async function pollDesktopAgentStatus() {
    try {
        const res = await fetch('/api/desktop/status');
        if (res.ok) {
            const data = await res.json();
            isDesktopAgentOnline = data.online === true;
            if (desktopAgentPill) {
                if (isDesktopAgentOnline) {
                    desktopAgentPill.classList.remove('offline');
                    if (desktopAgentText) desktopAgentText.textContent = 'Desktop Online';
                    if (desktopAgentPill) desktopAgentPill.title = `Connected to ${data.deviceName || 'Local Windows PC'}`;
                } else {
                    desktopAgentPill.classList.add('offline');
                    if (desktopAgentText) desktopAgentText.textContent = 'Desktop Offline';
                    if (desktopAgentPill) desktopAgentPill.title = 'Local Windows Agent Offline';
                }
            }
        }
    } catch (e) {
        isDesktopAgentOnline = false;
        if (desktopAgentPill) {
            desktopAgentPill.classList.add('offline');
            if (desktopAgentText) desktopAgentText.textContent = 'Desktop Offline';
        }
    }
}

// Poll desktop agent status every 3.5 seconds
setInterval(pollDesktopAgentStatus, 3500);

async function executeDesktopAction(action, target = '', params = {}) {
    console.log(`[JARVIS] Desktop action requested: ${action} (${target})`);
    try {
        const res = await fetch('/api/desktop/command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, target, params })
        });
        const data = await res.json();
        if (data.success) {
            console.log(`[JARVIS] Desktop action executed: ${data.message}`);
        } else {
            console.warn(`[JARVIS] Desktop action returned: ${data.message || data.error}`);
        }
        return data;
    } catch (e) {
        console.error('[JARVIS] Desktop action fetch error:', e);
        return {
            success: false,
            error: 'NETWORK_ERROR',
            message: 'Sir, I could not establish a connection with the desktop bridge.'
        };
    }
}

// Fast Matcher for standard desktop actions
function matchDesktopAction(rawText) {
    const text = rawText.toLowerCase().trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '');

    // 1. Applications
    if (/^(open|launch|start)\s+(google\s+chrome|chrome)$/i.test(text)) return { action: 'OPEN_APPLICATION', target: 'chrome', speech: 'Opening Chrome.' };
    if (/^(open|launch|start)\s+(vs\s*code|vscode|code|visual\s+studio\s+code)$/i.test(text)) return { action: 'OPEN_APPLICATION', target: 'vscode', speech: 'Opening VS Code.' };
    if (/^(open|launch|start)\s+(calculator|calc)$/i.test(text)) return { action: 'OPEN_APPLICATION', target: 'calc', speech: 'Opening Calculator.' };
    if (/^(open|launch|start)\s+(notepad|note\s*pad)$/i.test(text)) return { action: 'OPEN_APPLICATION', target: 'notepad', speech: 'Opening Notepad.' };
    if (/^(open|launch|start)\s+(file\s*explorer|explorer|files|my\s+files)$/i.test(text)) return { action: 'OPEN_APPLICATION', target: 'explorer', speech: 'Opening File Explorer.' };
    if (/^(open|launch|start)\s+(spotify)$/i.test(text)) return { action: 'OPEN_APPLICATION', target: 'spotify', speech: 'Opening Spotify.' };
    if (/^(open|launch|start)\s+(task\s*manager)$/i.test(text)) return { action: 'OPEN_APPLICATION', target: 'task manager', speech: 'Opening Task Manager.' };
    if (/^(open|launch|start)\s+(windows\s+settings|settings)$/i.test(text)) return { action: 'OPEN_APPLICATION', target: 'settings', speech: 'Opening Settings.' };

    // 2. Websites & URLs
    if (/^(open|launch|go\s+to)\s+youtube$/i.test(text)) return { action: 'OPEN_URL', target: 'youtube', speech: 'Opening YouTube.' };
    if (/^(open|launch|go\s+to)\s+google$/i.test(text)) return { action: 'OPEN_URL', target: 'google', speech: 'Opening Google.' };
    if (/^(open|launch|go\s+to)\s+github$/i.test(text)) return { action: 'OPEN_URL', target: 'github', speech: 'Opening GitHub.' };
    if (/^(open|launch|go\s+to)\s+gmail$/i.test(text)) return { action: 'OPEN_URL', target: 'gmail', speech: 'Opening Gmail.' };
    if (/^(open|launch|go\s+to)\s+chatgpt$/i.test(text)) return { action: 'OPEN_URL', target: 'chatgpt', speech: 'Opening ChatGPT.' };

    // 3. User Folders
    if (/^(open|show)\s+(downloads|downloads\s+folder)$/i.test(text)) return { action: 'OPEN_FOLDER', target: 'downloads', speech: 'Opening Downloads.' };
    if (/^(open|show)\s+(documents|documents\s+folder|my\s+documents)$/i.test(text)) return { action: 'OPEN_FOLDER', target: 'documents', speech: 'Opening Documents.' };
    if (/^(open|show)\s+(desktop\s+folder)$/i.test(text)) return { action: 'OPEN_FOLDER', target: 'desktop', speech: 'Opening Desktop folder.' };
    if (/^(open|show)\s+(pictures|pictures\s+folder)$/i.test(text)) return { action: 'OPEN_FOLDER', target: 'pictures', speech: 'Opening Pictures.' };
    if (/^(open|show)\s+(music|music\s+folder)$/i.test(text)) return { action: 'OPEN_FOLDER', target: 'music', speech: 'Opening Music.' };
    if (/^(open|show)\s+(videos|videos\s+folder)$/i.test(text)) return { action: 'OPEN_FOLDER', target: 'videos', speech: 'Opening Videos.' };

    // 4. Windows Desktop & Workstation
    if (/^(show\s+desktop|minimize\s+all|go\s+to\s+desktop)$/i.test(text)) return { action: 'SHOW_DESKTOP', speech: 'Showing desktop.' };
    if (/^(lock\s+(my\s+)?(pc|computer|laptop|workstation|windows))$/i.test(text)) return { action: 'LOCK_PC', speech: 'Locking your computer.' };

    // 5. System Status & Battery
    if (/^(battery\s+status|check\s+battery|battery\s+percentage|how\s+much\s+battery)$/i.test(text)) return { action: 'BATTERY_STATUS' };
    if (/^(system\s+status|system\s+check|pc\s+status)$/i.test(text)) return { action: 'SYSTEM_INFO' };

    // 6. Close Applications
    if (/^(close|quit|kill)\s+(google\s+chrome|chrome)$/i.test(text)) return { action: 'CLOSE_APPLICATION', target: 'chrome', speech: 'Closing Chrome.' };
    if (/^(close|quit|kill)\s+(notepad)$/i.test(text)) return { action: 'CLOSE_APPLICATION', target: 'notepad', speech: 'Closing Notepad.' };
    if (/^(close|quit|kill)\s+(calculator|calc)$/i.test(text)) return { action: 'CLOSE_APPLICATION', target: 'calculator', speech: 'Closing Calculator.' };
    if (/^(close|quit|kill)\s+(vs\s*code|vscode|code)$/i.test(text)) return { action: 'CLOSE_APPLICATION', target: 'vscode', speech: 'Closing VS Code.' };

    // 7. Dangerous Actions Requiring Confirmation
    if (/^(shut\s*down|shutdown|turn\s+off)\s+(my\s+)?(laptop|pc|computer|system)$/i.test(text)) {
        return {
            action: 'PROMPT_SHUTDOWN',
            speech: 'Sir, shutting down will close your current session. Do you want me to continue?'
        };
    }
    if (/^(restart|reboot)\s+(my\s+)?(laptop|pc|computer|system)$/i.test(text)) {
        return {
            action: 'PROMPT_RESTART',
            speech: 'Sir, restarting will close all running applications. Do you want me to proceed?'
        };
    }

    return null;
}

// ============================================================
// CONTINUOUS IRON-MAN VOICE & WAKE WORD ENGINE
// ============================================================

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let wakeRecognition = null;
let commandRecognition = null;
let manualRecognition = null;

let isContinuousVoiceEnabled = localStorage.getItem('jarvis_continuous_voice') === 'true';
let voiceState = 'STANDBY'; // 'STANDBY' | 'LISTENING' | 'PROCESSING' | 'SPEAKING' | 'ERROR'
let isSpeakingTTS = false;
let pendingActionConfirmation = null; // 'SHUTDOWN' | 'RESTART'
let wakeWordRestartTimer = null;

function setOrbState(state) {
    if (!orb) return;
    orb.classList.remove('listening', 'thinking', 'speaking', 'error');
    if (state === 'listening') orb.classList.add('listening');
    if (state === 'thinking' || state === 'processing') orb.classList.add('thinking');
    if (state === 'speaking') orb.classList.add('thinking');
    if (state === 'error') orb.classList.add('error');
}

function updateVoiceState(state, customLabel = null) {
    voiceState = state;
    if (state === 'STANDBY') {
        setOrbState('idle');
        if (orbLabel) orbLabel.textContent = customLabel || (isContinuousVoiceEnabled ? 'Listening for Hey JARVIS' : 'Tap to Speak');
    } else if (state === 'LISTENING') {
        setOrbState('listening');
        if (orbLabel) orbLabel.textContent = customLabel || 'Listening...';
    } else if (state === 'PROCESSING') {
        setOrbState('thinking');
        if (orbLabel) orbLabel.textContent = customLabel || 'Thinking...';
    } else if (state === 'SPEAKING') {
        setOrbState('speaking');
        if (orbLabel) orbLabel.textContent = customLabel || 'Speaking...';
    } else if (state === 'ERROR') {
        setOrbState('error');
        if (orbLabel) orbLabel.textContent = customLabel || 'Voice system unavailable';
    }
}

function normalizeWakeWord(text) {
    if (!text || typeof text !== 'string') return '';
    return text.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '').trim();
}

function isWakeWordDetected(normalizedText) {
    const wakeVariants = [
        'hey jarvis', 'jarvis', 'hi jarvis', 'ok jarvis', 'okay jarvis',
        'hey jarvis open', 'hey jarvis what', 'hey jarvis explain'
    ];
    return wakeVariants.some(w => normalizedText.includes(w));
}

function extractInlineCommand(normalizedText) {
    let cleaned = normalizedText;
    const prefixes = ['hey jarvis', 'hi jarvis', 'ok jarvis', 'okay jarvis', 'jarvis'];
    for (const p of prefixes) {
        if (cleaned.startsWith(p)) {
            cleaned = cleaned.substring(p.length).trim();
            break;
        } else if (cleaned.includes(p)) {
            cleaned = cleaned.split(p)[1].trim();
            break;
        }
    }
    cleaned = cleaned.replace(/^(please|can you|could you|would you)\s*/i, '').trim();
    return cleaned;
}

function initializeVoice() {
    if (!SpeechRecognition) {
        console.warn('[JARVIS] Web Speech API not supported in this browser.');
        if (enableVoiceBtn) {
            enableVoiceBtn.style.display = 'none';
        }
        return;
    }

    updateVoiceToggleUI();

    if (isContinuousVoiceEnabled) {
        console.log('[JARVIS] Voice initialized with continuous mode.');
        startWakeWordListener();
    }
}

function updateVoiceToggleUI() {
    if (!enableVoiceBtn) return;
    if (isContinuousVoiceEnabled) {
        enableVoiceBtn.classList.add('active');
        if (enableVoiceText) enableVoiceText.textContent = 'Voice Active';
        enableVoiceBtn.title = "Click to disable continuous 'Hey JARVIS' listening";
    } else {
        enableVoiceBtn.classList.remove('active');
        if (enableVoiceText) enableVoiceText.textContent = 'Enable Voice';
        enableVoiceBtn.title = "Click to enable continuous 'Hey JARVIS' voice listening";
    }
}

function toggleContinuousVoice() {
    if (!SpeechRecognition) {
        alert('Speech recognition is not supported in this browser. Please use Chrome or Edge.');
        return;
    }

    isContinuousVoiceEnabled = !isContinuousVoiceEnabled;
    localStorage.setItem('jarvis_continuous_voice', isContinuousVoiceEnabled);
    updateVoiceToggleUI();

    if (isContinuousVoiceEnabled) {
        console.log('[JARVIS] Continuous voice listening enabled.');
        startWakeWordListener();
    } else {
        console.log('[JARVIS] Continuous voice listening disabled.');
        cleanupVoice();
    }
}

function startWakeWordListener() {
    if (!SpeechRecognition || !isContinuousVoiceEnabled || isSpeakingTTS) return;

    // Prevent duplicate listeners
    stopWakeWordListener();
    stopCommandListener();

    try {
        wakeRecognition = new SpeechRecognition();
        wakeRecognition.continuous = true;
        wakeRecognition.interimResults = true;
        wakeRecognition.lang = 'en-US';
        wakeRecognition.maxAlternatives = 1;

        wakeRecognition.onstart = () => {
            console.log('[JARVIS] Wake listener started - Waiting for Hey JARVIS');
            updateVoiceState('STANDBY', 'Listening for Hey JARVIS');
        };

        wakeRecognition.onresult = (event) => {
            if (isSpeakingTTS) return;

            let transcript = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                transcript += event.results[i][0].transcript;
            }

            const normalized = normalizeWakeWord(transcript);
            if (isWakeWordDetected(normalized)) {
                console.log(`[JARVIS] Wake word detected in: "${transcript}"`);
                stopWakeWordListener();

                const inlineCmd = extractInlineCommand(normalized);
                if (inlineCmd && inlineCmd.length > 2) {
                    // Inline single-shot command: "Hey JARVIS open Calculator"
                    console.log(`[JARVIS] Direct inline command: "${inlineCmd}"`);
                    handleUserMessage(inlineCmd, { fromVoice: true });
                } else {
                    // Two-step wake: "Hey JARVIS" -> "Yes, Sir." -> Listen for command
                    updateVoiceState('SPEAKING', 'Speaking...');
                    speakMessage("Yes, Sir.", null, () => {
                        startCommandListener();
                    });
                }
            }
        };

        wakeRecognition.onerror = (event) => {
            if (event.error === 'not-allowed') {
                console.error('[JARVIS] Microphone permission denied.');
                isContinuousVoiceEnabled = false;
                localStorage.setItem('jarvis_continuous_voice', false);
                updateVoiceToggleUI();
                updateVoiceState('ERROR', 'Microphone permission denied');
                return;
            }
            // Auto-restart quietly on no-speech or network glitches
            if (isContinuousVoiceEnabled && !isSpeakingTTS) {
                clearTimeout(wakeWordRestartTimer);
                wakeWordRestartTimer = setTimeout(() => {
                    if (isContinuousVoiceEnabled && !isSpeakingTTS && voiceState === 'STANDBY') {
                        startWakeWordListener();
                    }
                }, 800);
            }
        };

        wakeRecognition.onend = () => {
            wakeRecognition = null;
            if (isContinuousVoiceEnabled && !isSpeakingTTS && (voiceState === 'STANDBY' || voiceState === 'IDLE')) {
                clearTimeout(wakeWordRestartTimer);
                wakeWordRestartTimer = setTimeout(() => {
                    if (isContinuousVoiceEnabled && !isSpeakingTTS && voiceState === 'STANDBY') {
                        startWakeWordListener();
                    }
                }, 300);
            }
        };

        wakeRecognition.start();
    } catch (e) {
        console.warn('[JARVIS] Wake word start error:', e);
    }
}

function stopWakeWordListener() {
    clearTimeout(wakeWordRestartTimer);
    if (wakeRecognition) {
        try {
            wakeRecognition.onend = null;
            wakeRecognition.onerror = null;
            wakeRecognition.abort();
        } catch (e) {}
        wakeRecognition = null;
    }
}

function startCommandListener() {
    if (!SpeechRecognition || isSpeakingTTS) return;

    stopWakeWordListener();
    stopCommandListener();

    try {
        commandRecognition = new SpeechRecognition();
        commandRecognition.continuous = false;
        commandRecognition.interimResults = false;
        commandRecognition.lang = 'en-US';
        commandRecognition.maxAlternatives = 1;

        updateVoiceState('LISTENING', 'Listening...');
        console.log('[JARVIS] Command listening started.');

        commandRecognition.onresult = (event) => {
            const commandText = event.results[0][0].transcript.trim();
            console.log(`[JARVIS] Command received: "${commandText}"`);
            stopCommandListener();
            handleUserMessage(commandText, { fromVoice: true });
        };

        commandRecognition.onerror = (event) => {
            console.warn('[JARVIS] Command listening error:', event.error);
            stopCommandListener();
            updateVoiceState('STANDBY');
            if (isContinuousVoiceEnabled) {
                setTimeout(startWakeWordListener, 400);
            }
        };

        commandRecognition.onend = () => {
            commandRecognition = null;
            if (voiceState === 'LISTENING') {
                updateVoiceState('STANDBY');
                if (isContinuousVoiceEnabled && !isSpeakingTTS) {
                    setTimeout(startWakeWordListener, 300);
                }
            }
        };

        commandRecognition.start();
    } catch (e) {
        console.warn('[JARVIS] Command start error:', e);
        updateVoiceState('STANDBY');
        if (isContinuousVoiceEnabled) startWakeWordListener();
    }
}

function stopCommandListener() {
    if (commandRecognition) {
        try {
            commandRecognition.onend = null;
            commandRecognition.onerror = null;
            commandRecognition.abort();
        } catch (e) {}
        commandRecognition = null;
    }
}

function restartVoiceListener() {
    cleanupVoice();
    if (isContinuousVoiceEnabled) {
        startWakeWordListener();
    }
}

function cleanupVoice() {
    stopWakeWordListener();
    stopCommandListener();
    stopManualRecognition();
    stopSpeech();
    updateVoiceState('STANDBY');
}

// Manual "Tap to Speak" Fallback
function toggleVoiceInput() {
    if (!SpeechRecognition) {
        alert('Speech recognition is not supported in this browser. Please use Chrome or Edge.');
        return;
    }

    if (manualRecognition) {
        stopManualRecognition();
        return;
    }

    stopWakeWordListener();
    stopCommandListener();
    stopSpeech();

    try {
        manualRecognition = new SpeechRecognition();
        manualRecognition.continuous = false;
        manualRecognition.interimResults = true;
        manualRecognition.lang = 'en-US';

        manualRecognition.onstart = () => {
            isRecording = true;
            updateVoiceState('LISTENING', 'Listening...');
            if (voiceBtn) {
                voiceBtn.classList.add('recording');
                voiceBtn.title = 'Click to stop listening';
            }
        };

        manualRecognition.onresult = (event) => {
            let transcript = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                transcript += event.results[i][0].transcript;
            }
            if (userInput) {
                userInput.value = transcript;
                userInput.focus();
            }
        };

        manualRecognition.onerror = (event) => {
            console.error('[JARVIS] Manual recognition error:', event.error);
            stopManualRecognition();
        };

        manualRecognition.onend = () => {
            isRecording = false;
            manualRecognition = null;
            if (voiceBtn) {
                voiceBtn.classList.remove('recording');
                voiceBtn.title = 'Speech to text input';
            }
            if (userInput && userInput.value.trim().length > 0) {
                handleUserMessage(userInput.value, { fromVoice: true });
            } else {
                updateVoiceState('STANDBY');
                if (isContinuousVoiceEnabled) setTimeout(startWakeWordListener, 400);
            }
        };

        manualRecognition.start();
    } catch (e) {
        console.error('[JARVIS] Manual voice start failed:', e);
        stopManualRecognition();
    }
}

function stopManualRecognition() {
    if (manualRecognition) {
        try {
            manualRecognition.abort();
        } catch (e) {}
        manualRecognition = null;
    }
    isRecording = false;
    if (voiceBtn) {
        voiceBtn.classList.remove('recording');
        voiceBtn.title = 'Speech to text input';
    }
    updateVoiceState('STANDBY');
    if (isContinuousVoiceEnabled && !isSpeakingTTS) {
        setTimeout(startWakeWordListener, 300);
    }
}

// ============================================================
// TEXT-TO-SPEECH (TTS) ENGINE
// ============================================================

const synth = window.speechSynthesis;

const JARVIS_VOICE_PRIORITY = [
    'Google UK English Male',   // Preferred Iron Man accent
    'Samantha',                  // Clean fallback
    'Daniel',                    // British male
    'Google US English',         // Neutral English
    'Microsoft David Desktop',   // Windows desktop voice
    'Microsoft Mark Online',     // Edge voice
    'en-GB',                     // British English
];

const JARVIS_VOICE_SETTINGS = {
    pitch: 0.9,
    rate: 1.0,
    volume: 1.0
};

let cachedVoices = [];
let jarvisVoice = null;

function selectJarvisVoice(voices) {
    if (!voices || voices.length === 0) return null;
    for (const name of JARVIS_VOICE_PRIORITY) {
        const match = voices.find(v => v.name === name);
        if (match) return match;
    }
    for (const name of JARVIS_VOICE_PRIORITY) {
        const match = voices.find(v => v.name.includes(name));
        if (match) return match;
    }
    const engMale = voices.find(v =>
        (v.lang.startsWith('en')) &&
        (v.name.toLowerCase().includes('male') || 
         v.name.includes('David') ||
         v.name.includes('Daniel') ||
         v.name.includes('James') ||
         v.name.includes('Mark'))
    );
    if (engMale) return engMale;
    const enGB = voices.find(v => v.lang === 'en-GB');
    if (enGB) return enGB;
    return null;
}

function initJarvisVoice() {
    if (!synth) return;
    const voices = synth.getVoices();
    if (voices && voices.length > 0) {
        cachedVoices = voices;
        jarvisVoice = selectJarvisVoice(voices);
        if (jarvisVoice) {
            console.log(`[JARVIS] Voice initialized: "${jarvisVoice.name}" (${jarvisVoice.lang})`);
        }
    }
}

if (synth) {
    initJarvisVoice();
    if (typeof speechSynthesis.onvoiceschanged !== 'undefined') {
        speechSynthesis.onvoiceschanged = initJarvisVoice;
    }
}

function stopSpeech() {
    if (synth && synth.speaking) {
        synth.cancel();
    }
    isSpeakingTTS = false;
    currentlySpeakingMsgId = null;
    updateSpeakerButtonsUI();
}

function toggleSpeechForMessage(text, msgId) {
    if (currentlySpeakingMsgId === msgId) {
        stopSpeech();
        return;
    }
    stopSpeech();
    speakMessage(text, msgId);
}

function speakMessage(text, msgId = null, onDoneCallback = null) {
    if (!synth) {
        if (onDoneCallback) onDoneCallback();
        return;
    }

    stopSpeech();

    // Pause wake recognition while speaking to prevent self-triggering
    isSpeakingTTS = true;
    stopWakeWordListener();
    stopCommandListener();
    updateVoiceState('SPEAKING', 'Speaking...');

    currentlySpeakingMsgId = msgId;
    updateSpeakerButtonsUI();

    // Clean text for speech (strip markdown asterisks, code blocks, URLs)
    const cleanSpeechText = text
        .replace(/```[\s\S]*?```/g, 'Code block omitted.')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/https?:\/\/\S+/g, 'link')
        .trim();

    const utterance = new SpeechSynthesisUtterance(cleanSpeechText);
    if (jarvisVoice) {
        utterance.voice = jarvisVoice;
    }
    utterance.pitch = JARVIS_VOICE_SETTINGS.pitch;
    utterance.rate = JARVIS_VOICE_SETTINGS.rate;
    utterance.volume = JARVIS_VOICE_SETTINGS.volume;
    utterance.lang = jarvisVoice ? jarvisVoice.lang : 'en-GB';

    utterance.onend = () => {
        isSpeakingTTS = false;
        currentlySpeakingMsgId = null;
        updateSpeakerButtonsUI();
        if (onDoneCallback) {
            onDoneCallback();
        } else {
            updateVoiceState('STANDBY');
            if (isContinuousVoiceEnabled) {
                setTimeout(startWakeWordListener, 400);
            }
        }
    };

    utterance.onerror = (e) => {
        console.error('[JARVIS] TTS error:', e);
        isSpeakingTTS = false;
        currentlySpeakingMsgId = null;
        updateSpeakerButtonsUI();
        if (onDoneCallback) {
            onDoneCallback();
        } else {
            updateVoiceState('STANDBY');
            if (isContinuousVoiceEnabled) {
                setTimeout(startWakeWordListener, 400);
            }
        }
    };

    synth.speak(utterance);
}

function updateSpeakerButtonsUI() {
    const buttons = document.querySelectorAll('.message-speaker-btn');
    buttons.forEach(btn => {
        const btnMsgId = btn.getAttribute('data-msg-id');
        if (currentlySpeakingMsgId && btnMsgId === currentlySpeakingMsgId) {
            btn.classList.add('speaking');
            btn.innerHTML = '⏹ Stop';
            btn.title = 'Stop speaking';
        } else {
            btn.classList.remove('speaking');
            btn.innerHTML = '🔊 Listen';
            btn.title = 'Read response aloud';
        }
    });
}


function cleanAIResponse(text) {
    if (!text || typeof text !== 'string') return '';
    let cleaned = text;
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '');
    cleaned = cleaned.replace(/<thought>[\s\S]*?<\/thought>/gi, '');
    cleaned = cleaned.replace(/<think>[\s\S]*$/gi, '');
    cleaned = cleaned.replace(/<thought>[\s\S]*$/gi, '');

    const finalAnswerMatch = cleaned.match(/(?:Final Answer|Final Response|Actual Response):\s*([\s\S]+)/i);
    if (finalAnswerMatch && finalAnswerMatch[1].trim()) {
        cleaned = finalAnswerMatch[1];
    } else {
        cleaned = cleaned.replace(/^(?:\*{0,2}(?:Here's a thinking process|Thinking Process|Analyze User Input|Draft Response|Chain of Thought|Internal Reasoning)\*{0,2}:?[\s\S]*?)(?=\n\n[A-Z]|\n\n\*{0,2}(?:Final Answer|Final Response|Response|Answer)\*{0,2}:?|$)/gi, '');
    }
    cleaned = cleaned.replace(/^(?:\*{0,2}(?:Here's a thinking process|Thinking Process|Analyze User Input|Draft Response|Chain of Thought|Internal Reasoning)\*{0,2}:?)\s*/gi, '');
    return cleaned.trim();
}

// ============================================================
// LONG-TERM MEMORY SYSTEM
// ============================================================

// Memory API Helpers
async function fetchMemories() {
    try {
        const res = await fetch('/api/memories');
        if (!res.ok) return [];
        const data = await res.json();
        return data.memories || [];
    } catch (e) {
        console.error('Failed to fetch memories:', e);
        return [];
    }
}

async function createMemory(content, category = 'fact') {
    try {
        const res = await fetch('/api/memories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content, category })
        });
        return await res.json();
    } catch (e) {
        console.error('Failed to create memory:', e);
        return null;
    }
}

async function deleteMemory(memId) {
    try {
        const res = await fetch(`/api/memories/${memId}`, { method: 'DELETE' });
        return res.ok;
    } catch (e) {
        console.error('Failed to delete memory:', e);
        return false;
    }
}

async function deleteAllMemories() {
    try {
        const res = await fetch('/api/memories?confirm=true', { method: 'DELETE' });
        return res.ok;
    } catch (e) {
        console.error('Failed to delete all memories:', e);
        return false;
    }
}

async function loadMemorySettings() {
    try {
        const res = await fetch('/api/memory-settings');
        if (!res.ok) return;
        const data = await res.json();
        isMemoryEnabled = data.enabled !== false;
        if (memoryToggle) memoryToggle.checked = isMemoryEnabled;
    } catch (e) {
        console.error('Failed to load memory settings:', e);
    }
}

async function updateMemorySettings(enabled) {
    try {
        const res = await fetch('/api/memory-settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled })
        });
        if (res.ok) {
            isMemoryEnabled = enabled;
        }
    } catch (e) {
        console.error('Failed to update memory settings:', e);
    }
}

// Find a memory by content similarity (for "forget that..." commands)
async function findAndDeleteMemory(searchText) {
    const memories = await fetchMemories();
    if (memories.length === 0) return false;

    const searchWords = new Set(searchText.toLowerCase().split(/\s+/).filter(w => w.length > 2));

    let bestMatch = null;
    let bestScore = 0;

    for (const mem of memories) {
        const memWords = mem.content.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        let score = 0;
        for (const w of memWords) {
            if (searchWords.has(w) || [...searchWords].some(sw => w.includes(sw) || sw.includes(w))) {
                score++;
            }
        }
        const ratio = score / Math.max(memWords.length, 1);
        if (ratio > bestScore && ratio >= 0.3) {
            bestScore = ratio;
            bestMatch = mem;
        }
    }

    if (bestMatch) {
        return await deleteMemory(bestMatch.id);
    }
    return false;
}

// Add a JARVIS response to chat without calling AI API
function addLocalSystemMessage(text) {
    const activeConv = getActiveConversation();
    if (!activeConv) return;

    const aiMsgId = generateId('msg');
    const aiMsgObj = {
        id: aiMsgId,
        text: text,
        sender: 'system',
        timestamp: Date.now()
    };
    activeConv.messages.push(aiMsgObj);
    activeConv.updatedAt = Date.now();
    saveToStorage();

    renderMessageDOM(text, 'system', aiMsgId);
    setTimeout(() => scrollToBottom(false), 100);

    if (isAutoSpeakEnabled) {
        speakMessage(text, aiMsgId);
    }
    renderHistoryList();
}

// Handle memory-specific commands — returns true if handled, false if not a memory command
async function handleMemoryCommand(text) {
    const lower = text.toLowerCase().trim();

    // Handle pending "forget everything" confirmation
    if (pendingMemoryClear) {
        pendingMemoryClear = false;
        if (lower === 'yes' || lower.includes('yes, forget everything') || lower.includes('yes forget everything') || lower.includes('confirm')) {
            await deleteAllMemories();
            addLocalSystemMessage("Done, Sir. I've forgotten everything. My memory has been completely cleared.");
            return true;
        } else {
            addLocalSystemMessage("Memory clear cancelled, Sir. Your memories are safe.");
            return true;
        }
    }

    // "Remember that..." — explicit save
    const rememberMatch = text.match(/^remember\s+(?:that\s+|this:\s*)?(.+)/i);
    if (rememberMatch && rememberMatch[1].trim().length > 2) {
        const content = rememberMatch[1].trim();
        const result = await createMemory(content, 'fact');
        if (result && result.success) {
            const action = result.action === 'updated' ? "updated that in my memory" : "remember that";
            addLocalSystemMessage(`I'll ${action}, Sir.`);
        } else {
            addLocalSystemMessage("I apologize, Sir. I wasn't able to save that to memory.");
        }
        return true;
    }

    // "Forget that..." / "Forget about..." — delete matching memory
    const forgetMatch = text.match(/^forget\s+(?:that\s+|about\s+)?(.+)/i);
    if (forgetMatch && forgetMatch[1].trim().length > 2 && !lower.includes('forget everything')) {
        const searchText = forgetMatch[1].trim();
        const deleted = await findAndDeleteMemory(searchText);
        if (deleted) {
            addLocalSystemMessage("Done. I've forgotten that, Sir.");
        } else {
            addLocalSystemMessage("I don't seem to have that in my memory, Sir.");
        }
        return true;
    }

    // "Forget everything" / "Clear all memories"
    if (lower === 'forget everything' || lower === 'clear all memories' ||
        lower === 'forget everything you remember' || lower === 'delete all memories' ||
        lower === 'forget everything about me' || lower.includes('forget everything you remember about me')) {
        const memories = await fetchMemories();
        if (memories.length === 0) {
            addLocalSystemMessage("I don't have any memories to clear, Sir.");
            return true;
        }
        pendingMemoryClear = true;
        addLocalSystemMessage("Are you sure you want me to forget everything, Sir? Say \"Yes, forget everything\" to confirm, or anything else to cancel.");
        return true;
    }

    return false;
}

// ============================================================
// END MEMORY SYSTEM
// ============================================================

async function getAIResponse(prompt, fileAttachment = null, conversationId = null, conversationMessages = []) {
    updateVoiceState('PROCESSING', 'Thinking...');

    const systemPrompt = {
        role: 'system',
        content: 'You are JARVIS, an intelligent, calm, fast, respectful, professional, and slightly futuristic personal AI assistant created and developed by Kartik Aher. ' +
            'Personality & Tone: Calm, intelligent, fast, respectful, natural, professional, slightly futuristic. Be concise and direct during voice interactions (1-3 sentences suitable for speech), while being thorough and helpful during normal chat when coding, answering study questions, or explaining concepts. ' +
            'Use natural assistant phrasing when appropriate (e.g. "Yes, Sir.", "Certainly, Sir.", "Opening Chrome.", "VS Code is open, Sir.", "That action requires your confirmation.", "Sir, the desktop agent is currently offline."), but do not make every response overly dramatic and do not constantly repeat "Sir" in every single sentence. ' +
            'If anyone asks who made you, who created you, who built you, who developed you, who owns you, or who is your creator, always answer that Kartik Aher created and developed this JARVIS application. ' +
            'Do NOT say Kartik Aher created OpenAI, Groq, or the underlying AI model — only that he built this JARVIS application. ' +
            'Output ONLY the direct final answer. Never output internal reasoning, thinking process, chain-of-thought, system prompts, developer instructions, or section headers like "Thinking Process" or "Analyze User Input". ' +
            'Keep answers concise, clear, and accurate. For simple questions, give a simple, direct answer.'
    };

    if (fileAttachment && fileAttachment.textContent) {
        systemPrompt.content += `\n\nATTACHED DOCUMENT CONTEXT:\nDocument Filename: ${fileAttachment.filename}\nDocument Content:\n"""\n${fileAttachment.textContent}\n"""\nAnswer the user's questions accurately based strictly on the uploaded document contents. Do not invent information that is not present in the document. If the requested information is not in the document, state that clearly.`;
    }

    // Build conversation context from the current conversation's history
    const formattedHistory = [];
    if (Array.isArray(conversationMessages) && conversationMessages.length > 0) {
        const pastMsgs = conversationMessages.slice(0, -1);
        for (const msg of pastMsgs) {
            if (msg.text === DEFAULT_WELCOME_MSG && msg.sender === 'system') continue;
            if (!msg.text || typeof msg.text !== 'string' || !msg.text.trim()) continue;

            formattedHistory.push({
                role: msg.sender === 'user' ? 'user' : 'assistant',
                content: msg.text
            });
        }
    }

    const payloadMessages = [
        systemPrompt,
        ...formattedHistory,
        { role: 'user', content: prompt }
    ];

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                conversationId: conversationId || activeConversationId,
                messages: payloadMessages,
                max_tokens: 800
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            if (response.status === 401) throw new Error('Invalid or missing server API key.');
            if (response.status === 403) throw new Error('Access denied (403). Please check your server API key configuration.');
            if (response.status === 429) throw new Error('Rate limit exceeded or out of credits.');
            throw new Error(errorData.error?.message || `API Error ${response.status}`);
        }

        const data = await response.json();
        const rawContent = data.choices?.[0]?.message?.content || '';
        const cleanedResponse = cleanAIResponse(rawContent);
        return cleanedResponse || "I apologize, Sir, but I received an empty response.";
    } catch (error) {
        console.error('[JARVIS] AI error:', error);
        if (error.message === 'Failed to fetch') {
            return "I apologize, Sir. I encountered a network error connecting to the server backend.";
        }
        return `I apologize, Sir. ${error.message || "I'm having trouble connecting to my central processing unit."}`;
    } finally {
        if (!isSpeakingTTS && voiceState === 'PROCESSING') {
            updateVoiceState('STANDBY');
        }
    }
}

// User Message Processing
async function handleUserMessage(text, options = {}) {
    const trimmed = text.trim();
    if (!trimmed) return;

    const fromVoice = options.fromVoice === true;

    let activeConv = getActiveConversation();
    if (!activeConv) {
        startNewChat(false);
        activeConv = getActiveConversation();
    }

    // Auto-title conversation on first user prompt
    if (activeConv.title === 'New Conversation' || activeConv.title === 'New Chat') {
        activeConv.title = trimmed.length > 30 ? trimmed.slice(0, 30) + '...' : trimmed;
    }

    const currentFile = activeConv.fileAttachment ? { ...activeConv.fileAttachment } : null;

    // Add user message to state
    const userMsgId = generateId('msg');
    const userMsgObj = {
        id: userMsgId,
        text: trimmed,
        sender: 'user',
        timestamp: Date.now(),
        attachedFile: currentFile ? currentFile.filename : null
    };
    activeConv.messages.push(userMsgObj);
    activeConv.updatedAt = Date.now();
    saveToStorage();

    // Render user message to DOM
    renderMessageDOM(trimmed, 'user', userMsgId, currentFile ? currentFile.filename : null);
    if (userInput) userInput.value = '';
    scrollToBottom(true);
    renderHistoryList();

    // 1. Handle Pending Dangerous Action Confirmation (Shutdown / Restart)
    if (pendingActionConfirmation) {
        const lower = trimmed.toLowerCase();
        const actionType = pendingActionConfirmation;
        pendingActionConfirmation = null;

        if (lower.includes('yes') || lower.includes('confirm') || lower.includes('proceed') || lower.includes('continue') || lower.includes('do it')) {
            const confirmedAction = actionType === 'PROMPT_SHUTDOWN' ? 'CONFIRMED_SHUTDOWN' : 'CONFIRMED_RESTART';
            const actionRes = await executeDesktopAction(confirmedAction);
            const replyMsg = actionRes.success ? (actionRes.message || 'Action executed, Sir.') : (actionRes.message || 'Sir, the desktop agent is currently offline.');
            addLocalSystemMessage(replyMsg, { speak: isAutoSpeakEnabled || fromVoice });
            return;
        } else {
            addLocalSystemMessage("Action cancelled, Sir. Session remains active.", { speak: isAutoSpeakEnabled || fromVoice });
            return;
        }
    }

    // 2. Check for memory commands (remember/forget/what do you remember)
    const wasMemoryCommand = await handleMemoryCommand(trimmed);
    if (wasMemoryCommand) return;

    // 3. Check for Direct Desktop Action (Chrome, VS Code, Calculator, YouTube, Folders, Lock PC, etc.)
    const desktopActionMatch = matchDesktopAction(trimmed);
    if (desktopActionMatch) {
        updateVoiceState('PROCESSING', 'Thinking...');

        if (desktopActionMatch.action === 'PROMPT_SHUTDOWN' || desktopActionMatch.action === 'PROMPT_RESTART') {
            pendingActionConfirmation = desktopActionMatch.action;
            addLocalSystemMessage(desktopActionMatch.speech, { speak: isAutoSpeakEnabled || fromVoice });
            return;
        }

        const actionRes = await executeDesktopAction(desktopActionMatch.action, desktopActionMatch.target, desktopActionMatch.params);
        let finalReply = '';

        if (actionRes.error === 'DESKTOP_AGENT_OFFLINE') {
            finalReply = "Sir, the desktop agent is currently offline.";
        } else if (actionRes.success) {
            finalReply = desktopActionMatch.speech || actionRes.message || 'Action completed, Sir.';
        } else {
            finalReply = actionRes.message || 'Sir, I was unable to execute the desktop action.';
        }

        addLocalSystemMessage(finalReply, { speak: isAutoSpeakEnabled || fromVoice });
        return;
    }

    // 4. Normal AI Chat / Coding / Study / General Knowledge Question
    const convId = activeConv.id;
    const convMessages = [...activeConv.messages];

    const responseText = await getAIResponse(trimmed, currentFile, convId, convMessages);

    let targetConv = conversations.find(c => c.id === convId);
    if (!targetConv) targetConv = getActiveConversation();

    const aiMsgId = generateId('msg');
    const aiMsgObj = {
        id: aiMsgId,
        text: responseText,
        sender: 'system',
        timestamp: Date.now()
    };
    if (targetConv) {
        targetConv.messages.push(aiMsgObj);
        targetConv.updatedAt = Date.now();
        saveToStorage();
    }

    const currentActive = getActiveConversation();
    if (currentActive && currentActive.id === convId) {
        renderMessageDOM(responseText, 'system', aiMsgId);
        setTimeout(() => {
            scrollToBottom(false);
        }, 100);

        // Speak if auto-read is enabled OR if requested via voice interaction
        if (isAutoSpeakEnabled || fromVoice) {
            speakMessage(responseText, aiMsgId);
        } else {
            updateVoiceState('STANDBY');
            if (isContinuousVoiceEnabled && !isSpeakingTTS) {
                setTimeout(startWakeWordListener, 300);
            }
        }
    }
    renderHistoryList();
}

// App Initialization
window.addEventListener('load', () => {
    console.log('[JARVIS] Initializing unified assistant application...');
    loadFromStorage();

    if (conversations.length === 0 || !activeConversationId || !getActiveConversation()) {
        startNewChat(false);
    } else {
        renderActiveConversation();
        renderHistoryList();
        renderFilePreview();
    }

    if (synth) initJarvisVoice();
    if (userInput) userInput.focus();

    // Load memory settings from server
    loadMemorySettings();

    // Check desktop agent connection status
    pollDesktopAgentStatus();

    // Initialize voice and wake word listener if enabled
    initializeVoice();
});

// UI Event Listeners
if (enableVoiceBtn) {
    enableVoiceBtn.addEventListener('click', toggleContinuousVoice);
}

if (newChatBtn) {
    newChatBtn.addEventListener('click', () => startNewChat(true));
}

if (drawerNewChatBtn) {
    drawerNewChatBtn.addEventListener('click', () => startNewChat(true));
}

if (historyBtn) {
    historyBtn.addEventListener('click', () => {
        renderHistoryList();
        if (historyDrawer) historyDrawer.classList.add('open');
    });
}

if (closeHistoryBtn) {
    closeHistoryBtn.addEventListener('click', () => {
        if (historyDrawer) historyDrawer.classList.remove('open');
    });
}

if (closeHistoryBackdrop) {
    closeHistoryBackdrop.addEventListener('click', () => {
        if (historyDrawer) historyDrawer.classList.remove('open');
    });
}

if (cancelDeleteBtn) {
    cancelDeleteBtn.addEventListener('click', () => {
        pendingDeleteConvId = null;
        if (deleteModal) deleteModal.style.display = 'none';
    });
}

if (confirmDeleteBtn) {
    confirmDeleteBtn.addEventListener('click', confirmDeleteConversation);
}

if (attachBtn && fileInput) {
    attachBtn.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            handleFileUpload(e.target.files[0]);
        }
    });
}

if (voiceBtn) {
    voiceBtn.addEventListener('click', toggleVoiceInput);
}

const orbTrigger = document.getElementById('orb-trigger');
if (orbTrigger) {
    orbTrigger.addEventListener('click', toggleVoiceInput);
}

if (sendBtn) {
    sendBtn.addEventListener('click', () => {
        if (userInput) handleUserMessage(userInput.value);
    });
}

if (userInput) {
    userInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            handleUserMessage(userInput.value);
        }
    });
}

if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
        if (settingsModal) settingsModal.style.display = 'flex';
    });
}

if (closeSettings) {
    closeSettings.addEventListener('click', () => {
        if (settingsModal) settingsModal.style.display = 'none';
    });
}

if (autoSpeakToggle) {
    autoSpeakToggle.addEventListener('change', (e) => {
        isAutoSpeakEnabled = e.target.checked;
        saveToStorage();
        if (!isAutoSpeakEnabled) {
            stopSpeech();
        }
    });
}

if (clearChatBtn) {
    clearChatBtn.addEventListener('click', () => {
        if (confirm("Sir, are you sure you want to clear this conversation?")) {
            stopSpeech();
            const activeConv = getActiveConversation();
            if (activeConv) {
                activeConv.messages = [
                    {
                        id: generateId('msg'),
                        text: DEFAULT_WELCOME_MSG,
                        sender: 'system',
                        timestamp: Date.now()
                    }
                ];
                activeConv.fileAttachment = null;
                activeConv.updatedAt = Date.now();
                saveToStorage();
                renderActiveConversation();
                renderHistoryList();
                renderFilePreview();
            }
            if (settingsModal) settingsModal.style.display = 'none';
        }
    });
}

// Memory toggle (enable/disable)
if (memoryToggle) {
    memoryToggle.addEventListener('change', (e) => {
        updateMemorySettings(e.target.checked);
    });
}

