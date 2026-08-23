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

class AudioSTT:
    def __init__(self):
        self.recognizer = sr.Recognizer()
        self.recognizer.energy_threshold = 300
        self.recognizer.dynamic_energy_threshold = True
        self.sample_rate = SAMPLE_RATE
        self._is_listening = False

    def calibrate_noise(self, duration_sec: float = 1.0):
        """Measures ambient room noise to calibrate energy threshold."""
        try:
            samples = int(duration_sec * self.sample_rate)
            recording = sd.rec(samples, samplerate=self.sample_rate, channels=CHANNELS, dtype='int16')
            sd.wait()
            # Calculate RMS energy
            rms = np.sqrt(np.mean(recording.astype(np.float64)**2))
            # Set energy threshold slightly above ambient RMS
            self.recognizer.energy_threshold = max(200, int(rms * 1.5))
            print(f"[STT] Ambient noise calibrated. Energy threshold: {self.recognizer.energy_threshold}")
        except Exception as e:
            print(f"[STT] Noise calibration error: {e}")
            self.recognizer.energy_threshold = 300

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
