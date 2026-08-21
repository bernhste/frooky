FROM mcr.microsoft.com/devcontainers/base:trixie

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        python3-venv \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:${PATH}"

RUN echo "source /opt/venv/bin/activate" >> /home/vscode/.bashrc
RUN echo "source /opt/venv/bin/activate" >> /home/vscode/.zshrc 
