"""
Backend Client for JARVIS Desktop Voice Assistant.
Communicates securely with the local backend proxy (http://localhost:10000).
Maintains strict security (GROQ_API_KEY remains strictly on the server).
Supports conversational queries, memory integration, and structured action detection.
"""
import os
import time
import json
import socket
import threading
import requests
from desktop.config import get_setting
from desktop.actions import action_executor

DESKTOP_AGENT_TOKEN = os.environ.get("DESKTOP_AGENT_TOKEN", "jarvis_desktop_secure_token_default").strip()

DEFAULT_SYSTEM_PROMPT = (
    "You are JARVIS, a highly capable, concise, and loyal personal AI assistant for Windows created by Kartik Aher. "
    "When answering voice queries, be calm, intelligent, fast, respectful, natural, professional, slightly futuristic, and concise (1-3 sentences suitable for speech), "
    "unless the user asks for a detailed explanation. Maintain complete context of previous turns in this conversation. "
    "If the user asks for a desktop action (e.g. open/close apps, URLs, folders, show desktop, lock PC, battery status), "
    "respond naturally with confirmation."
)

class BackendClient:
    def __init__(self, base_url: str = None):
        self.base_url = base_url or get_setting("backend_url", "http://localhost:10000")
        self.token = DESKTOP_AGENT_TOKEN
        self.device_name = f"{socket.gethostname()} (Windows)"
        self.device_id = f"win_{socket.gethostname().lower()}"
        self.is_polling = False
        self._poll_thread = None

    def _get_headers(self) -> dict:
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.token}"
        }

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
                err_data = resp.json().get("error", {})
                err_msg = err_data.get("message", "Server error")
                print(f"[BackendClient] Chat error {resp.status_code}: {err_msg}")
                if "GROQ_API_KEY" in err_msg or "unconfigured" in err_msg or resp.status_code in [401, 500]:
                    return "I am online and listening, sir. To enable full AI reasoning, please enter your free Groq API key in backend/.env. All computer controls and voice commands are ready."
                return f"I apologize, sir. I encountered a server issue: {err_msg}"
        except requests.exceptions.ConnectionError:
            return "JARVIS backend server is starting up. Please try again in a moment, sir."
        except Exception as e:
            print(f"[BackendClient] Request error: {e}")
            return f"I encountered an error processing your query, sir."

    def poll_and_execute(self):
        """Polls the backend for queued desktop commands and executes them."""
        url = f"{self.base_url}/api/desktop/agent/poll"
        payload = {
            "deviceId": self.device_id,
            "deviceName": self.device_name
        }
        try:
            resp = requests.post(url, json=payload, headers=self._get_headers(), timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                commands = data.get("commands", [])
                for cmd in commands:
                    req_id = cmd.get("requestId")
                    action = cmd.get("action")
                    target = cmd.get("target", "")
                    params = cmd.get("params", {})
                    
                    # Execute on local Windows OS
                    exec_result = action_executor.execute_structured_action(action, target, params)
                    
                    # Report back result
                    self.report_result(
                        request_id=req_id,
                        success=exec_result.get("success", False),
                        message=exec_result.get("message", ""),
                        result=exec_result
                    )
            elif resp.status_code == 401:
                print("[JARVIS] Desktop agent auth error: Check DESKTOP_AGENT_TOKEN")
        except Exception as e:
            # Backend may be starting or offline
            pass

    def report_result(self, request_id: str, success: bool, message: str, result: dict = None):
        """Reports the execution outcome of a command back to the JARVIS backend."""
        url = f"{self.base_url}/api/desktop/agent/report"
        payload = {
            "requestId": request_id,
            "success": success,
            "message": message,
            "result": result
        }
        try:
            requests.post(url, json=payload, headers=self._get_headers(), timeout=5)
        except Exception as e:
            print(f"[JARVIS] Failed to report execution result: {e}")

    def start_agent_bridge(self):
        """Starts background thread to maintain heartbeat and receive commands from Web JARVIS."""
        if self.is_polling:
            return
        self.is_polling = True
        print(f"[JARVIS] Desktop agent connected: {self.device_name}")

        def _loop():
            while self.is_polling:
                self.poll_and_execute()
                time.sleep(1.5)

        self._poll_thread = threading.Thread(target=_loop, daemon=True)
        self._poll_thread.start()

    def stop_agent_bridge(self):
        self.is_polling = False
        print("[JARVIS] Desktop agent disconnected.")

# Global instance
backend_client = BackendClient()
