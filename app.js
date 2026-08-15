// DOM Elements
const orb = document.getElementById('jarvis-orb');
const orbLabel = document.getElementById('orb-status');
const chatHistory = document.getElementById('chat-history');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const voiceBtn = document.getElementById('voice-btn');
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const closeSettings = document.getElementById('close-settings');
const saveSettings = document.getElementById('save-settings');
const apiKeyInput = document.getElementById('api-key');

// Configuration
let apiKey = localStorage.getItem('jarvis_api_key') || '';
apiKeyInput.value = apiKey;

let chatMessages = JSON.parse(localStorage.getItem('jarvis_chat_history')) || [];

// Initialization
window.addEventListener('load', () => {
    console.log('JARVIS initialized');
    loadChatHistory();
    // Pre-load voices
    synth.getVoices();
    // Focus input for immediate chatting
    userInput.focus();
});

function loadChatHistory() {
    if (chatMessages.length === 0) {
        addMessage("Hello. I am JARVIS. How can I assist you today?", 'system', false);
    } else {
        chatMessages.forEach(msg => {
            addMessage(msg.text, msg.sender, false);
        });
    }
}
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition;

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
        setOrbState('listening');
        orbLabel.textContent = 'Listening...';
    };

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        handleUserMessage(transcript);
    };

    recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        setOrbState('idle');
        orbLabel.textContent = 'Tap to Speak';
    };

    recognition.onend = () => {
        setOrbState('idle');
        orbLabel.textContent = 'Tap to Speak';
    };
}

// Speech Synthesis Setup
const synth = window.speechSynthesis;

function speak(text) {
    if (synth.speaking) {
        synth.cancel();
    }
    const utterance = new SpeechSynthesisUtterance(text);
    
    // Choose a professional sounding voice if available
    const voices = synth.getVoices();
    const preferredVoice = voices.find(v => v.name.includes('Google UK English Male') || v.name.includes('Samantha'));
    if (preferredVoice) utterance.voice = preferredVoice;
    
    utterance.pitch = 0.9; // Slightly lower for Jarvis feel
    utterance.rate = 1.0;

    utterance.onstart = () => setOrbState('thinking'); // Use thinking state while speaking for visual feedback
    utterance.onend = () => setOrbState('idle');

    synth.speak(utterance);
}

// UI Helpers
function setOrbState(state) {
    orb.classList.remove('listening', 'thinking');
    if (state === 'listening') orb.classList.add('listening');
    if (state === 'thinking') orb.classList.add('thinking');
}

function addMessage(text, sender, save = true) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}`;
    messageDiv.innerHTML = `<div class="message-content">${text}</div>`;
    chatHistory.appendChild(messageDiv);
    chatHistory.scrollTo({
        top: chatHistory.scrollHeight,
        behavior: 'smooth'
    });

    if (save) {
        chatMessages.push({ text, sender });
        localStorage.setItem('jarvis_chat_history', JSON.stringify(chatMessages));
    }
}

// AI Integration
async function getAIResponse(prompt) {
    if (!apiKey) {
        return "Sir, I need an API key to function. Please provide it in the settings.";
    }

    const isGroq = apiKey.startsWith('gsk_');
    const targetEndpoint = isGroq ? 'https://api.groq.com/openai/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
    const model = isGroq ? 'llama-3.1-8b-instant' : 'gpt-3.5-turbo';

    setOrbState('thinking');
    orbLabel.textContent = 'Thinking...';

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'X-Target-Url': targetEndpoint
            },
            body: JSON.stringify({
                model: model,
                messages: [
                    { role: 'system', content: 'You are JARVIS, a personal assistant. Answer exactly what the user asks. Avoid unnecessary explanations, greetings, or long paragraphs. Prefer short paragraphs or bullet points. Give only the required information by default. For simple questions, give a simple, direct answer. Do not repeat the question.' },
                    { role: 'user', content: prompt }
                ],
                max_tokens: 500
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            if (response.status === 401) throw new Error('Invalid API Key. Please check your key in settings.');
            if (response.status === 429) throw new Error('Rate limit exceeded or out of credits. Please check your OpenAI billing.');
            throw new Error(errorData.error?.message || `API Error ${response.status}`);
        }

        const data = await response.json();
        return data.choices[0].message.content;
    } catch (error) {
        console.error('AI error:', error);
        if (error.message === 'Failed to fetch') {
            return "I apologize, Sir. I encountered a network error. This usually happens if your API Key is invalid (which causes a CORS error), or if a browser extension like an adblocker is blocking the request. Please double-check your API key in the settings.";
        }
        if (error.message.includes('Access denied. Please check your network settings.')) {
            return "I apologize, Sir. The API provider (Groq/OpenAI) has denied access. This is usually because they are blocking your current IP address or VPN. Please try disabling your VPN, connecting to a different network, or using a different API provider.";
        }
        return `I apologize, Sir. ${error.message || "I'm having trouble connecting to my central processing unit."}`;
    } finally {
        setOrbState('idle');
        orbLabel.textContent = 'Tap to Speak';
    }
}

// Main Flow
async function handleUserMessage(text) {
    if (!text.trim()) return;
    
    addMessage(text, 'user');
    userInput.value = '';

    const response = await getAIResponse(text);
    addMessage(response, 'system');
    speak(response);
}

// Event Listeners
voiceBtn.addEventListener('click', () => {
    console.log('Voice button clicked');
    if (recognition) {
        try {
            recognition.start();
            console.log('Recognition started');
        } catch (e) {
            console.error('Recognition error or already started:', e);
        }
    } else {
        alert('Speech recognition is not supported in this browser.');
    }
});

const orbTrigger = document.getElementById('orb-trigger');
orbTrigger.addEventListener('click', () => {
    console.log('Orb wrapper clicked');
    voiceBtn.click();
});

sendBtn.addEventListener('click', () => {
    handleUserMessage(userInput.value);
});

userInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        handleUserMessage(userInput.value);
    }
});

settingsBtn.addEventListener('click', () => {
    settingsModal.style.display = 'flex';
});

closeSettings.addEventListener('click', () => {
    settingsModal.style.display = 'none';
});

saveSettings.addEventListener('click', () => {
    apiKey = apiKeyInput.value.trim();
    localStorage.setItem('jarvis_api_key', apiKey);
    settingsModal.style.display = 'none';
    addMessage("API Key saved. I'm ready to assist you.", 'system');
});

const clearChatBtn = document.getElementById('clear-chat');
clearChatBtn.addEventListener('click', () => {
    if (confirm("Sir, are you sure you want to clear our conversation history?")) {
        chatMessages = [];
        localStorage.removeItem('jarvis_chat_history');
        chatHistory.innerHTML = '';
        addMessage("Conversation history cleared. How can I assist you today?", 'system', false);
    }
});

// Initialization removed from here as it's now at the top
