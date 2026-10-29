import threading
import time

import numpy as np
import pytest

from app.services.embedding_service import (
    EmbeddingModelUnavailable,
    EmbeddingService,
    calculate_cosine_similarity,
    get_embedding_service,
    normalize,
    public_model_name,
)


class FakeModel:
    """Deterministic stand-in for SentenceTransformer: a bag-of-letters vector."""

    def __init__(self):
        self.calls: list[list[str]] = []

    def encode(self, sentences, **kwargs):
        self.calls.append(list(sentences))
        vectors = np.zeros((len(sentences), 26), dtype=np.float32)
        for row, sentence in enumerate(sentences):
            for ch in sentence.lower():
                if "a" <= ch <= "z":
                    vectors[row, ord(ch) - 97] += 1
        return vectors


def fake_service(**kwargs):
    model = FakeModel()
    loads = []

    def loader(name):
        loads.append(name)
        time.sleep(0.05)
        return model

    return EmbeddingService("test/model", loader=loader, **kwargs), model, loads


# --- Model initialisation -------------------------------------------------


def test_model_is_loaded_once_and_reused():
    service, model, loads = fake_service()
    assert not service.is_loaded
    for _ in range(3):
        service.generate_embeddings(["first", "second"])
        service.generate_embedding("third")
    assert loads == ["test/model"]
    assert service.is_loaded


def test_concurrent_first_use_loads_once():
    service, _, loads = fake_service()
    threads = [threading.Thread(target=service.generate_embedding, args=(f"text {i}",)) for i in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert loads == ["test/model"]


def test_load_failure_is_controlled_and_retried_after_cooldown():
    attempts = []

    def broken(name):
        attempts.append(name)
        raise OSError("/home/someone/.cache/huggingface/secret-path not found")

    service = EmbeddingService("test/model", loader=broken, retry_after_seconds=0.2)
    with pytest.raises(EmbeddingModelUnavailable) as error:
        service.generate_embedding("x")
    assert "secret-path" not in str(error.value)
    # Within the cooldown no new load is attempted.
    with pytest.raises(EmbeddingModelUnavailable):
        service.load()
    assert len(attempts) == 1
    time.sleep(0.25)
    with pytest.raises(EmbeddingModelUnavailable):
        service.load()
    assert len(attempts) == 2


def test_encoding_failure_is_controlled():
    class Exploding:
        def encode(self, sentences, **kwargs):
            raise RuntimeError("CUDA out of memory at /opt/model")

    service = EmbeddingService("test/model", loader=lambda name: Exploding())
    with pytest.raises(EmbeddingModelUnavailable):
        service.generate_embedding("x")


def test_invalid_model_output_is_rejected():
    class WrongShape:
        def encode(self, sentences, **kwargs):
            return np.zeros((len(sentences) + 1, 4))

    service = EmbeddingService("test/model", loader=lambda name: WrongShape())
    with pytest.raises(EmbeddingModelUnavailable):
        service.generate_embeddings(["a", "b"])


def test_shared_service_is_a_singleton():
    assert get_embedding_service() is get_embedding_service()


# --- Embedding generation and batching ------------------------------------


def test_embeddings_are_unit_length_and_in_input_order():
    service, _, _ = fake_service()
    vectors = service.generate_embeddings(["abc", "zzz", "abc"])
    assert all(abs(np.linalg.norm(v) - 1) < 1e-6 for v in vectors)
    assert np.allclose(vectors[0], vectors[2])
    assert not np.allclose(vectors[0], vectors[1])


def test_batch_embeds_each_distinct_text_once():
    service, model, _ = fake_service()
    service.generate_embeddings(["alpha", "beta", "alpha", "gamma", "beta"])
    assert model.calls == [["alpha", "beta", "gamma"]]


def test_cache_avoids_repeated_model_work():
    service, model, _ = fake_service()
    service.generate_embeddings(["alpha", "beta"])
    service.generate_embeddings(["beta", "alpha", "delta"])
    assert model.calls == [["alpha", "beta"], ["delta"]]


def test_cache_has_a_size_limit():
    service, model, _ = fake_service(cache_size=2)
    service.generate_embeddings(["aa", "bb", "cc"])  # "aa" is evicted
    service.generate_embeddings(["aa"])
    assert model.calls[-1] == ["aa"]
    assert len(service._cache) == 2


def test_cache_keys_are_hashes_not_text():
    service, _, _ = fake_service()
    service.generate_embedding("john.doe@example.com")
    assert all(len(key) == 64 and "john" not in key for key in service._cache)


def test_text_without_direction_gives_none():
    service, _, _ = fake_service()
    # The fake model gives a zero vector for text with no letters.
    assert service.generate_embeddings(["12345", "abc"])[0] is None


# --- Cosine similarity ----------------------------------------------------


def test_cosine_similarity_values():
    assert calculate_cosine_similarity([1, 0], [1, 0]) == pytest.approx(1)
    assert calculate_cosine_similarity([1, 0], [0, 1]) == pytest.approx(0)
    assert calculate_cosine_similarity([1, 0], [-1, 0]) == pytest.approx(-1)
    assert calculate_cosine_similarity([3, 4], [6, 8]) == pytest.approx(1)


@pytest.mark.parametrize(
    "a, b",
    [
        ([0, 0], [1, 0]),
        ([0, 0], [0, 0]),
        ([1, 0], [1, 0, 0]),
        ([], []),
        ([np.nan, 1], [1, 1]),
        ([np.inf, 1], [1, 1]),
        ([[1, 0]], [[1, 0]]),
    ],
)
def test_cosine_similarity_rejects_unusable_vectors(a, b):
    assert calculate_cosine_similarity(a, b) is None


def test_normalize():
    assert np.allclose(normalize(np.array([3.0, 4.0])), [0.6, 0.8])
    assert normalize(np.zeros(3)) is None
    assert normalize(np.array([np.nan, 1.0])) is None


@pytest.mark.parametrize(
    "name, shown",
    [
        ("sentence-transformers/all-MiniLM-L6-v2", "sentence-transformers/all-MiniLM-L6-v2"),
        ("all-MiniLM-L6-v2", "all-MiniLM-L6-v2"),
        ("/opt/models/minilm", "custom-model"),
        ("./models/minilm", "custom-model"),
        ("C:\\models\\minilm", "custom-model"),
    ],
)
def test_public_model_name_never_shows_paths(name, shown):
    assert public_model_name(name) == shown


# --- Real model -----------------------------------------------------------


def test_real_model_embeddings(real_embedding_service):
    vector = real_embedding_service.generate_embedding("Developed REST APIs with Node.js")
    assert vector.shape == (384,)
    assert abs(float(np.linalg.norm(vector)) - 1) < 1e-5


def test_real_model_identical_and_related_texts(real_embedding_service):
    api, backend, nurse = real_embedding_service.generate_embeddings(
        [
            "Developed RESTful APIs using Express and JavaScript.",
            "Backend API development with Node.js and server-side JavaScript.",
            "Registered nurse providing patient care in an emergency department.",
        ]
    )
    assert calculate_cosine_similarity(api, api) > 0.999
    related, unrelated = calculate_cosine_similarity(api, backend), calculate_cosine_similarity(api, nurse)
    assert related > unrelated + 0.2
    assert related > 0.5 and unrelated < 0.4
