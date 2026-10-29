FROM python:3.11-slim

ENV PIP_NO_CACHE_DIR=1 \
    HF_HOME=/opt/huggingface \
    HF_HUB_DISABLE_PROGRESS_BARS=1 \
    TRANSFORMERS_VERBOSITY=error

WORKDIR /app

# requirements.txt points pip at the CPU-only PyTorch index, so no CUDA libraries are installed.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Download the embedding model at build time so the container starts without network access to Hugging Face.
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2', device='cpu')"
# The model is in the image, so the container never needs to contact Hugging Face at runtime.
ENV HF_HUB_OFFLINE=1

COPY . .

# Production by default: INTERNAL_API_KEY is then required and the API docs are off.
ENV ENVIRONMENT=production
# Run as an unprivileged user; the model cache only needs to be readable.
RUN useradd --system --uid 10001 --no-create-home app
USER app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD python -c "import urllib.request, sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status == 200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
