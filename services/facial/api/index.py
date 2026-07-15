"""Punto de entrada para el runtime Python de Vercel.

Vercel expone la app ASGI que se llame `app` en este módulo. Todas las rutas se
enrutan aquí (ver vercel.json), así que /face/identify, /face/enroll y /health
siguen funcionando igual que on-premise: el contrato NO cambia.
"""

import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import app  # noqa: E402  (re-exportado para Vercel)

__all__ = ["app"]
