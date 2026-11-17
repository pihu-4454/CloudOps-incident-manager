FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install dependencies first so Docker can cache this layer
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the app. The folder layout must stay the same,
# because main.py looks for ../backend/schema.sql and ../frontend
COPY backend ./backend
COPY frontend ./frontend

# Run as a normal user instead of root
RUN useradd --create-home appuser
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/live', timeout=2)"
  
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]