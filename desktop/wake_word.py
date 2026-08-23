"""
Wake Word Detection Engine for JARVIS.
Monitors microphone in STANDBY mode for the wake phrase "Hey JARVIS" or "JARVIS".
Efficient sliding audio buffer with energy thresholding to keep CPU usage low.
"""
import time
import threading
import numpy as np
import sounddevice as sd
import speech_recognition as sr

SAMPLE_RATE = 16000
BLOCK_SIZE = 2048  # 128ms per block
WAKE_WORDS = ["hey jarvis", "jarvis", "hi jarvis", "ok jarvis", "okay jarvis"]

class WakeWordDetector:
    def __init__(self, on_wake_callback=None):
        self.on_wake = on_wake_callback
        self.recognizer = sr.Recognizer()
        self.recognizer.energy_threshold = 280
        self.is_running = False
        self.is_paused = False
        self._thread = None
        self._lock = threading.Lock()

    def start(self):
        with self._lock:
            if self.is_running:
                return
            self.is_running = True
            self.is_paused = False
            self._thread = threading.Thread(target=self._listen_loop, daemon=True)
            self._thread.start()
            print("[WakeWord] Wake word listener started.")

    def stop(self):
        with self._lock:
            self.is_running = False
            self.is_paused = True

    def pause(self):
        """Temporarily pause wake word detection (e.g. while JARVIS is speaking/executing)."""
        self.is_paused = True

    def resume(self):
        """Resume wake word detection when returning to STANDBY."""
        self.is_paused = False

    def _listen_loop(self):
        ring_buffer = []
        max_buffer_blocks = int(2.5 * SAMPLE_RATE / BLOCK_SIZE) # ~2.5 seconds window

        while self.is_running:
            if self.is_paused:
                time.sleep(0.1)
                continue

            try:
                with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype='int16', blocksize=BLOCK_SIZE) as stream:
                    while self.is_running and not self.is_paused:
                        data, overflowed = stream.read(BLOCK_SIZE)
                        if overflowed:
                            continue

                        ring_buffer.append(data.copy())
                        if len(ring_buffer) > max_buffer_blocks:
                            ring_buffer.pop(0)

                        # Check RMS energy
                        rms = np.sqrt(np.mean(data.astype(np.float64)**2))
                        if rms > self.recognizer.energy_threshold:
                            # Energy spike detected — gather the audio buffer and transcribe
                            # Collect an extra 1.0s to capture full wake phrase
                            extra_blocks = []
                            extra_target = int(1.2 * SAMPLE_RATE / BLOCK_SIZE)
                            for _ in range(extra_target):
                                if not self.is_running or self.is_paused:
                                    break
                                d, _ = stream.read(BLOCK_SIZE)
                                extra_blocks.append(d.copy())

                            combined = np.concatenate(ring_buffer + extra_blocks, axis=0)
                            ring_buffer.clear()

                            audio_data = sr.AudioData(combined.tobytes(), SAMPLE_RATE, 2)
                            try:
                                text = self.recognizer.recognize_google(audio_data, language="en-US").lower()
                                print(f"[WakeWord] Heard: '{text}'")
                                if any(w in text for w in WAKE_WORDS):
                                    print(f"[WakeWord] Wake word detected in: '{text}'!")
                                    self.pause()
                                    if self.on_wake:
                                        # Trigger wake callback in a separate thread so listener is not blocked
                                        threading.Thread(target=self.on_wake, daemon=True).start()
                                    break
                            except (sr.UnknownValueError, sr.RequestError):
                                pass
                            except Exception as e:
                                print(f"[WakeWord] Recognition exception: {e}")

            except Exception as e:
                print(f"[WakeWord] Stream error: {e}")
                time.sleep(0.5)

# Factory helper
def create_wake_detector(on_wake_callback):
    return WakeWordDetector(on_wake_callback=on_wake_callback)
