"""Stand-in applications for the placement research (a GTK4 client on the Wayland display).

CLIENT_MODE picks what it does; CLIENT_APP_ID and CLIENT_TITLE name it (default
org.snaptile.Research / main). CLIENT_MIN=WxH gives the main window a minimum size. Every mode opens a main window of 400x300 first, then after
CLIENT_DELAY seconds (default 3) does the rest:
  plain             nothing more
  two               opens a second and, 3 s later, a third window of the same application
  transient         a non-modal Gtk.Window transient for the main window
  modal             a modal Gtk.Window transient for the main window ("a dialog")
  alert             a Gtk.AlertDialog (message box) on the main window
  about             a Gtk.AboutDialog on the main window
  chooser           the built-in GTK file chooser dialog of this process, on the main window
  portal            Gtk.FileDialog through the desktop portal, parent = main window
  portal-orphan     Gtk.FileDialog through the desktop portal, no parent window
  orphan-modal      a modal window without a parent
  fixed             the main window cannot be resized
  fullscreen        the main window goes full screen after the delay
  maximized         the main window asks to be maximised before it is shown (its own restoring)
"""
import os
import gi

gi.require_version('Gtk', '4.0')
from gi.repository import GLib, Gtk

MODE = os.environ.get('CLIENT_MODE', 'plain')
TITLE = os.environ.get('CLIENT_TITLE', 'main')
DELAY = float(os.environ.get('CLIENT_DELAY', '3'))


def make_window(app, title, width=400, height=300):
    window = Gtk.ApplicationWindow(application=app, title=title)
    window.set_default_size(width, height)
    window.set_child(Gtk.Label(label=title))
    return window


def later(seconds, fn):
    GLib.timeout_add(int(seconds * 1000), lambda: fn() or False)


def activate(app):
    main = make_window(app, TITLE)
    if MODE == 'fixed':
        main.set_resizable(False)
    minimum = os.environ.get('CLIENT_MIN')
    if minimum:
        width, height = minimum.split('x')
        main.set_size_request(int(width), int(height))
    if MODE == 'maximized':
        main.maximize()
    main.present()

    def rest():
        if MODE == 'two':
            make_window(app, 'second').present()
            later(3, lambda: make_window(app, 'third').present())
        elif MODE == 'transient':
            dialog = Gtk.Window(title='transient-window', transient_for=main)
            dialog.set_default_size(300, 150)
            dialog.set_child(Gtk.Label(label='transient'))
            dialog.present()
        elif MODE == 'modal':
            dialog = Gtk.Window(title='modal-dialog', transient_for=main, modal=True)
            dialog.set_default_size(300, 150)
            dialog.set_child(Gtk.Label(label='dialog'))
            dialog.present()
        elif MODE == 'alert':
            Gtk.AlertDialog(message='alert-dialog', detail='detail').choose(main, None, lambda *a: None)
        elif MODE == 'about':
            about = Gtk.AboutDialog(transient_for=main, modal=True, program_name='about-dialog')
            about.present()
        elif MODE == 'chooser':
            chooser = Gtk.FileChooserDialog(title='chooser-dialog', transient_for=main, modal=True,
                                            action=Gtk.FileChooserAction.OPEN)
            chooser.add_button('Cancel', Gtk.ResponseType.CANCEL)
            chooser.present()
        elif MODE == 'portal':
            dialog = Gtk.FileDialog(title='portal-dialog')
            dialog.open(main, None, lambda *a: None)
        elif MODE == 'portal-orphan':
            dialog = Gtk.FileDialog(title='portal-dialog')
            dialog.open(None, None, lambda *a: None)
        elif MODE == 'orphan-modal':
            dialog = Gtk.Window(title='orphan-modal', modal=True)
            dialog.set_default_size(300, 150)
            dialog.present()
        elif MODE == 'fullscreen':
            main.fullscreen()

    later(DELAY, rest)


app = Gtk.Application(application_id=os.environ.get('CLIENT_APP_ID', 'org.snaptile.Research'))
app.connect('activate', activate)
app.run()
