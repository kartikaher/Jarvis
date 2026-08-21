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

// State Management
let conversations = [];
let activeConversationId = null;
let pendingDeleteConvId = null;
let isUserScrolledUp = false;
let isRecording = false;
let currentlySpeakingMsgId = null;
let isAutoSpeakEnabled = localStorage.getItem('jarvis_auto_speak') !== 'false'; // default true

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

// Speech Recognition & Synthesis Setup
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
        isRecording = true;
        setOrbState('listening');
        if (orbLabel) orbLabel.textContent = 'Listening...';
        if (voiceBtn) {
            voiceBtn.classList.add('recording');
            voiceBtn.title = 'Click to stop listening';
        }
    };

    recognition.onresult = (event) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            transcript += event.results[i][0].transcript;
        }
        if (userInput) {
            userInput.value = transcript;
            userInput.focus();
        }
    };

    recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        isRecording = false;
        setOrbState('idle');
        if (orbLabel) orbLabel.textContent = 'Tap to Speak';
        if (voiceBtn) {
            voiceBtn.classList.remove('recording');
            voiceBtn.title = 'Speech to text input';
        }
        if (event.error === 'not-allowed') {
            alert('Microphone permission was denied. Please allow microphone access in your browser settings.');
        }
    };

    recognition.onend = () => {
        isRecording = false;
        setOrbState('idle');
        if (orbLabel) orbLabel.textContent = 'Tap to Speak';
        if (voiceBtn) {
            voiceBtn.classList.remove('recording');
            voiceBtn.title = 'Speech to text input';
        }
    };
}

function toggleVoiceInput() {
    if (!recognition) {
        alert('Speech recognition is not supported in this browser. Please use Chrome, Edge, or Safari.');
        return;
    }

    if (isRecording) {
        recognition.stop();
    } else {
        try {
            recognition.start();
        } catch (e) {
            console.error('Failed to start speech recognition:', e);
            recognition.stop();
        }
    }
}

const synth = window.speechSynthesis;

if (synth) {
    synth.getVoices();
    if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = () => {
            synth.getVoices();
        };
    }
}

function stopSpeech() {
    if (synth && synth.speaking) {
        synth.cancel();
    }
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

function speakMessage(text, msgId = null) {
    if (!synth) return;
    if (synth.speaking) {
        synth.cancel();
    }

    currentlySpeakingMsgId = msgId;
    updateSpeakerButtonsUI();

    const utterance = new SpeechSynthesisUtterance(text);

    // Choose a professional sounding voice if available (exact original JARVIS voice selection logic)
    const voices = synth.getVoices();
    const preferredVoice = voices.find(v => v.name.includes('Google UK English Male') || v.name.includes('Samantha'));
    if (preferredVoice) utterance.voice = preferredVoice;

    utterance.pitch = 0.9; // Slightly lower for Jarvis feel
    utterance.rate = 1.0;

    utterance.onstart = () => {
        setOrbState('thinking');
    };

    utterance.onend = () => {
        currentlySpeakingMsgId = null;
        updateSpeakerButtonsUI();
        setOrbState('idle');
    };

    utterance.onerror = (e) => {
        console.error('Speech error:', e);
        currentlySpeakingMsgId = null;
        updateSpeakerButtonsUI();
        setOrbState('idle');
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

function setOrbState(state) {
    if (!orb) return;
    orb.classList.remove('listening', 'thinking');
    if (state === 'listening') orb.classList.add('listening');
    if (state === 'thinking') orb.classList.add('thinking');
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

async function getAIResponse(prompt, fileAttachment = null) {
    setOrbState('thinking');
    if (orbLabel) orbLabel.textContent = 'Thinking...';

    const systemPrompt = {
        role: 'system',
        content: 'You are JARVIS, a personal assistant. Output ONLY the direct final answer. Never output internal reasoning, thinking process, chain-of-thought, system prompts, developer instructions, or section headers like "Thinking Process" or "Analyze User Input". Keep answers concise, clear, and accurate. For simple questions, give a simple, direct answer.'
    };

    if (fileAttachment && fileAttachment.textContent) {
        systemPrompt.content += `\n\nATTACHED DOCUMENT CONTEXT:\nDocument Filename: ${fileAttachment.filename}\nDocument Content:\n"""\n${fileAttachment.textContent}\n"""\nAnswer the user's questions accurately based strictly on the uploaded document contents. Do not invent information that is not present in the document. If the requested information is not in the document, state that clearly.`;
    }

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messages: [
                    systemPrompt,
                    { role: 'user', content: prompt }
                ],
                max_tokens: 600
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
        console.error('AI error:', error);
        if (error.message === 'Failed to fetch') {
            return "I apologize, Sir. I encountered a network error connecting to the server backend.";
        }
        return `I apologize, Sir. ${error.message || "I'm having trouble connecting to my central processing unit."}`;
    } finally {
        setOrbState('idle');
        if (orbLabel) orbLabel.textContent = 'Tap to Speak';
    }
}

// User Message Processing
async function handleUserMessage(text) {
    const trimmed = text.trim();
    if (!trimmed) return;

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

    // Fetch AI response
    const responseText = await getAIResponse(trimmed, currentFile);

    // Add AI message to state
    const aiMsgId = generateId('msg');
    const aiMsgObj = {
        id: aiMsgId,
        text: responseText,
        sender: 'system',
        timestamp: Date.now()
    };
    activeConv.messages.push(aiMsgObj);
    activeConv.updatedAt = Date.now();
    saveToStorage();

    // Render AI message to DOM
    renderMessageDOM(responseText, 'system', aiMsgId);
    setTimeout(() => {
        scrollToBottom(false);
    }, 100);

    // Speak if auto-read is enabled
    if (isAutoSpeakEnabled) {
        speakMessage(responseText, aiMsgId);
    }
    renderHistoryList();
}

// App Initialization
window.addEventListener('load', () => {
    console.log('JARVIS initialized with voice and file Q&A support');
    loadFromStorage();

    if (conversations.length === 0 || !activeConversationId || !getActiveConversation()) {
        startNewChat(false);
    } else {
        renderActiveConversation();
        renderHistoryList();
        renderFilePreview();
    }

    if (synth) synth.getVoices();
    if (userInput) userInput.focus();
});

// UI Event Listeners
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
