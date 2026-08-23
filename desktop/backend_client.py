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
        self.custom_base_url = base_url
        self.token = DESKTOP_AGENT_TOKEN
        self.device_name = f"{socket.gethostname()} (Windows)"
        self.device_id = f"win_{socket.gethostname().lower()}"
        self.is_polling = False
        self._poll_thread = None

    def get_target_urls(self) -> list:
        """Returns list of all target backend URLs to poll and heartbeat."""
        urls = set()
        if self.custom_base_url:
            urls.add(self.custom_base_url.rstrip("/"))
        env_url = os.environ.get("JARVIS_BACKEND_URL") or os.environ.get("RENDER_EXTERNAL_URL") or os.environ.get("RENDER_URL")
        if env_url:
            urls.add(env_url.strip().rstrip("/"))
        cfg_url = get_setting("backend_url", "http://localhost:10000")
        if cfg_url:
            urls.add(cfg_url.strip().rstrip("/"))
        remote_url = get_setting("remote_backend_url", "")
        if remote_url:
            urls.add(remote_url.strip().rstrip("/"))
        # Always ensure localhost is included for local browser
        urls.add("http://localhost:10000")
        return list(urls)

    def _get_headers(self) -> dict:
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.token}"
        }

    def check_health(self) -> bool:
        """Verifies primary backend is reachable and healthy."""
        for base in self.get_target_urls():
            try:
                r = requests.get(f"{base}/health", timeout=3)
                if r.status_code == 200 and r.json().get("status") == "ok":
                    return True
            except Exception:
                pass
        return False

    def send_chat(self, conversation_turns: list, max_tokens: int = 400) -> str:
        """
        Sends conversation history to /api/chat.
        The backend automatically injects long-term memory and calls Groq (gpt-oss-120b).
        """
        messages = [{"role": "system", "content": DEFAULT_SYSTEM_PROMPT}]
        for turn in conversation_turns:
            messages.append({"role": turn["role"], "content": turn["content"]})

        payload = {
            "messages": messages,
            "max_tokens": max_tokens
        }

        for base in self.get_target_urls():
            url = f"{base}/api/chat"
            try:
                resp = requests.post(url, json=payload, timeout=25)
                if resp.status_code == 200:
                    data = resp.json()
                    if "choices" in data and len(data["choices"]) > 0:
                        reply = data["choices"][0]["message"]["content"]
                        import re
                        reply = re.sub(r'<think>[\s\S]*?</think>', '', reply).strip()
                        reply = re.sub(r'<thought>[\s\S]*?</thought>', '', reply).strip()
                        return reply
            except Exception:
                continue

        return "I apologize, sir. I could not connect to the JARVIS backend server."

    def poll_and_execute(self):
        """Polls all configured backend targets for queued desktop commands and executes them."""
        for base in self.get_target_urls():
            url = f"{base}/api/desktop/agent/poll"
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
                        
                        # Report back result to the originating backend
                        self.report_result(
                            base_url=base,
                            request_id=req_id,
                            success=exec_result.get("success", False),
                            message=exec_result.get("message", ""),
                            result=exec_result
                        )
                elif resp.status_code == 401:
                    print(f"[JARVIS] Desktop agent auth error on {base}: Check DESKTOP_AGENT_TOKEN")
            except Exception:
                pass

    def report_result(self, base_url: str, request_id: str, success: bool, message: str, result: dict = None):
        """Reports the execution outcome of a command back to the specific JARVIS backend."""
        url = f"{base_url}/api/desktop/agent/report"
        payload = {
            "requestId": request_id,
            "success": success,
            "message": message,
            "result": result
        }
        try:
            requests.post(url, json=payload, headers=self._get_headers(), timeout=5)
        except Exception as e:
            print(f"[JARVIS] Failed to report execution result to {base_url}: {e}")


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
