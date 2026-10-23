"""A plain GTK4 window with a title bar: the stand-in application for drag tests."""
import gi

gi.require_version('Gtk', '4.0')
from gi.repository import Gtk


def activate(app):
    window = Gtk.ApplicationWindow(application=app, title='probe-window')
    window.set_default_size(400, 300)
    window.set_child(Gtk.Label(label='probe'))
    window.present()


app = Gtk.Application(application_id='org.snaptile.Probe')
app.connect('activate', activate)
app.run()
