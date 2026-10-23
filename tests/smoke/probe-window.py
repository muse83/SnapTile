"""A plain GTK4 window with a title bar: the stand-in application for drag tests.

PROBE_MIN=WIDTHxHEIGHT gives it a minimum size, to stand in for a window that cannot get small.
"""
import os
import gi

gi.require_version('Gtk', '4.0')
from gi.repository import Gtk


def activate(app):
    window = Gtk.ApplicationWindow(application=app, title='probe-window')
    window.set_default_size(400, 300)
    window.set_child(Gtk.Label(label='probe'))
    minimum = os.environ.get('PROBE_MIN')
    if minimum:
        width, height = minimum.split('x')
        window.set_size_request(int(width), int(height))
    window.present()


app = Gtk.Application(application_id='org.snaptile.Probe')
app.connect('activate', activate)
app.run()
