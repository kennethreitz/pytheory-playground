.PHONY: run dev install test

# Run the playground (http://127.0.0.1:5042 by default; override with PORT=…)
run:
	uv run python main.py

# Same as run, but listen on all interfaces for sharing on your LAN
dev:
	HOST=0.0.0.0 uv run python main.py

# Sync dependencies from the lockfile
install:
	uv sync

# Chord voicing contract (no third-party test runner)
test:
	uv run python -m unittest discover -s tests -v
