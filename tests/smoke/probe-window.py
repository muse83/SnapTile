"""A plain GTK4 window with a title bar: the stand-in application for drag tests.

PROBE_MIN=WIDTHxHEIGHT gives it a minimum size, to stand in for a window that cannot get small.
PROBE_POPOVER=1 opens a popup menu a second after the window appears, to stand in for a menu.
PROBE_TITLE=name sets the window title (default probe-window), to tell two windows apart.
PROBE_PLAIN=1 makes it a frameless, plain red rectangle (no title bar, no client shadow), so
the pixels at its corners tell whether the shell cut them.
"""
import os
import gi

gi.require_version('Gtk', '4.0')
from gi.repository import Gdk, GLib, Gtk

PLAIN_CSS = b"window, window.csd { background: transparent; border-radius: 0; box-shadow: none; margin: 0; padding: 0; border: none; } .fill { background: #cc0000; }"


def activate(app):
    window = Gtk.ApplicationWindow(application=app, title=os.environ.get('PROBE_TITLE', 'probe-window'))
    window.set_default_size(400, 300)
    if os.environ.get('PROBE_PLAIN'):
        fill = Gtk.Box(hexpand=True, vexpand=True)
        fill.add_css_class('fill')
        window.set_child(fill)
    elif os.environ.get('PROBE_POPOVER'):
        button = Gtk.MenuButton()
        popover = Gtk.Popover()
        popover.set_child(Gtk.Label(label='menu'))
        button.set_popover(popover)
        window.set_child(button)
        GLib.timeout_add(1000, lambda: (popover.popup(), False)[1])
    else:
        window.set_child(Gtk.Label(label='probe'))
    minimum = os.environ.get('PROBE_MIN')
    if minimum:
        width, height = minimum.split('x')
        window.set_size_request(int(width), int(height))
    if os.environ.get('PROBE_PLAIN'):
        window.set_decorated(False)
        provider = Gtk.CssProvider()
        provider.load_from_data(PLAIN_CSS)
        Gtk.StyleContext.add_provider_for_display(
            Gdk.Display.get_default(), provider, Gtk.STYLE_PROVIDER_PRIORITY_USER)
    window.present()


app = Gtk.Application(application_id='org.snaptile.Probe' + str(os.getpid()))
app.connect('activate', activate)
app.run()
