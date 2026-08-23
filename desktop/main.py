"""
JARVIS Desktop Voice Assistant — Main Entry Point.
Runs silently in the Windows background with System Tray integration.
Coordinates Wake Word detection, Voice State Machine, Speech-To-Text,
Safe Action Execution, AI Conversation (via Backend Proxy), and TTS.
"""
import os
import sys
import time
import threading
import subprocess
import signal
import traceback

# Ensure project root is in sys.path
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

LOG_FILE = os.path.join(PROJECT_ROOT, "desktop", "jarvis_desktop.log")

def log_msg(msg):
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}\n")
    except Exception:
        pass

def handle_exception(exc_type, exc_value, exc_traceback):
    if issubclass(exc_type, KeyboardInterrupt):
        return
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"\n[UNHANDLED EXCEPTION {time.strftime('%Y-%m-%d %H:%M:%S')}]:\n")
            traceback.print_exception(exc_type, exc_value, exc_traceback, file=f)
    except Exception:
        pass

sys.excepthook = handle_exception

# Ensure sys.stdout / sys.stderr are valid when running under pythonw.exe
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w", encoding="utf-8", errors="replace")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w", encoding="utf-8", errors="replace")



from desktop.config import load_config, get_setting, update_setting
from desktop.autostart import is_autostart_enabled, set_autostart
from desktop.tts import tts
from desktop.audio_stt import stt
from desktop.wake_word import WakeWordDetector
from desktop.backend_client import backend_client
from desktop.state import (
    state_manager,
    STATE_STANDBY,
    STATE_LISTENING,
    STATE_THINKING,
    STATE_EXECUTING,
    STATE_SPEAKING,
    STATE_OFFLINE,
    STATE_DISABLED
)
from desktop.tray import JarvisTray

class JarvisDesktopApp:
    def __init__(self):
        self.config = load_config()
        self.is_running = True
        self.backend_process = None
        self.tray = JarvisTray(self)
        self.wake_detector = None
        self._interaction_lock = threading.Lock()

        # Connect state manager callback to tray status
        state_manager.on_state_change_callback = self._on_state_change

        # Sync autostart setting with Windows Registry if enabled in config
        if get_setting("autostart_enabled", True) and not is_autostart_enabled():
            set_autostart(True)


    def _on_state_change(self, new_state: str):
        print(f"[JARVIS] State is now: {new_state}")
        self.tray.update_status(new_state)

    def on_toggle_enabled(self, enabled: bool):
        print(f"[JARVIS] Enabled toggled: {enabled}")
        if not enabled:
            state_manager.set_state(STATE_DISABLED)
            if self.wake_detector:
                self.wake_detector.pause()
            tts.stop()
        else:
            state_manager.set_state(STATE_STANDBY)
            if self.wake_detector and get_setting("wake_word_enabled", True):
                self.wake_detector.resume()

    def on_toggle_wake_word(self, enabled: bool):
        print(f"[JARVIS] Wake word toggled: {enabled}")
        if self.wake_detector:
            if enabled and get_setting("enabled", True):
                self.wake_detector.resume()
            else:
                self.wake_detector.pause()

    def on_toggle_voice(self, enabled: bool):
        print(f"[JARVIS] Voice toggled: {enabled}")
        tts.set_voice_enabled(enabled)

    def _extract_command_from_wake(self, raw_text: str) -> str:
        import re
        from desktop.wake_word import WAKE_WORDS
        cleaned = raw_text.lower().strip()
        for w in sorted(WAKE_WORDS, key=len, reverse=True):
            if cleaned.startswith(w):
                cleaned = cleaned[len(w):].strip()
                break
            elif w in cleaned:
                parts = cleaned.split(w, 1)
                cleaned = parts[1].strip()
        return cleaned

    def on_wake_detected(self, initial_text: str = ""):

        """
        Triggered when "Hey JARVIS" is spoken by the user.
        Workflow:
        1. Wake up -> Transition to LISTENING.
        2. Speak "Yes, sir." using the OLD JARVIS voice.
        3. Listen to user command.
        4. Process command / safe action / AI answer.
        5. Speak result.
        6. Return to STANDBY.
        """
        with self._interaction_lock:
            if not get_setting("enabled", True):
                return

            print("\n" + "="*50)
            print(f"[JARVIS] WAKE WORD DETECTED: '{initial_text}'" if initial_text else "[JARVIS] WAKE WORD DETECTED")
            print("="*50)

            command_text = self._extract_command_from_wake(initial_text) if initial_text else ""

            if command_text:
                # Switch to LISTENING then execute inline command
                state_manager.set_state(STATE_LISTENING)
                print(f"[JARVIS] COMMAND RECEIVED: '{command_text}'")
                state_manager.set_state(STATE_THINKING)
                result = state_manager.process_user_input(command_text)

                reply_text = result.get("speech", "")
                if reply_text:
                    state_manager.set_state(STATE_SPEAKING)
                    print(f"[JARVIS] SPEAKING: '{reply_text}'")
                    done_event = threading.Event()
                    tts.speak(reply_text, on_done=lambda: done_event.set())
                    done_event.wait(timeout=30.0)

                if result.get("type") == "confirmation_prompt":
                    state_manager.set_state(STATE_LISTENING)
                    print("[JARVIS] COMMAND LISTENING (Awaiting Confirmation Yes/No)...")
                    conf_text = stt.listen_and_transcribe(max_duration=6.0, silence_timeout=1.2)
                    if conf_text:
                        print(f"[JARVIS] SPEECH RECOGNIZED: '{conf_text}'")
                        print(f"[JARVIS] COMMAND RECEIVED: '{conf_text}'")
                        state_manager.set_state(STATE_THINKING)
                        conf_res = state_manager.process_user_input(conf_text)
                        conf_reply = conf_res.get("speech", "")
                        if conf_reply:
                            state_manager.set_state(STATE_SPEAKING)
                            print(f"[JARVIS] SPEAKING: '{conf_reply}'")
                            done_event = threading.Event()
                            tts.speak(conf_reply, on_done=lambda: done_event.set())
                            done_event.wait(timeout=15.0)
            else:
                # Step 1: Switch to LISTENING
                state_manager.set_state(STATE_LISTENING)

                # Step 2: Speak "Yes, sir." using the existing Old Voice
                print("[JARVIS] SPEAKING: 'Yes, sir.'")
                speech_done_event = threading.Event()
                tts.speak("Yes, sir.", on_done=lambda: speech_done_event.set())
                speech_done_event.wait(timeout=2.0)

                time.sleep(0.15)

                # Step 3: Listen for command
                print("[JARVIS] COMMAND LISTENING")
                user_text = stt.listen_and_transcribe(max_duration=8.0, silence_timeout=1.3)

                if not user_text:
                    print("[JARVIS] No command heard. Returning to standby.")
                else:
                    # Step 4: Speech Recognized & Command Received
                    print(f"[JARVIS] SPEECH RECOGNIZED: '{user_text}'")
                    print(f"[JARVIS] COMMAND RECEIVED: '{user_text}'")
                    state_manager.set_state(STATE_THINKING)
                    result = state_manager.process_user_input(user_text)

                    # Step 5: Speak Result
                    reply_text = result.get("speech", "")
                    if reply_text:
                        state_manager.set_state(STATE_SPEAKING)
                        print(f"[JARVIS] SPEAKING: '{reply_text}'")
                        done_event = threading.Event()
                        tts.speak(reply_text, on_done=lambda: done_event.set())
                        done_event.wait(timeout=30.0)

                    if result.get("type") == "confirmation_prompt":
                        state_manager.set_state(STATE_LISTENING)
                        print("[JARVIS] COMMAND LISTENING (Awaiting Confirmation Yes/No)...")
                        conf_text = stt.listen_and_transcribe(max_duration=6.0, silence_timeout=1.2)
                        if conf_text:
                            print(f"[JARVIS] SPEECH RECOGNIZED: '{conf_text}'")
                            print(f"[JARVIS] COMMAND RECEIVED: '{conf_text}'")
                            state_manager.set_state(STATE_THINKING)
                            conf_res = state_manager.process_user_input(conf_text)
                            conf_reply = conf_res.get("speech", "")
                            if conf_reply:
                                state_manager.set_state(STATE_SPEAKING)
                                print(f"[JARVIS] SPEAKING: '{conf_reply}'")
                                done_event = threading.Event()
                                tts.speak(conf_reply, on_done=lambda: done_event.set())
                                done_event.wait(timeout=15.0)

            # Step 6: Return to STANDBY
            print("[JARVIS] RETURNED TO STANDBY")
            state_manager.set_state(STATE_STANDBY)
            if self.wake_detector and get_setting("wake_word_enabled", True):
                self.wake_detector.resume()

    def _ensure_backend_running(self):
        """Starts the local backend proxy on port 10000 in the background if not already running."""
        import requests
        is_local_healthy = False
        try:
            r = requests.get("http://localhost:10000/health", timeout=1.5)
            if r.status_code == 200 and r.json().get("status") == "ok":
                is_local_healthy = True
        except Exception:
            is_local_healthy = False

        if not is_local_healthy:
            backend_dir = os.path.join(PROJECT_ROOT, "backend")
            try:
                node_cmd = r"C:\Program Files\nodejs\node.exe"
                if not os.path.exists(node_cmd):
                    node_cmd = "node"
                server_js = os.path.join(backend_dir, "server.js")

                self.backend_process = subprocess.Popen(
                    f'"{node_cmd}" "{server_js}"',
                    shell=True,
                    cwd=backend_dir,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    creationflags=0x08000000
                )

                for _ in range(12):
                    time.sleep(0.5)
                    try:
                        r = requests.get("http://localhost:10000/health", timeout=1.5)
                        if r.status_code == 200 and r.json().get("status") == "ok":
                            print("[JARVIS] Local backend server successfully started and healthy.")
                            return
                    except Exception:
                        pass
                print("[JARVIS] Local backend launch initiated, proceeding.")
            except Exception as e:
                print(f"[JARVIS] Could not auto-start local backend server: {e}")
        else:
            print("[JARVIS] Local backend server is already active and healthy.")

    def start(self):
        print("[JARVIS] Initializing Desktop Agent...")
        # Automatically ensure backend is active
        self._ensure_backend_running()

        # Connect desktop agent bridge to backend for Web UI command execution
        backend_client.start_agent_bridge()

        # Calibrate ambient noise
        stt.calibrate_noise(0.8)

        # Initialize wake word detector
        self.wake_detector = WakeWordDetector(on_wake_callback=self.on_wake_detected)
        if get_setting("wake_word_enabled", True) and get_setting("enabled", True):
            self.wake_detector.start()

        state_manager.set_state(STATE_STANDBY)
        print("[JARVIS] Desktop Assistant is running in STANDBY mode.")

        # Run system tray in background thread
        try:
            self.tray.run_detached()
        except Exception as e:
            print(f"[JARVIS] Tray notice: {e}")

        # Keep main thread alive in STANDBY loop forever
        try:
            while self.is_running:
                time.sleep(1)
        except (KeyboardInterrupt, SystemExit):
            pass
        finally:
            self.shutdown()



    def shutdown(self):
        print("[JARVIS] Shutting down...")
        self.is_running = False
        backend_client.stop_agent_bridge()
        if self.wake_detector:
            self.wake_detector.stop()
        tts.stop()
        if self.backend_process:
            try:
                self.backend_process.terminate()
            except Exception:
                pass
        print("[JARVIS] Stopped cleanly.")


def main():
    if "--test-mic" in sys.argv or "-t" in sys.argv:
        stt.test_microphone(duration_sec=5.0)
        return

    app = JarvisDesktopApp()
    app.start()

if __name__ == "__main__":
    main()

