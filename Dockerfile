FROM ghcr.io/astral-sh/uv:python3.14-bookworm-slim

# lilypond — PDF engraving; ffmpeg — audio-format conversion for Score.from_wav
# (afconvert is macOS-only). fonts-dejavu keeps lilypond's text rendering happy.
RUN apt-get update \
    && apt-get install -y --no-install-recommends lilypond ffmpeg fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependency layer (cached until the lockfile changes)
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

COPY app.py main.py ./
COPY static ./static

ENV HOST=0.0.0.0 \
    PORT=5042 \
    PATH="/app/.venv/bin:$PATH"

EXPOSE 5042

CMD ["python", "main.py"]
