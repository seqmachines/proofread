FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000 \
    EXECUTOR=none \
    STREAM_MODE=stream

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt \
    && useradd --create-home --uid 10001 proofread

COPY *.py base_prompt.md ./backend/

USER proofread
EXPOSE 8000

CMD ["sh", "-c", "exec python -m uvicorn app:app --app-dir backend --host 0.0.0.0 --port \"$PORT\""]
