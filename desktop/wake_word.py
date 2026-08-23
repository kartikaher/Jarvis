"""
Wake Word Detection Engine for JARVIS.
Monitors microphone in STANDBY mode for the wake phrase "Hey JARVIS" or "JARVIS".
Features dynamic adaptive ambient noise baseline and low-latency sliding audio buffer.
"""
import time
import threading
import numpy as np
import sounddevice as sd
import speech_recognition as sr

SAMPLE_RATE = 16000
BLOCK_SIZE = 2048  # 128ms per block
WAKE_WORDS = [
    "hey jarvis", "jarvis", "hi jarvis", "ok jarvis", "okay jarvis",
    "hey jarves", "jarves", "hey service", "service", "harvest",
    "starbucks", "travis", "hey charvis", "charvis", "darvis", "garvis",
    "hey java", "java", "jar vis", "hey jar vis"
]

class WakeWordDetector:
    def __init__(self, on_wake_callback=None):
        self.on_wake = on_wake_callback
        self.recognizer = sr.Recognizer()
        self.ambient_rms = 100.0
        self.energy_threshold = 280.0
        self.is_running = False
        self.is_paused = False
        self._thread = None
        self._lock = threading.Lock()

    def calibrate(self, duration_sec: float = 0.8):
        """Measures ambient room noise to establish initial baseline."""
        try:
            samples = int(duration_sec * SAMPLE_RATE)
            rec = sd.rec(samples, samplerate=SAMPLE_RATE, channels=1, dtype='int16')
            sd.wait()
            self.ambient_rms = max(50.0, float(np.sqrt(np.mean(rec.astype(np.float64)**2))))
            self.energy_threshold = max(240.0, self.ambient_rms * 1.6 + 80.0)
            print(f"[WakeWord] Ambient RMS: {self.ambient_rms:.1f} | Trigger Threshold: {self.energy_threshold:.1f}")
        except Exception as e:
            print(f"[WakeWord] Calibration error: {e}")
            self.energy_threshold = 280.0

    def start(self):
        with self._lock:
            if self.is_running:
                return
            self.is_running = True
            self.is_paused = False
            self.calibrate(0.6)
            self._thread = threading.Thread(target=self._listen_loop, daemon=True)
            self._thread.start()
            print("[WakeWord] Wake word listener started.")

    def stop(self):
        with self._lock:
            self.is_running = False
            self.is_paused = True

    def pause(self):
        """Temporarily pause wake word detection."""
        self.is_paused = True

    def resume(self):
        """Resume wake word detection when returning to STANDBY."""
        self.is_paused = False

    def _listen_loop(self):
        ring_buffer = []
        max_buffer_blocks = int(2.0 * SAMPLE_RATE / BLOCK_SIZE) # ~2.0s buffer

        while self.is_running:
            if self.is_paused:
                time.sleep(0.1)
                continue

            try:
                with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype='int16', blocksize=BLOCK_SIZE) as stream:
                    print("[JARVIS] AUDIO STREAM ACTIVE")
                    print("[JARVIS] WAKE WORD LISTENING")
                    while self.is_running and not self.is_paused:
                        data, overflowed = stream.read(BLOCK_SIZE)
                        if overflowed:
                            continue

                        ring_buffer.append(data.copy())
                        if len(ring_buffer) > max_buffer_blocks:
                            ring_buffer.pop(0)

                        # Compute RMS
                        rms = float(np.sqrt(np.mean(data.astype(np.float64)**2)))

                        # Dynamically adapt baseline when quiet
                        if rms < self.energy_threshold:
                            self.ambient_rms = 0.95 * self.ambient_rms + 0.05 * rms
                            self.energy_threshold = max(220.0, self.ambient_rms * 1.6 + 70.0)
                        else:
                            # Speech energy detected! Capture additional 1.1 seconds
                            extra_blocks = []
                            extra_target = int(1.1 * SAMPLE_RATE / BLOCK_SIZE)
                            for _ in range(extra_target):
                                if not self.is_running or self.is_paused:
                                    break
                                d, _ = stream.read(BLOCK_SIZE)
                                extra_blocks.append(d.copy())

                            combined = np.concatenate(ring_buffer + extra_blocks, axis=0)
                            ring_buffer.clear()

                            audio_data = sr.AudioData(combined.tobytes(), SAMPLE_RATE, 2)
                            try:
                                text = self.recognizer.recognize_google(audio_data, language="en-US").lower().strip()
                                if any(w in text for w in WAKE_WORDS):
                                    print(f"[JARVIS] WAKE WORD DETECTED: '{text}'")
                                    self.pause()
                                    if self.on_wake:
                                        threading.Thread(target=self.on_wake, args=(text,), daemon=True).start()
                                    break
                            except (sr.UnknownValueError, sr.RequestError):
                                pass
                            except Exception as e:
                                print(f"[WakeWord] Recognition error: {e}")

                            time.sleep(0.2)


            except Exception as e:
                print(f"[WakeWord] Stream error: {e}")
                time.sleep(0.5)

def create_wake_detector(on_wake_callback):
    return WakeWordDetector(on_wake_callback=on_wake_callback)

