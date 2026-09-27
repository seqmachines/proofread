"""MongoDB connection; run `python -m backend.db` for setup-only initialization."""

import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(Path(__file__).with_name(".env"))


@lru_cache(maxsize=1)
def get_db():
    uri = os.environ.get("MONGODB_URI")
    if not uri:
        raise RuntimeError("Set MONGODB_URI in backend/.env")
    client = MongoClient(uri, appname="proofread", serverSelectionTimeoutMS=15000)
    return client["proofread"]


if __name__ == "__main__":
    # Setup can create/index GT. Normal imports (including the executor's)
    # never load setup_db or acquire a ground-truth collection handle.
    from backend import setup_db
    setup_db.initialize()
