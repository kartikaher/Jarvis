"""
Backend Client for JARVIS Desktop Voice Assistant.
Communicates securely with the local backend proxy (http://localhost:10000).
Maintains strict security (GROQ_API_KEY remains strictly on the server).
Supports conversational queries, memory integration, and structured action detection.
"""
import json
import requests
from desktop.config import get_setting

DEFAULT_SYSTEM_PROMPT = (
    "You are JARVIS, a highly capable, concise, and loyal personal AI assistant for Windows. "
    "When answering voice queries, be concise, clear, and direct (1-3 sentences suitable for speech), "
    "unless the user asks for a detailed explanation. Maintain complete context of previous turns in this conversation. "
    "If the user asks a follow-up (e.g. 'Advantages?' or 'Explain the second one'), refer accurately to previous discussion."
)

class BackendClient:
    def __init__(self, base_url: str = None):
        self.base_url = base_url or get_setting("backend_url", "http://localhost:10000")

    def check_health(self) -> bool:
        """Verifies backend is reachable and healthy."""
        try:
            r = requests.get(f"{self.base_url}/health", timeout=3)
            return r.status_code == 200 and r.json().get("status") == "ok"
        except Exception:
            return False

    def send_chat(self, conversation_turns: list, max_tokens: int = 400) -> str:
        """
        Sends conversation history to /api/chat.
        The backend automatically injects long-term memory and calls Groq (gpt-oss-120b).
        """
        url = f"{self.base_url}/api/chat"
        messages = [{"role": "system", "content": DEFAULT_SYSTEM_PROMPT}]
        
        # Add conversation turns (user & assistant)
        for turn in conversation_turns:
            messages.append({"role": turn["role"], "content": turn["content"]})

        try:
            payload = {
                "messages": messages,
                "max_tokens": max_tokens
            }
            resp = requests.post(url, json=payload, timeout=25)
            if resp.status_code == 200:
                data = resp.json()
                if "choices" in data and len(data["choices"]) > 0:
                    reply = data["choices"][0]["message"]["content"]
                    # Strip think tags if model outputs them
                    import re
                    reply = re.sub(r'<think>[\s\S]*?</think>', '', reply).strip()
                    reply = re.sub(r'<thought>[\s\S]*?</thought>', '', reply).strip()
                    return reply
                else:
                    return "I didn't receive a valid response from the server."
            else:
                err_msg = resp.json().get("error", {}).get("message", "Server error")
                print(f"[BackendClient] Chat error {resp.status_code}: {err_msg}")
                return f"Server error: {err_msg}"
        except requests.exceptions.ConnectionError:
            return "Cannot connect to JARVIS backend. Please ensure the server is running."
        except Exception as e:
            print(f"[BackendClient] Request error: {e}")
            return f"An error occurred while processing your request: {e}"

# Global instance
backend_client = BackendClient()
