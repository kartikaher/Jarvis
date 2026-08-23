"""
Configuration management for JARVIS Windows Desktop Voice Assistant.
Persists settings such as wake word toggle, voice toggle, autostart toggle, and backend URL.
"""
import os
import json

CONFIG_DIR = os.path.join(os.path.expanduser("~"), ".jarvis")
CONFIG_FILE = os.path.join(CONFIG_DIR, "desktop_config.json")

DEFAULT_CONFIG = {
    "enabled": True,
    "wake_word_enabled": True,
    "voice_enabled": True,
    "autostart_enabled": True,
    "backend_url": "http://localhost:10000",
    "wake_phrase": "hey jarvis",
    "voice_name": "Microsoft David Desktop",
    "speech_rate": 175,
    "speech_volume": 1.0,
    "mic_energy_threshold": 300,
    "mic_silence_timeout_sec": 2.0,
    "max_listen_time_sec": 10.0,
}

def load_config() -> dict:
    try:
        if not os.path.exists(CONFIG_DIR):
            os.makedirs(CONFIG_DIR, exist_ok=True)
        if os.path.exists(CONFIG_FILE):
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                merged = {**DEFAULT_CONFIG, **data}
                return merged
        else:
            save_config(DEFAULT_CONFIG)
            return DEFAULT_CONFIG.copy()
    except Exception as e:
        print(f"[Config] Error loading config: {e}")
        return DEFAULT_CONFIG.copy()

def save_config(cfg: dict) -> bool:
    try:
        if not os.path.exists(CONFIG_DIR):
            os.makedirs(CONFIG_DIR, exist_ok=True)
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2)
        return True
    except Exception as e:
        print(f"[Config] Error saving config: {e}")
        return False

def get_setting(key: str, default=None):
    cfg = load_config()
    return cfg.get(key, default)

def update_setting(key: str, value) -> bool:
    cfg = load_config()
    cfg[key] = value
    return save_config(cfg)
