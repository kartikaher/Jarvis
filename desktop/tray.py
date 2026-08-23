"""
Windows System Tray Icon for JARVIS Desktop Assistant.
Provides menu options:
- JARVIS ON/OFF
- Wake Word ON/OFF
- Voice ON/OFF
- Status Indicator
- Open Web JARVIS
- Start with Windows ON/OFF
- Exit
"""
import webbrowser
import threading
from PIL import Image, ImageDraw
import pystray
from pystray import MenuItem as item, Menu

from desktop.config import get_setting, update_setting
from desktop.autostart import is_autostart_enabled, set_autostart

def create_jarvis_icon(color="#00e5ff", size=64):
    """Generates a dynamic high-contrast JARVIS Arc-Reactor icon."""
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    
    # Outer Ring
    draw.ellipse((4, 4, size - 4, size - 4), outline=color, width=4)
    # Inner Core
    draw.ellipse((16, 16, size - 16, size - 16), outline=color, width=3)
    # Center Dot
    draw.ellipse((26, 26, size - 26, size - 26), fill=color)
    
    return image

class JarvisTray:
    def __init__(self, main_app):
        self.app = main_app
        self.icon = None
        self.status_text = "Status: STANDBY"

    def update_status(self, new_status: str):
        self.status_text = f"Status: {new_status}"
        if self.icon:
            try:
                self.icon.update_menu()
            except Exception:
                pass

    def _toggle_jarvis(self, icon, item):
        is_enabled = not get_setting("enabled", True)
        update_setting("enabled", is_enabled)
        self.app.on_toggle_enabled(is_enabled)
        icon.update_menu()

    def _toggle_wake_word(self, icon, item):
        is_enabled = not get_setting("wake_word_enabled", True)
        update_setting("wake_word_enabled", is_enabled)
        self.app.on_toggle_wake_word(is_enabled)
        icon.update_menu()

    def _toggle_voice(self, icon, item):
        is_enabled = not get_setting("voice_enabled", True)
        update_setting("voice_enabled", is_enabled)
        self.app.on_toggle_voice(is_enabled)
        icon.update_menu()

    def _toggle_autostart(self, icon, item):
        currently_enabled = is_autostart_enabled()
        new_state = not currently_enabled
        set_autostart(new_state)
        update_setting("autostart_enabled", new_state)
        icon.update_menu()

    def _open_web_jarvis(self, icon, item):
        backend_url = get_setting("backend_url", "http://localhost:10000")
        webbrowser.open(backend_url)

    def _exit_app(self, icon, item):
        self.app.shutdown()
        icon.stop()

    def _build_menu(self):
        return Menu(
            item(lambda text: self.status_text, None, enabled=False),
            Menu.SEPARATOR,
            item(
                "JARVIS Enabled",
                self._toggle_jarvis,
                checked=lambda item: get_setting("enabled", True)
            ),
            item(
                "Wake Word ('Hey JARVIS')",
                self._toggle_wake_word,
                checked=lambda item: get_setting("wake_word_enabled", True)
            ),
            item(
                "Voice Speech",
                self._toggle_voice,
                checked=lambda item: get_setting("voice_enabled", True)
            ),
            item(
                "Start JARVIS with Windows",
                self._toggle_autostart,
                checked=lambda item: is_autostart_enabled()
            ),
            Menu.SEPARATOR,
            item("Open Web JARVIS", self._open_web_jarvis),
            Menu.SEPARATOR,
            item("Exit JARVIS", self._exit_app)
        )

    def run(self):
        try:
            image = create_jarvis_icon()
            self.icon = pystray.Icon("JARVIS", image, "JARVIS Desktop Voice Assistant", menu=self._build_menu())
            self.icon.run()
        except Exception as e:
            print(f"[JARVIS] Tray icon notice: {e}")

    def run_detached(self):

        """Runs tray icon in a separate thread."""
        t = threading.Thread(target=self.run, daemon=True)
        t.start()
        return t
