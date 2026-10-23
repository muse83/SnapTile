# Runtime/dev image for one GNOME release.
#   GNOME 51: BASE_IMAGE=cachyos/cachyos (rolling, ARCHIVE_DATE empty)
#   GNOME 50: BASE_IMAGE=archlinux, pinned to an Arch Linux Archive snapshot from
#             before 51 landed (the CachyOS repo cannot be pinned to a date).
ARG BASE_IMAGE
FROM ${BASE_IMAGE}

ARG ARCHIVE_DATE=
RUN if [ -n "$ARCHIVE_DATE" ]; then \
        printf 'Server = https://archive.archlinux.org/repos/%s/$repo/os/$arch\n' \
            "$ARCHIVE_DATE" > /etc/pacman.d/mirrorlist; \
    fi \
    && pacman-key --init && pacman-key --populate \
    && pacman -Syyuu --noconfirm --needed --disable-download-timeout \
        gnome-shell mutter gjs dbus xorg-xwayland mesa \
        nodejs npm git make zip unzip gettext glib2 procps-ng \
        xterm \
    && pacman -Scc --noconfirm \
    && glib-compile-schemas /usr/share/glib-2.0/schemas

# GNOME Shell needs org.freedesktop.login1; there is no systemd in the container,
# so the entrypoint runs a mock of it (as the mutter/gnome-shell test suites do).
RUN pacman -S --noconfirm --needed --disable-download-timeout python-dbusmock \
    && pacman -Scc --noconfirm
COPY mock-logind.conf /etc/dbus-1/system.d/mock-logind.conf

RUN useradd -m dev
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
WORKDIR /workspace

# Starts the system D-Bus and the logind mock, then drops to the dev user.
# Use `docker compose exec -u dev` to get a shell as that user.
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
