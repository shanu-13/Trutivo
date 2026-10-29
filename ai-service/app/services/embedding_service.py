"""Sentence embeddings for semantic matching (Step 6C).

The model is loaded once per process and shared: requests never load it. Loading
happens in the background at startup (see ``app.main``) or, failing that, on
first use. If loading fails, callers get :class:`EmbeddingModelUnavailable`
and loading is retried at most once per ``retry_after_seconds``.

Embeddings are L2-normalised, so cosine similarity is a dot product. Identical
texts are embedded once: a bounded in-process cache maps
``sha256(model name + text)`` to its vector. Keys are hashes, so the cache
holds no readable text, and nothing here logs texts or vectors.
"""

import hashlib
import logging
import math
import os
import re
import threading
import time
from collections import OrderedDict
from collections.abc import Callable, Sequence
from typing import Any, Protocol

import numpy as np

from app.config import get_settings

logger = logging.getLogger(__name__)

DEFAULT_CACHE_SIZE = 2048
DEFAULT_RETRY_AFTER_SECONDS = 60.0
_BATCH_SIZE = 32


class EmbeddingModelUnavailable(Exception):
    """The embedding model could not be loaded or used."""


class EncoderModel(Protocol):
    def encode(self, sentences: list[str], **kwargs: Any) -> Any: ...


def load_sentence_transformer(model_name: str) -> EncoderModel:
    # Keep model loading out of the logs (progress bars, download chatter).
    os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
    os.environ.setdefault("TRANSFORMERS_VERBOSITY", "error")
    # Imported here so the rest of the service starts without paying torch's import cost.
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(model_name, device="cpu")


def public_model_name(model_name: str) -> str:
    """The model name safe to show users: a hub id such as "org/model", never a filesystem path."""
    return model_name if re.fullmatch(r"[\w.-]+(?:/[\w.-]+)?", model_name) and not model_name.startswith(".") else "custom-model"


def calculate_cosine_similarity(vector_a: Sequence[float] | np.ndarray, vector_b: Sequence[float] | np.ndarray) -> float | None:
    """Cosine similarity in [-1, 1]; None for zero, mismatched or non-finite vectors."""
    a = np.asarray(vector_a, dtype=np.float64)
    b = np.asarray(vector_b, dtype=np.float64)
    if a.ndim != 1 or a.shape != b.shape or a.size == 0:
        return None
    if not (np.all(np.isfinite(a)) and np.all(np.isfinite(b))):
        return None
    norm = float(np.linalg.norm(a) * np.linalg.norm(b))
    if norm == 0 or not math.isfinite(norm):
        return None
    return float(np.clip(np.dot(a, b) / norm, -1.0, 1.0))


def normalize(vector: np.ndarray) -> np.ndarray | None:
    """Unit-length copy of ``vector``; None if it has no direction or is not finite."""
    vector = np.asarray(vector, dtype=np.float32)
    if not np.all(np.isfinite(vector)):
        return None
    norm = float(np.linalg.norm(vector))
    return vector / norm if norm > 0 else None


class EmbeddingService:
    def __init__(
        self,
        model_name: str,
        loader: Callable[[str], EncoderModel] = load_sentence_transformer,
        cache_size: int = DEFAULT_CACHE_SIZE,
        retry_after_seconds: float = DEFAULT_RETRY_AFTER_SECONDS,
    ):
        self.model_name = model_name
        self._loader = loader
        self._model: EncoderModel | None = None
        self._load_lock = threading.Lock()
        self._last_failure: float | None = None
        self._retry_after = retry_after_seconds
        self._cache: OrderedDict[str, np.ndarray] = OrderedDict()
        self._cache_lock = threading.Lock()
        self._cache_size = cache_size

    @property
    def is_loaded(self) -> bool:
        return self._model is not None

    def load(self) -> EncoderModel:
        """Load the model once; concurrent callers wait for the same load."""
        if self._model is not None:
            return self._model
        with self._load_lock:
            if self._model is not None:
                return self._model
            if self._last_failure is not None and time.monotonic() - self._last_failure < self._retry_after:
                raise EmbeddingModelUnavailable("Embedding model is unavailable")
            try:
                self._model = self._loader(self.model_name)
                self._last_failure = None
            except Exception as exc:
                self._last_failure = time.monotonic()
                # Only the exception type: messages can contain local cache paths.
                logger.error("Embedding model failed to load: %s", type(exc).__name__)
                raise EmbeddingModelUnavailable("Embedding model is unavailable") from None
            return self._model

    def _key(self, text: str) -> str:
        return hashlib.sha256(f"{self.model_name}\0{text}".encode("utf-8")).hexdigest()

    def _cached(self, key: str) -> np.ndarray | None:
        with self._cache_lock:
            vector = self._cache.get(key)
            if vector is not None:
                self._cache.move_to_end(key)
            return vector

    def _store(self, key: str, vector: np.ndarray) -> None:
        with self._cache_lock:
            self._cache[key] = vector
            self._cache.move_to_end(key)
            while len(self._cache) > self._cache_size:
                self._cache.popitem(last=False)

    def generate_embeddings(self, texts: Sequence[str]) -> list[np.ndarray | None]:
        """Unit-length embeddings in input order; None for a text whose embedding is unusable.

        Texts not in the cache are encoded together in batches, each distinct text once.
        """
        keys = [self._key(text) for text in texts]
        results: dict[str, np.ndarray | None] = {}
        missing: dict[str, str] = {}
        for key, text in zip(keys, texts):
            if key in results or key in missing:
                continue
            cached = self._cached(key)
            if cached is not None:
                results[key] = cached
            else:
                missing[key] = text

        if missing:
            model = self.load()
            try:
                vectors = model.encode(
                    list(missing.values()),
                    batch_size=_BATCH_SIZE,
                    normalize_embeddings=True,
                    convert_to_numpy=True,
                    show_progress_bar=False,
                )
            except Exception as exc:
                logger.error("Embedding generation failed: %s", type(exc).__name__)
                raise EmbeddingModelUnavailable("Embedding generation failed") from None
            vectors = np.asarray(vectors)
            if vectors.ndim != 2 or vectors.shape[0] != len(missing):
                raise EmbeddingModelUnavailable("Embedding model returned an invalid result")
            for key, vector in zip(missing, vectors):
                unit = normalize(vector)
                results[key] = unit
                if unit is not None:
                    self._store(key, unit)

        return [results[key] for key in keys]

    def generate_embedding(self, text: str) -> np.ndarray | None:
        return self.generate_embeddings([text])[0]


_service: EmbeddingService | None = None
_service_lock = threading.Lock()


def get_embedding_service() -> EmbeddingService:
    """The process-wide embedding service (the model inside it loads lazily, once)."""
    global _service
    if _service is None:
        with _service_lock:
            if _service is None:
                _service = EmbeddingService(get_settings().embedding_model_name)
    return _service


def preload_embedding_model() -> None:
    """Load the shared model, swallowing failures (requests will report them)."""
    try:
        get_embedding_service().load()
    except EmbeddingModelUnavailable:
        pass
