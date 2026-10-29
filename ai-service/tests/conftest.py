import pytest

from app.config import DEFAULT_EMBEDDING_MODEL
from app.services.embedding_service import EmbeddingModelUnavailable, EmbeddingService


@pytest.fixture(scope="session")
def real_embedding_service() -> EmbeddingService:
    """The real all-MiniLM-L6-v2 model, loaded once for the whole test run."""
    service = EmbeddingService(DEFAULT_EMBEDDING_MODEL)
    try:
        service.load()
    except EmbeddingModelUnavailable:
        pytest.skip("Embedding model could not be loaded (not installed or not downloadable here)")
    return service
