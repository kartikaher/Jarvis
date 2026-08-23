"""
JARVIS Desktop Voice Assistant — Main Entry Point.
Runs silently in the Windows background with System Tray integration.
Coordinates Wake Word detection, Voice State Machine, Speech-To-Text,
Safe Action Execution, AI Conversation (via Backend Proxy), and TTS.
"""
import sys
import time
import threading
import signal

from desktop.config import load_config, get_setting, update_setting
from desktop.autostart import is_autostart_enabled, set_autostart
from desktop.tts import tts
from desktop.audio_stt import stt
from desktop.wake_word import WakeWordDetector
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

    def on_wake_detected(self):
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
            print("[JARVIS] Wake word triggered! Waking up...")
            print("="*50)

            # Step 1: Wake up
            state_manager.set_state(STATE_LISTENING)

            # Step 2: Speak "Yes, sir." using the Old Voice
            speech_done_event = threading.Event()
            tts.speak("Yes, sir.", on_done=lambda: speech_done_event.set())
            speech_done_event.wait(timeout=2.0)

            # Step 3: Listen to command
            print("[JARVIS] Listening for command...")
            user_text = stt.listen_and_transcribe(max_duration=9.0, silence_timeout=1.4)
            print(f"[JARVIS] Transcribed: '{user_text}'")

            if not user_text:
                print("[JARVIS] No command heard. Returning to standby.")
                state_manager.set_state(STATE_STANDBY)
                if self.wake_detector and get_setting("wake_word_enabled", True):
                    self.wake_detector.resume()
                return

            # Step 4: Thinking / Processing
            state_manager.set_state(STATE_THINKING)
            result = state_manager.process_user_input(user_text)

            # Step 5: Execute & Speak Result
            reply_text = result.get("speech", "")
            if reply_text:
                state_manager.set_state(STATE_SPEAKING)
                print(f"[JARVIS] Speaking: '{reply_text}'")
                done_event = threading.Event()
                tts.speak(reply_text, on_done=lambda: done_event.set())
                done_event.wait(timeout=30.0)

            # If it's a confirmation prompt, immediately listen for the user's response (Yes/No)
            if result.get("type") == "confirmation_prompt":
                state_manager.set_state(STATE_LISTENING)
                print("[JARVIS] Waiting for confirmation (Yes/No)...")
                conf_text = stt.listen_and_transcribe(max_duration=6.0, silence_timeout=1.2)
                if conf_text:
                    state_manager.set_state(STATE_THINKING)
                    conf_res = state_manager.process_user_input(conf_text)
                    conf_reply = conf_res.get("speech", "")
                    if conf_reply:
                        state_manager.set_state(STATE_SPEAKING)
                        done_event = threading.Event()
                        tts.speak(conf_reply, on_done=lambda: done_event.set())
                        done_event.wait(timeout=15.0)

            # Step 6: Return to STANDBY
            print("[JARVIS] Interaction complete. Returning to STANDBY.")
            state_manager.set_state(STATE_STANDBY)
            if self.wake_detector and get_setting("wake_word_enabled", True):
                self.wake_detector.resume()

    def start(self):
        print("[JARVIS] Initializing Desktop Agent...")
        # Calibrate ambient noise
        stt.calibrate_noise(0.8)

        # Initialize wake word detector
        self.wake_detector = WakeWordDetector(on_wake_callback=self.on_wake_detected)
        if get_setting("wake_word_enabled", True) and get_setting("enabled", True):
            self.wake_detector.start()

        state_manager.set_state(STATE_STANDBY)
        print("[JARVIS] Desktop Assistant is running in STANDBY mode.")

        # Run system tray (blocks main thread until exit)
        self.tray.run()

    def shutdown(self):
        print("[JARVIS] Shutting down...")
        self.is_running = False
        if self.wake_detector:
            self.wake_detector.stop()
        tts.stop()
        print("[JARVIS] Stopped cleanly.")

def main():
    app = JarvisDesktopApp()
    app.start()

if __name__ == "__main__":
    main()
