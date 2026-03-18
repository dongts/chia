FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Railway sets PORT env var; default to 8000
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
