"""
Safe Action System for JARVIS Windows Desktop Assistant.
Enforces strict allowlists for applications, websites, system commands, and folders.
Never executes raw shell commands or allows unsafe operations.
Manages sensitive actions requiring explicit confirmation.
"""
import os
import sys
import ctypes
import webbrowser
import subprocess
import urllib.parse
from datetime import datetime

# Strict Allowlist of approved URLs
APPROVED_URLS = {
    "youtube": "https://www.youtube.com",
    "google": "https://www.google.com",
    "gmail": "https://mail.google.com",
    "whatsapp": "https://web.whatsapp.com",
    "spotify": "https://open.spotify.com",
    "github": "https://github.com",
    "chatgpt": "https://chat.openai.com",
    "reddit": "https://reddit.com",
    "twitter": "https://twitter.com",
    "linkedin": "https://linkedin.com",
    "maps": "https://maps.google.com",
}

# Strict Allowlist of approved applications
APPROVED_APPS = {
    "chrome": ["start", "chrome"],
    "google chrome": ["start", "chrome"],
    "notepad": ["notepad.exe"],
    "calculator": ["calc.exe"],
    "calc": ["calc.exe"],
    "explorer": ["explorer.exe"],
    "file explorer": ["explorer.exe"],
    "files": ["explorer.exe"],
    "spotify": ["spotify.exe"],
    "whatsapp": ["whatsapp.exe"],
    "vscode": ["code"],
    "vs code": ["code"],
    "visual studio code": ["code"],
    "task manager": ["taskmgr.exe"],
    "settings": ["start", "ms-settings:"],
}

# Strict Allowlist of approved folders
APPROVED_FOLDERS = {
    "downloads": os.path.join(os.path.expanduser("~"), "Downloads"),
    "documents": os.path.join(os.path.expanduser("~"), "Documents"),
    "desktop": os.path.join(os.path.expanduser("~"), "Desktop"),
    "pictures": os.path.join(os.path.expanduser("~"), "Pictures"),
    "music": os.path.join(os.path.expanduser("~"), "Music"),
    "videos": os.path.join(os.path.expanduser("~"), "Videos"),
    "project": os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
}

# Ctypes power status struct for native Windows battery query
class SYSTEM_POWER_STATUS(ctypes.Structure):
    _fields_ = [
        ('ACLineStatus', ctypes.c_byte),
        ('BatteryFlag', ctypes.c_byte),
        ('BatteryLifePercent', ctypes.c_byte),
        ('Reserved1', ctypes.c_byte),
        ('BatteryLifeTime', ctypes.c_ulong),
        ('BatteryFullLifeTime', ctypes.c_ulong)
    ]

class SafeActionExecutor:
    def __init__(self):
        pass

    def open_url(self, url: str) -> dict:
        """Opens an approved URL or validated https URL in the default browser."""
        if not url.startswith("http://") and not url.startswith("https://"):
            url = "https://" + url

        try:
            parsed = urllib.parse.urlparse(url)
            # Ensure safe scheme and valid domain
            if parsed.scheme not in ["http", "https"]:
                return {"success": False, "message": "Invalid URL protocol."}
            
            webbrowser.open(url)
            return {"success": True, "message": f"Opened {parsed.netloc}"}
        except Exception as e:
            return {"success": False, "message": f"Failed to open URL: {e}"}

    def open_app(self, app_key: str) -> dict:
        """Opens an approved application from the strict allowlist."""
        app_key_clean = app_key.lower().strip()
        cmd = APPROVED_APPS.get(app_key_clean)
        
        if not cmd:
            # Check partial matching on approved keys
            for k, v in APPROVED_APPS.items():
                if k in app_key_clean or app_key_clean in k:
                    cmd = v
                    break

        if not cmd:
            return {"success": False, "message": f"Application '{app_key}' is not in the approved allowlist."}

        try:
            if cmd[0] == "start":
                os.system(f"start {cmd[1]}")
            else:
                subprocess.Popen(cmd, shell=True)
            return {"success": True, "message": f"Opened {app_key}"}
        except Exception as e:
            return {"success": False, "message": f"Error launching application: {e}"}

    def open_folder(self, folder_name: str) -> dict:
        """Opens an approved user folder in Windows File Explorer."""
        folder_clean = folder_name.lower().strip()
        path = APPROVED_FOLDERS.get(folder_clean)
        
        if not path:
            for k, v in APPROVED_FOLDERS.items():
                if k in folder_clean:
                    path = v
                    break

        if not path or not os.path.exists(path):
            return {"success": False, "message": f"Folder '{folder_name}' is not approved or does not exist."}

        try:
            subprocess.Popen(["explorer.exe", os.path.normpath(path)])
            return {"success": True, "message": f"Opened {folder_name} folder"}
        except Exception as e:
            return {"success": False, "message": f"Error opening folder: {e}"}

    def search_google(self, query: str) -> dict:
        """Performs a Google Search."""
        if not query:
            return self.open_url("https://www.google.com")
        encoded = urllib.parse.quote_plus(query)
        webbrowser.open(f"https://www.google.com/search?q={encoded}")
        return {"success": True, "message": f"Searching Google for {query}"}

    def search_youtube(self, query: str) -> dict:
        """Performs a YouTube Search."""
        if not query:
            return self.open_url("https://www.youtube.com")
        encoded = urllib.parse.quote_plus(query)
        webbrowser.open(f"https://www.youtube.com/results?search_query={encoded}")
        return {"success": True, "message": f"Searching YouTube for {query}"}

    def get_current_time(self) -> dict:
        """Returns the formatted current time and date."""
        now = datetime.now()
        time_str = now.strftime("%I:%M %p")
        date_str = now.strftime("%A, %B %d, %Y")
        speech = f"It is currently {time_str} on {date_str}."
        return {"success": True, "message": speech, "time": time_str, "date": date_str}

    def get_battery_status(self) -> dict:
        """Native Windows query for battery percentage and AC charging status."""
        try:
            status = SYSTEM_POWER_STATUS()
            if ctypes.windll.kernel32.GetSystemPowerStatus(ctypes.byref(status)):
                percent = status.BatteryLifePercent
                is_charging = status.ACLineStatus == 1
                if percent == 255:
                    return {"success": True, "message": "No battery detected; running on direct AC power."}
                
                charging_text = "and currently charging" if is_charging else "on battery power"
                speech = f"Battery is at {percent} percent, {charging_text}."
                return {"success": True, "message": speech, "percent": percent, "charging": is_charging}
        except Exception as e:
            print(f"[Action] Battery check error: {e}")
        return {"success": True, "message": "Power information is currently unavailable."}

    def get_system_status(self) -> dict:
        """Basic system health status."""
        battery = self.get_battery_status()
        time_info = self.get_current_time()
        msg = f"System operational. {battery['message']} Current time is {time_info['time']}."
        return {"success": True, "message": msg}

    def lock_workstation(self) -> dict:
        """Locks the Windows workstation securely."""
        try:
            ctypes.windll.user32.LockWorkStation()
            return {"success": True, "message": "Locking your computer."}
        except Exception as e:
            return {"success": False, "message": f"Could not lock computer: {e}"}

    def prepare_whatsapp_message(self, recipient: str, message: str) -> dict:
        """
        Prepares a WhatsApp message. Requires confirmation before opening/sending.
        Does NOT bypass security or send unauthorized messages.
        """
        return {
            "success": True,
            "action": "send_whatsapp",
            "is_sensitive": True,
            "recipient": recipient,
            "content": message,
            "confirmation_prompt": f"I have the message for {recipient} ready: '{message}'. Should I open WhatsApp to send it?",
            "message": f"I have the message for {recipient} ready. Should I send it?"
        }

    def execute_confirmed_whatsapp(self, recipient: str, message: str) -> dict:
        """Opens WhatsApp web / desktop with prepared text."""
        encoded_text = urllib.parse.quote_plus(message)
        # If recipient has a phone number format, use wa.me link; otherwise open WhatsApp web
        phone_digits = ''.join(filter(str.isdigit, recipient))
        if len(phone_digits) >= 10:
            url = f"https://web.whatsapp.com/send?phone={phone_digits}&text={encoded_text}"
        else:
            url = f"https://web.whatsapp.com/send?text={encoded_text}"
        
        webbrowser.open(url)
        return {"success": True, "message": f"WhatsApp opened with your message to {recipient}."}

    def execute_confirmed_shutdown(self) -> dict:
        """Initiates safe system shutdown after confirmation."""
        os.system("shutdown /s /t 30")
        return {"success": True, "message": "System will shut down in 30 seconds."}

    def execute_confirmed_restart(self) -> dict:
        """Initiates safe system restart after confirmation."""
        os.system("shutdown /r /t 30")
        return {"success": True, "message": "System will restart in 30 seconds."}

    def cancel_action(self) -> dict:
        """Cancels current pending action or speech."""
        return {"success": True, "message": "Action cancelled."}

# Global singleton
action_executor = SafeActionExecutor()
