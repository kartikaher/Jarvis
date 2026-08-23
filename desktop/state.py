"""
State Machine, Conversation Context, and Intent Router for JARVIS Desktop Assistant.
Manages states (STANDBY, LISTENING, THINKING, EXECUTING, SPEAKING, OFFLINE, DISABLED),
context memory for follow-ups, and the sensitive action confirmation system.
"""
import re
import time
from desktop.actions import action_executor
from desktop.backend_client import backend_client

# Voice States
STATE_STANDBY = "STANDBY"
STATE_LISTENING = "LISTENING"
STATE_THINKING = "THINKING"
STATE_EXECUTING = "EXECUTING"
STATE_SPEAKING = "SPEAKING"
STATE_OFFLINE = "OFFLINE"
STATE_DISABLED = "DISABLED"

class AssistantStateManager:
    def __init__(self):
        self.current_state = STATE_STANDBY
        self.conversation_context = []
        self.last_interaction_time = time.time()
        self.pending_confirmation = None  # Holds sensitive action details when awaiting confirmation
        self.on_state_change_callback = None

    def set_state(self, new_state: str):
        if self.current_state != new_state:
            print(f"[State] {self.current_state} -> {new_state}")
            self.current_state = new_state
            if self.on_state_change_callback:
                try:
                    self.on_state_change_callback(new_state)
                except Exception as e:
                    print(f"[State] Callback error: {e}")

    def reset_context(self):
        """Clears conversation context."""
        self.conversation_context = []
        self.pending_confirmation = None
        print("[State] Conversation context reset.")

    def add_context_turn(self, role: str, content: str):
        """Adds a turn to the multi-turn context (keeps last 10 turns)."""
        self.conversation_context.append({"role": role, "content": content})
        if len(self.conversation_context) > 10:
            self.conversation_context = self.conversation_context[-10:]
        self.last_interaction_time = time.time()

    def process_user_input(self, user_text: str) -> dict:
        """
        Processes transcribed user query:
        1. Checks for pending confirmation (Yes/No).
        2. Checks for direct fast safe actions (zero latency local execution).
        3. Falls back to AI conversational reasoning with multi-turn context.
        """
        text_clean = user_text.strip().lower()
        if not text_clean:
            return {"type": "empty", "speech": ""}

        # 1. Handle Pending Confirmation
        if self.pending_confirmation:
            return self._handle_confirmation_response(text_clean)

        # 2. Check for Context Reset / Sleep / Cancel
        if any(w in text_clean for w in ["cancel", "stop", "never mind", "nevermind", "dismiss"]):
            self.pending_confirmation = None
            return {"type": "action", "speech": "Cancelled, sir.", "action_result": action_executor.cancel_action()}

        if any(w in text_clean for w in ["go to sleep", "standby mode", "go to standby", "sleep mode"]):
            self.pending_confirmation = None
            return {"type": "sleep", "speech": "Entering standby mode, sir."}

        if any(w in text_clean for w in ["new chat", "start over", "clear context", "forget this conversation"]):
            self.reset_context()
            return {"type": "action", "speech": "Starting a fresh conversation, sir."}

        # 3. Fast Natural Action Matching (Strict Allowlist)
        direct_action = self._match_direct_action(text_clean, user_text)
        if direct_action:
            # If action is sensitive (e.g. WhatsApp message), enter confirmation mode
            if direct_action.get("is_sensitive"):
                self.pending_confirmation = direct_action
                return {"type": "confirmation_prompt", "speech": direct_action.get("confirmation_prompt")}
            
            # Save interaction into context
            self.add_context_turn("user", user_text)
            self.add_context_turn("assistant", direct_action.get("message", "Done."))
            return {"type": "action", "speech": direct_action.get("message", "Done."), "action_result": direct_action}

        # 4. AI Question / Multi-Turn Conversation
        self.add_context_turn("user", user_text)
        ai_reply = backend_client.send_chat(self.conversation_context)
        self.add_context_turn("assistant", ai_reply)
        return {"type": "chat", "speech": ai_reply}

    def _handle_confirmation_response(self, text_clean: str) -> dict:
        """Evaluates user response when awaiting sensitive action confirmation."""
        pending = self.pending_confirmation
        
        # Affirmative responses
        if any(w in text_clean for w in ["yes", "yeah", "yep", "sure", "send it", "proceed", "do it", "confirm", "ok", "okay"]):
            self.pending_confirmation = None
            action_type = pending.get("action")
            
            if action_type == "send_whatsapp":
                res = action_executor.execute_confirmed_whatsapp(pending["recipient"], pending["content"])
                return {"type": "action", "speech": res["message"], "action_result": res}
            elif action_type == "shutdown":
                res = action_executor.execute_confirmed_shutdown()
                return {"type": "action", "speech": res["message"], "action_result": res}
            elif action_type == "restart":
                res = action_executor.execute_confirmed_restart()
                return {"type": "action", "speech": res["message"], "action_result": res}
            else:
                return {"type": "action", "speech": "Action executed, sir."}

        # Negative / Cancellation responses
        elif any(w in text_clean for w in ["no", "nope", "cancel", "don't", "dont", "nevermind", "stop", "abort"]):
            self.pending_confirmation = None
            return {"type": "action", "speech": "Understood, action cancelled."}
        else:
            # Ambiguous response — re-prompt confirmation
            return {
                "type": "confirmation_prompt",
                "speech": f"Please confirm with yes or no: {pending.get('confirmation_prompt')}"
            }

    def _match_direct_action(self, text_clean: str, raw_text: str):
        """Matches direct user natural voice intents against strict allowlists."""
        # --- Lock Computer ---
        if re.search(r'\b(lock|lock computer|lock pc|lock workstation|lock the screen)\b', text_clean):
            return action_executor.lock_workstation()

        # --- Battery Status ---
        if any(phrase in text_clean for phrase in ["battery status", "battery percentage", "check battery", "how much battery", "battery level", "power status"]):
            return action_executor.get_battery_status()

        # --- Current Time / Date ---
        if any(phrase in text_clean for phrase in ["what time is it", "current time", "what is the time", "tell me the time", "today's date", "what is today's date"]):
            return action_executor.get_current_time()

        # --- System Status ---
        if any(phrase in text_clean for phrase in ["system status", "system health", "diagnostics", "check system"]):
            return action_executor.get_system_status()

        # --- Google / YouTube Search ---
        yt_search_match = re.search(r'(?:search youtube for|youtube search|search on youtube for)\s+(.+)', text_clean)
        if yt_search_match:
            query = yt_search_match.group(1).strip()
            return action_executor.search_youtube(query)

        g_search_match = re.search(r'(?:search google for|google search|search on google for|google for)\s+(.+)', text_clean)
        if g_search_match:
            query = g_search_match.group(1).strip()
            return action_executor.search_google(query)

        # --- Send WhatsApp Message (Sensitive Action) ---
        wa_match = re.search(r'(?:send whatsapp to|whatsapp message to|send message to|send)\s+([a-zA-Z0-9\s]+?)(?:\s*:\s*|\s+(?:saying|that)\s+)(.+)', text_clean)
        if wa_match:
            recipient = wa_match.group(1).strip()
            msg_content = wa_match.group(2).strip()
            # Ensure not a false positive for "send email"
            if recipient and msg_content and not recipient.startswith("email"):
                return action_executor.prepare_whatsapp_message(recipient, msg_content)

        # --- Quick Conversational Direct Responses (Instant Local Execution) ---
        if any(phrase in text_clean for phrase in ["who are you", "what is your name", "who created you", "who made you", "introduce yourself"]):
            return {"success": True, "message": "I am JARVIS, your personal Windows AI assistant. I am fully at your service, sir."}

        if any(phrase in text_clean for phrase in ["how are you", "how are you doing", "how are things", "how's it going"]):
            return {"success": True, "message": "I am operating at peak efficiency and ready for your commands, sir."}

        if any(phrase in text_clean for phrase in ["what can you do", "what are your features", "help me", "capabilities"]):
            return {"success": True, "message": "I can launch apps, search Google and YouTube, monitor your battery and system health, lock your computer, and answer your questions."}

        if any(phrase in text_clean for phrase in ["tell me a joke", "make me laugh", "say a joke"]):
            return {"success": True, "message": "Why do programmers prefer dark mode? Because light attracts bugs, sir."}

        if any(phrase in text_clean for phrase in ["thank you", "thanks jarvis", "thanks"]):
            return {"success": True, "message": "Always a pleasure to assist, sir."}

        if any(phrase in text_clean for phrase in ["good morning"]):
            return {"success": True, "message": "Good morning, sir. All systems are operational."}

        if any(phrase in text_clean for phrase in ["good evening", "good afternoon"]):
            return {"success": True, "message": "Good day, sir. How may I be of assistance?"}

        # --- Open URL / Websites (Allowlist) ---
        if "youtube" in text_clean and any(w in text_clean for w in ["open", "launch", "start", "go to"]):
            return action_executor.open_url("https://www.youtube.com")
        if "google" in text_clean and any(w in text_clean for w in ["open", "launch", "start", "go to"]) and "chrome" not in text_clean:
            return action_executor.open_url("https://www.google.com")
        if "gmail" in text_clean and any(w in text_clean for w in ["open", "launch", "start", "go to", "check"]):
            return action_executor.open_url("https://mail.google.com")
        if "spotify" in text_clean and any(w in text_clean for w in ["open", "launch", "start", "play"]):
            # Try app first or web
            res = action_executor.open_app("spotify")
            if not res.get("success"):
                return action_executor.open_url("https://open.spotify.com")
            return res
        if "whatsapp" in text_clean and any(w in text_clean for w in ["open", "launch", "start"]):
            return action_executor.open_url("https://web.whatsapp.com")

        # --- Open Applications (Allowlist) ---
        for app_name in ["chrome", "calculator", "notepad", "explorer", "vscode", "task manager", "settings"]:
            if app_name in text_clean and any(w in text_clean for w in ["open", "launch", "start", "run"]):
                return action_executor.open_app(app_name)

        # --- Open Folders (Allowlist) ---
        for folder_name in ["downloads", "documents", "desktop", "pictures", "videos", "project"]:
            if folder_name in text_clean and any(w in text_clean for w in ["open", "show", "view", "folder"]):
                return action_executor.open_folder(folder_name)

        return None


# Global state manager instance
state_manager = AssistantStateManager()
