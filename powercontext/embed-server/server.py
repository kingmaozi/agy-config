import asyncio
import os
import time
from contextlib import asynccontextmanager

import mlx.core as mx
import numpy as np
import uvicorn
from fastapi import FastAPI
from pydantic import BaseModel

MODEL_ID = os.environ.get("EMBED_MODEL", "mlx-community/embeddinggemma-2-8bit")
SERVED_NAME = os.environ.get("EMBED_NAME", "EmbeddingGemma-2-768")
MAX_LEN = int(os.environ.get("EMBED_MAX_LEN", "8192"))
PREFIX = os.environ.get("EMBED_PREFIX", "")

state = {"model": None, "tokenizer": None, "native_dim": None}
lock = asyncio.Lock()


def load_model():
    from mlx_vlm.embedding_loader import load_embedding_model
    from mlx_vlm.utils import get_model_path
    from transformers import AutoTokenizer
    path = get_model_path(MODEL_ID)
    model = load_embedding_model(path)
    tokenizer = AutoTokenizer.from_pretrained(path)
    enc = tokenizer(["warmup"], padding=True, truncation=True, max_length=32, return_tensors="np")
    out = model(**{k: mx.array(v) for k, v in enc.items()})
    mx.eval(out.text_embeds)
    dim = int(out.text_embeds.shape[1])
    state.update(model=model, tokenizer=tokenizer, native_dim=dim)
    return dim


@asynccontextmanager
async def lifespan(app):
    dim = await asyncio.to_thread(load_model)
    print(f"loaded {MODEL_ID} dim={dim} prefix={PREFIX!r}", flush=True)
    yield


app = FastAPI(lifespan=lifespan)


class EmbeddingRequest(BaseModel):
    input: str | list[str]
    model: str | None = None
    dimensions: int | None = None
    encoding_format: str | None = None


def embed_texts(texts, dimensions=None):
    tokenizer = state["tokenizer"]
    model = state["model"]
    prepared = [PREFIX + t for t in texts]
    enc = tokenizer(prepared, padding=True, truncation=True, max_length=MAX_LEN, return_tensors="np")
    started = time.perf_counter()
    out = model(**{k: mx.array(v) for k, v in enc.items()})
    mx.eval(out.text_embeds)
    elapsed = time.perf_counter() - started
    arr = np.array(out.text_embeds.astype(mx.float32), dtype=np.float32)
    if dimensions and 0 < dimensions < arr.shape[1]:
        arr = arr[:, :dimensions].copy()
    arr = arr / np.maximum(np.linalg.norm(arr, axis=1, keepdims=True), 1e-12)
    tokens = int(np.asarray(enc["attention_mask"]).sum())
    return arr, tokens, elapsed


@app.get("/health")
async def health():
    return {"status": "ok", "model": SERVED_NAME, "model_id": MODEL_ID, "dim": state["native_dim"]}


@app.get("/v1/models")
async def models():
    return {"object": "list", "data": [{"id": SERVED_NAME, "object": "model", "owned_by": "local"}]}


@app.post("/v1/embeddings")
async def embeddings(req: EmbeddingRequest):
    texts = [req.input] if isinstance(req.input, str) else list(req.input)
    if not texts or any(not isinstance(t, str) for t in texts):
        return {"error": {"message": "input must be a string or a list of strings", "type": "invalid_request_error"}}
    texts = [t if t else " " for t in texts]
    async with lock:
        arr, tokens, elapsed = await asyncio.to_thread(embed_texts, texts, req.dimensions)
    data = [{"object": "embedding", "index": i, "embedding": vec.tolist()} for i, vec in enumerate(arr)]
    return {
        "object": "list",
        "data": data,
        "model": SERVED_NAME,
        "usage": {"prompt_tokens": tokens, "total_tokens": tokens},
        "took_ms": round(elapsed * 1000, 1),
    }


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", "8001")))
