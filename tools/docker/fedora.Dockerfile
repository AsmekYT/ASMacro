FROM fedora:42

RUN dnf -y install \
      gcc gcc-c++ make cmake pkgconf-pkg-config file which git \
      webkit2gtk4.1-devel gtk3-devel librsvg2-devel \
      libappindicator-gtk3-devel \
      openssl-devel libxkbcommon-devel dbus-devel \
      rpm-build patchelf desktop-file-utils \
      nodejs npm curl wget xz \
 && dnf clean all

ENV RUSTUP_HOME=/opt/rustup CARGO_HOME=/opt/cargo
ENV PATH=/opt/cargo/bin:$PATH
RUN curl -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal

ENV APPIMAGE_EXTRACT_AND_RUN=1

WORKDIR /src
