"""A plain GTK4 window with a title bar: the stand-in application for drag tests.

PROBE_MIN=WIDTHxHEIGHT gives it a minimum size, to stand in for a window that cannot get small.
PROBE_POPOVER=1 opens a popup menu a second after the window appears, to stand in for a menu.
PROBE_TITLE=name sets the window title (default probe-window), to tell two windows apart.
PROBE_APP_ID=id sets the application id (default: a new one per start), so a second start is "the same application".
PROBE_DIALOG=1 opens a modal dialog window (title probe-dialog, 300x150) 1.5 seconds after the window appears.
PROBE_SECOND=1 opens a second window of the application (title as the first plus -2) at the same time.
PROBE_FULLSCREEN=1 goes full screen 1.5 seconds after the window appears.
PROBE_MAXIMIZE=1 asks to be maximised before the window is shown, like an application restoring itself.
PROBE_PLAIN_WINDOW=1 makes it a plain Gtk.Window of the application instead of an application window (no GTK
window path), like the file chooser Nautilus opens without a parent.
PROBE_PLAIN=1 makes it a frameless, plain red rectangle (no title bar, no client shadow), so
the pixels at its corners tell whether the shell cut them.
"""
import os
import gi

gi.require_version('Gtk', '4.0')
from gi.repository import Gdk, GLib, Gtk

PLAIN_CSS = b"window, window.csd { background: transparent; border-radius: 0; box-shadow: none; margin: 0; padding: 0; border: none; } .fill { background: #cc0000; }"


def activate(app):
    title = os.environ.get('PROBE_TITLE', 'probe-window')
    if os.environ.get('PROBE_PLAIN_WINDOW'):
        window = Gtk.Window(application=app, title=title)
    else:
        window = Gtk.ApplicationWindow(application=app, title=title)
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
    if os.environ.get('PROBE_MAXIMIZE'):
        window.maximize()
    window.present()
    if os.environ.get('PROBE_DIALOG'):
        def open_dialog():
            dialog = Gtk.Window(title='probe-dialog', transient_for=window, modal=True)
            dialog.set_default_size(300, 150)
            dialog.set_child(Gtk.Label(label='dialog'))
            dialog.present()
            return GLib.SOURCE_REMOVE
        GLib.timeout_add(1500, open_dialog)
    if os.environ.get('PROBE_FULLSCREEN'):
        def go_fullscreen():
            window.fullscreen()
            return GLib.SOURCE_REMOVE
        GLib.timeout_add(1500, go_fullscreen)
    if os.environ.get('PROBE_SECOND'):
        second = Gtk.ApplicationWindow(application=app, title=title + '-2')
        second.set_default_size(400, 300)
        second.set_child(Gtk.Label(label='second'))
        second.present()


app = Gtk.Application(application_id=os.environ.get('PROBE_APP_ID') or 'org.snaptile.Probe' + str(os.getpid()))
app.connect('activate', activate)
app.run()
