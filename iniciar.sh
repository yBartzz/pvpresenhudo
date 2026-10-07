#!/usr/bin/env bash
# Inicia o PEDRO CITY em http://localhost:8000
cd "$(dirname "$0")"
(sleep 1 && (xdg-open http://localhost:8000 >/dev/null 2>&1 || true)) &
exec python3 server.py 8000
