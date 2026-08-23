"""
Text-To-Speech engine for JARVIS Desktop Voice Assistant.
Reuses the exact OLD JARVIS voice configuration:
- Male English Voice (Microsoft David Desktop / UK-US English Male)
- Exact rate, pitch, and tone settings.
- Thread-safe queue with cancellation support.
"""
import threading
import queue
import pyttsx3
import time

VOICE_PREFERENCE_ORDER = [
    "Google UK English Male",
    "Microsoft David Desktop",
    "David",
    "George",
    "Mark",
    "Hazel",
    "English"
]

class JarvisTTS:
    _instance = None
    _lock = threading.Lock()

    def __new__(cls, *args, **kwargs):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super(JarvisTTS, cls).__new__(cls)
                cls._instance._initialized = False
            return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        self.speech_queue = queue.Queue()
        self.is_speaking = False
        self.stop_requested = False
        self.voice_enabled = True
        
        # Start speech worker thread
        self.worker_thread = threading.Thread(target=self._speech_worker, daemon=True)
        self.worker_thread.start()

    def _init_engine(self):
        """Initializes and configures the SAPI5 engine with the Old JARVIS voice."""
        try:
            engine = pyttsx3.init()
            engine.setProperty('rate', 175)    # Natural measured speech rate
            engine.setProperty('volume', 1.0)  # Full volume
            
            # Select the Old JARVIS voice
            voices = engine.getProperty('voices')
            selected_voice = None
            
            if voices:
                for pref in VOICE_PREFERENCE_ORDER:
                    for v in voices:
                        if pref.lower() in v.name.lower() or pref.lower() in v.id.lower():
                            selected_voice = v
                            break
                    if selected_voice:
                        break
                
                # If not matched, pick first male / English voice (avoid female voice)
                if not selected_voice:
                    for v in voices:
                        if "david" in v.name.lower() or "male" in v.name.lower() or "english" in v.name.lower():
                            selected_voice = v
                            break
                
                if selected_voice:
                    engine.setProperty('voice', selected_voice.id)
                    print(f"[TTS] Configured JARVIS Voice: {selected_voice.name}")
                else:
                    engine.setProperty('voice', voices[0].id)
            
            return engine
        except Exception as e:
            print(f"[TTS] Engine init error: {e}")
            return None

    def _speech_worker(self):
        """Dedicated COM thread for SAPI5 TTS playback."""
        engine = self._init_engine()
        while True:
            try:
                item = self.speech_queue.get()
                if item is None:
                    break
                
                text, on_done_callback = item
                if not self.voice_enabled or not text or self.stop_requested:
                    self.speech_queue.task_done()
                    if on_done_callback:
                        try:
                            on_done_callback()
                        except Exception:
                            pass
                    continue

                self.is_speaking = True
                self.stop_requested = False
                
                # Re-initialize engine if needed
                if engine is None:
                    engine = self._init_engine()

                if engine:
                    try:
                        engine.say(text)
                        engine.runAndWait()
                    except Exception as e:
                        print(f"[TTS] Speech error: {e}")
                        # Attempt engine reset
                        try:
                            engine = self._init_engine()
                        except Exception:
                            pass
                
                self.is_speaking = False
                self.speech_queue.task_done()
                
                if on_done_callback:
                    try:
                        on_done_callback()
                    except Exception:
                        pass
            except Exception as e:
                print(f"[TTS] Worker error: {e}")
                self.is_speaking = False

    def speak(self, text: str, on_done=None, clear_previous=True):
        """Queue text to be spoken by JARVIS."""
        if not self.voice_enabled or not text:
            if on_done:
                on_done()
            return

        if clear_previous:
            self.stop()

        self.speech_queue.put((text, on_done))

    def stop(self):
        """Stops current speech and clears queue."""
        self.stop_requested = True
        while not self.speech_queue.empty():
            try:
                self.speech_queue.get_nowait()
                self.speech_queue.task_done()
            except Exception:
                break
        self.is_speaking = False

    def set_voice_enabled(self, enabled: bool):
        self.voice_enabled = enabled
        if not enabled:
            self.stop()

# Global singleton
tts = JarvisTTS()
