FROM debian:12

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential cmake pkg-config file which git ca-certificates \
      libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev \
      libayatana-appindicator3-dev \
      libssl-dev libxkbcommon-dev libdbus-1-dev \
      patchelf desktop-file-utils fakeroot \
      curl wget xz-utils \
 && rm -rf /var/lib/apt/lists/*

ARG NODE_VERSION=22.14.0
RUN curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
      | tar -xJ -C /opt \
 && ln -s "/opt/node-v${NODE_VERSION}-linux-x64" /opt/node
ENV PATH=/opt/node/bin:$PATH

ENV RUSTUP_HOME=/opt/rustup CARGO_HOME=/opt/cargo
ENV PATH=/opt/cargo/bin:$PATH
RUN curl -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal

ENV APPIMAGE_EXTRACT_AND_RUN=1

WORKDIR /src
