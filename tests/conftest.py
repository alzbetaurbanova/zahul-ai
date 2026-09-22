"""
Shared test setup.

Two things have to happen before any application module is imported:

* DATABASE_URL must point somewhere disposable - api.db.database reads it at
  import time and Database() creates the file in its constructor, so importing
  a router with the default path would touch the real data/bot.db.
* TOKEN_KEY must be set, since api.utils.crypto caches its Fernet instance on
  first use and a missing key silently turns encryption into a no-op.
"""
import os
import tempfile

_TMP_DIR = tempfile.mkdtemp(prefix="zahul-tests-")
os.environ["DATABASE_URL"] = os.path.join(_TMP_DIR, "test.db")
os.environ.setdefault("TOKEN_KEY", "test-token-key")

import sys
from pathlib import Path

# Tests are run from the repo root, but make the imports work either way.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
