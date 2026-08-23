"""
Audio capture and Speech-To-Text (STT) engine for JARVIS.
Uses sounddevice for native, reliable audio recording on Windows
and SpeechRecognition for speech transcription.
"""
import io
import time
import math
import numpy as np
import sounddevice as sd
import speech_recognition as sr

SAMPLE_RATE = 16000
CHANNELS = 1
BLOCK_SIZE = 1024  # samples per block (64ms at 16kHz)

def get_microphone_info():
    """Queries and returns the default input microphone device info."""
    try:
        dev_idx = sd.default.device[0] if isinstance(sd.default.device, (list, tuple)) else sd.default.device
        dev_idx = int(dev_idx)
        info = sd.query_devices(dev_idx)
        return {
            "index": dev_idx,
            "name": info.get("name", "Default Microphone"),
            "channels": info.get("max_input_channels", 1),
            "samplerate": int(info.get("default_samplerate", SAMPLE_RATE))
        }
    except Exception as e:
        return {
            "index": 0,
            "name": "Default Windows Microphone",
            "channels": 1,
            "samplerate": SAMPLE_RATE
        }

class AudioSTT:
    def __init__(self):
        self.recognizer = sr.Recognizer()
        self.recognizer.energy_threshold = 280
        self.recognizer.dynamic_energy_threshold = True
        self.sample_rate = SAMPLE_RATE
        self._is_listening = False
        self.device_info = get_microphone_info()

    def test_microphone(self, duration_sec: float = 4.0):
        """Interactive microphone test mode to verify audio capture levels."""
        print("\n" + "="*50)
        print(" [JARVIS] MICROPHONE TEST MODE")
        print("="*50)
        print(f"[JARVIS] MICROPHONE INITIALIZED")
        print(f"[JARVIS] MICROPHONE DEVICE: {self.device_info['name']}")
        print(f"[JARVIS] Testing input for {duration_sec} seconds. Please speak into your microphone...")
        print("="*50)

        samples_per_block = 2048
        blocks = int(duration_sec * self.sample_rate / samples_per_block)
        audio_blocks = []
        max_rms = 0.0

        try:
            with sd.InputStream(samplerate=self.sample_rate, channels=CHANNELS, dtype='int16', blocksize=samples_per_block) as stream:
                print(f"[JARVIS] AUDIO STREAM ACTIVE")
                for _ in range(blocks):
                    data, _ = stream.read(samples_per_block)
                    audio_blocks.append(data.copy())
                    rms = float(np.sqrt(np.mean(data.astype(np.float64)**2)))
                    max_rms = max(max_rms, rms)
                    meter_len = min(25, int(rms / 40.0))
                    bar = "=" * meter_len + "-" * (25 - meter_len)
                    print(f"\rAudio Level: [{bar}] RMS: {rms:6.1f}", end="", flush=True)


            print("\n")
            if max_rms > 120.0:
                print(f"[JARVIS] SUCCESS: Microphone is actively receiving audio (Peak RMS: {max_rms:.1f})")
            else:
                print(f"[JARVIS] WARNING: Audio level very low (Peak RMS: {max_rms:.1f}). Check mic volume / unmute.")

            # Test speech recognition on captured audio
            if audio_blocks:
                full_bytes = np.concatenate(audio_blocks, axis=0).tobytes()
                audio_data = sr.AudioData(full_bytes, self.sample_rate, 2)
                try:
                    text = self.recognizer.recognize_google(audio_data, language="en-US")
                    print(f"[JARVIS] SPEECH RECOGNIZED: '{text}'")
                except sr.UnknownValueError:
                    print("[JARVIS] No intelligible speech recognized in test sample.")
                except Exception as e:
                    print(f"[JARVIS] Speech recognition error: {e}")

        except Exception as e:
            print(f"\n[JARVIS] Microphone stream test failed: {e}")

    def calibrate_noise(self, duration_sec: float = 0.8):
        """Measures ambient room noise to calibrate energy threshold."""
        try:
            samples = int(duration_sec * self.sample_rate)
            recording = sd.rec(samples, samplerate=self.sample_rate, channels=CHANNELS, dtype='int16')
            sd.wait()
            rms = float(np.sqrt(np.mean(recording.astype(np.float64)**2)))
            self.recognizer.energy_threshold = max(200, int(rms * 1.5 + 50))
            print(f"[JARVIS] MICROPHONE INITIALIZED")
            print(f"[JARVIS] MICROPHONE DEVICE: {self.device_info['name']}")
        except Exception as e:
            print(f"[JARVIS] Noise calibration error: {e}")
            self.recognizer.energy_threshold = 280



    def record_phrase(self, max_duration: float = 10.0, silence_timeout: float = 1.5, min_speech_sec: float = 0.5) -> bytes:
        """
        Records audio until the user stops speaking (silence detected) or max_duration reached.
        Returns raw 16-bit PCM mono bytes at 16kHz.
        """
        self._is_listening = True
        collected_blocks = []
        speech_started = False
        silence_start_time = None
        start_time = time.time()
        
        threshold = max(200, self.recognizer.energy_threshold)

        def audio_callback(indata, frames, time_info, status):
            if status:
                pass

        try:
            with sd.InputStream(samplerate=self.sample_rate, channels=CHANNELS, dtype='int16', blocksize=BLOCK_SIZE) as stream:
                while self._is_listening and (time.time() - start_time < max_duration):
                    data, overflowed = stream.read(BLOCK_SIZE)
                    if overflowed:
                        continue
                    
                    collected_blocks.append(data.copy())
                    
                    # Compute block RMS
                    rms = np.sqrt(np.mean(data.astype(np.float64)**2))
                    
                    if rms > threshold:
                        speech_started = True
                        silence_start_time = None
                    else:
                        if speech_started:
                            if silence_start_time is None:
                                silence_start_time = time.time()
                            elif time.time() - silence_start_time > silence_timeout:
                                # Silence threshold exceeded after speech -> user finished speaking
                                break
                        else:
                            # Not started speaking yet, check timeout before user even speaks
                            if time.time() - start_time > 4.5:
                                # 4.5 seconds without any speech start
                                break

        except Exception as e:
            print(f"[STT] Audio stream error: {e}")
            self._is_listening = False
            return b""

        self._is_listening = False
        if not collected_blocks:
            return b""
            
        full_audio = np.concatenate(collected_blocks, axis=0)
        
        # Check minimum speech duration
        duration = len(full_audio) / self.sample_rate
        if duration < min_speech_sec and not speech_started:
            return b""
            
        return full_audio.tobytes()

    def listen_and_transcribe(self, max_duration: float = 8.0, silence_timeout: float = 1.3) -> str:
        """
        Listens from microphone and returns transcribed text.
        Returns empty string if no speech detected or transcription fails.
        """
        audio_bytes = self.record_phrase(max_duration=max_duration, silence_timeout=silence_timeout)
        if not audio_bytes or len(audio_bytes) < 3200: # less than 100ms
            return ""

        try:
            audio_data = sr.AudioData(audio_bytes, self.sample_rate, 2)
            # Recognize speech using Google STT (standard for assistant interactions)
            text = self.recognizer.recognize_google(audio_data, language="en-US")
            return text.strip()
        except sr.UnknownValueError:
            # Speech was unintelligible or background noise
            return ""
        except sr.RequestError as e:
            print(f"[STT] Recognition service error: {e}")
            return ""
        except Exception as e:
            print(f"[STT] Transcription error: {e}")
            return ""

    def stop_listening(self):
        self._is_listening = False

# Global instance
stt = AudioSTT()
