"""
Windows Startup Registry Manager for JARVIS.
Manages the HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run entry
to enable or disable starting JARVIS automatically on Windows startup.
"""
import os
import sys
import winreg

RUN_KEY_PATH = r"Software\Microsoft\Windows\CurrentVersion\Run"
APP_NAME = "JarvisDesktopAssistant"

def get_launch_command() -> str:
    """
    Returns the command to run JARVIS quietly in the background without popping up a console window.
    """
    current_dir = os.path.dirname(os.path.abspath(__file__))
    vbs_path = os.path.join(current_dir, "start_jarvis.vbs")
    
    # If the VBS launcher exists, use wscript to run it silently
    if os.path.exists(vbs_path):
        return f'wscript.exe "{vbs_path}"'
    
    # Fallback to pythonw.exe running main.py
    python_dir = os.path.dirname(sys.executable)
    pythonw = os.path.join(python_dir, "pythonw.exe")
    main_py = os.path.join(current_dir, "main.py")
    
    if os.path.exists(pythonw):
        return f'"{pythonw}" "{main_py}"'
    else:
        return f'"{sys.executable}" "{main_py}"'

def is_autostart_enabled() -> bool:
    """Checks if JARVIS is registered in Windows Startup."""
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY_PATH, 0, winreg.KEY_READ) as key:
            value, _ = winreg.QueryValueEx(key, APP_NAME)
            return bool(value)
    except FileNotFoundError:
        return False
    except Exception as e:
        print(f"[Autostart] Error reading registry: {e}")
        return False

def set_autostart(enable: bool) -> bool:
    """Enables or disables starting JARVIS with Windows."""
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY_PATH, 0, winreg.KEY_SET_VALUE) as key:
            if enable:
                cmd = get_launch_command()
                winreg.SetValueEx(key, APP_NAME, 0, winreg.REG_SZ, cmd)
                print(f"[Autostart] Enabled autostart: {cmd}")
            else:
                try:
                    winreg.DeleteValue(key, APP_NAME)
                    print("[Autostart] Disabled autostart.")
                except FileNotFoundError:
                    pass
        return True
    except Exception as e:
        print(f"[Autostart] Error updating registry: {e}")
        return False
