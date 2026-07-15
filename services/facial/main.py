"""
Microservicio de reconocimiento facial — Conserjes Inmobiliarios Ltda.
Módulo Registro de Vacantes (⚙️ DECISIÓN 1, Opción B: GPU on-premise).

Pipeline por petición:
  1. Detección de rostro (SCRFD, incluido en InsightFace buffalo_l)
  2. Liveness / anti-spoofing pasivo (MiniFASNet vía deepface)
  3. Alineación + embedding ArcFace 512-d (normalizado L2)
  4. Calidad (nitidez / pose / tamaño / confianza de detección)

Contrato (el que ya consume la app Next.js):
  POST /face/identify  { "image": "<data-url o base64 jpeg>" }
    -> { "embedding": [512 floats], "quality": 0..1, "liveness_score": 0..1 }
  POST /face/enroll    { "image": ... }
    -> { ..., "modelo_version": "buffalo_l/<version>" }
  GET  /health -> { "ok": true, ... }

El embedding se devuelve NORMALIZADO (L2): la similitud coseno de pgvector
(vector_cosine_ops) equivale al producto punto. Los umbrales MATCH/DUDA viven
en la app (variables de entorno), no aquí.

Los datos biométricos NO se persisten en este servicio: es sin estado.
"""

import base64
import binascii
import logging
import os
from typing import List, Tuple

import cv2
import numpy as np
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel

log = logging.getLogger("facial")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))

MODEL_NAME = os.getenv("FACIAL_MODEL", "buffalo_l")
DET_SIZE = int(os.getenv("FACIAL_DET_SIZE", "640"))
# ctx_id: 0 = primera GPU · -1 = CPU (solo para pruebas; en la GPU deja 0)
CTX_ID = int(os.getenv("FACIAL_CTX_ID", "0"))
TOKEN = os.getenv("FACIAL_SERVICE_TOKEN")
# fasnet = anti-spoofing real (recomendado) · disabled = SOLO pruebas
LIVENESS_MODE = os.getenv("LIVENESS_MODE", "fasnet").lower()

app = FastAPI(title="Servicio facial · Conserjes Inmobiliarios", version="1.0.0")

_analyzer = None


def analyzer():
    """Carga perezosa del modelo (una sola vez por proceso)."""
    global _analyzer
    if _analyzer is None:
        from insightface.app import FaceAnalysis

        log.info("Cargando modelo %s (ctx_id=%s, det_size=%s)…", MODEL_NAME, CTX_ID, DET_SIZE)
        a = FaceAnalysis(
            name=MODEL_NAME,
            providers=["CUDAExecutionProvider", "CPUExecutionProvider"],
        )
        a.prepare(ctx_id=CTX_ID, det_size=(DET_SIZE, DET_SIZE))
        _analyzer = a
        log.info("Modelo listo.")
    return _analyzer


def auth(authorization: str | None = Header(default=None)):
    """Bearer token compartido con la app (FACIAL_SERVICE_TOKEN)."""
    if not TOKEN:
        return  # sin token configurado = servicio abierto (solo para red interna)
    if authorization != f"Bearer {TOKEN}":
        raise HTTPException(status_code=401, detail="No autorizado")


class ImagenIn(BaseModel):
    image: str


def decodificar(data: str) -> np.ndarray:
    """Acepta data-URL ('data:image/jpeg;base64,…') o base64 puro."""
    if not data:
        raise HTTPException(status_code=400, detail="Falta la imagen")
    if data.strip().startswith("data:") and "," in data:
        data = data.split(",", 1)[1]
    try:
        raw = base64.b64decode(data, validate=False)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="Imagen base64 inválida")
    img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="No se pudo decodificar la imagen")
    return img


def _nitidez(crop: np.ndarray) -> float:
    if crop is None or crop.size == 0:
        return 0.0
    gris = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(gris, cv2.CV_64F).var())


def calidad(face, img: np.ndarray) -> float:
    """0..1 combinando confianza de detección, nitidez, pose y tamaño."""
    det = float(getattr(face, "det_score", 0.0) or 0.0)

    x1, y1, x2, y2 = [int(v) for v in face.bbox]
    x1, y1 = max(0, x1), max(0, y1)
    crop = img[y1:max(y1, y2), x1:max(x1, x2)]

    nitidez_n = min(1.0, _nitidez(crop) / 120.0)  # ~120 = foto de celular nítida

    pose_n = 1.0
    pose = getattr(face, "pose", None)
    if pose is not None:
        yaw, pitch, _roll = [abs(float(v)) for v in pose]
        pose_n = max(0.0, 1.0 - (max(yaw, pitch) / 45.0))  # >45° de giro = 0

    area = max(0, (x2 - x1)) * max(0, (y2 - y1))
    tam_n = min(1.0, area / float(112 * 112 * 4))  # rostro muy pequeño = baja calidad

    score = 0.40 * det + 0.25 * nitidez_n + 0.20 * pose_n + 0.15 * tam_n
    return round(float(max(0.0, min(1.0, score))), 4)


def liveness(img: np.ndarray) -> float:
    """Anti-spoofing pasivo (MiniFASNet). 1.0 = persona real."""
    if LIVENESS_MODE == "disabled":
        log.warning("LIVENESS_MODE=disabled → se devuelve 1.0. NO usar en producción.")
        return 1.0
    try:
        from deepface import DeepFace

        caras = DeepFace.extract_faces(
            img_path=img, anti_spoofing=True, enforce_detection=False
        )
        if not caras:
            return 0.0
        c = caras[0]
        score = float(c.get("antispoof_score", 0.0) or 0.0)
        es_real = bool(c.get("is_real", False))
        # Un spoof con alta confianza debe dar liveness BAJO.
        return round(score if es_real else max(0.0, 1.0 - score), 4)
    except Exception as e:  # noqa: BLE001
        # Nunca dejamos pasar como "vivo" si el anti-spoofing falla.
        log.exception("Fallo el anti-spoofing: %s", e)
        return 0.0


def procesar(img: np.ndarray) -> Tuple[List[float], float, float]:
    caras = analyzer().get(img)
    if not caras:
        raise HTTPException(status_code=422, detail="No se detectó ningún rostro")
    if len(caras) > 1:
        raise HTTPException(status_code=422, detail="Se detectó más de un rostro")
    cara = caras[0]

    emb = getattr(cara, "normed_embedding", None)
    if emb is None:
        raise HTTPException(status_code=500, detail="El modelo no devolvió embedding")
    vector = np.asarray(emb, dtype=np.float32)
    if vector.shape[0] != 512:
        raise HTTPException(
            status_code=500,
            detail=f"Se esperaban 512 dimensiones y llegaron {vector.shape[0]}",
        )
    return vector.tolist(), calidad(cara, img), liveness(img)


@app.get("/health")
def health():
    return {
        "ok": True,
        "modelo": MODEL_NAME,
        "ctx_id": CTX_ID,
        "liveness": LIVENESS_MODE,
        "auth": bool(TOKEN),
    }


@app.post("/face/identify")
def identify(body: ImagenIn, _=Depends(auth)):
    emb, q, l = procesar(decodificar(body.image))
    return {"embedding": emb, "quality": q, "liveness_score": l}


@app.post("/face/enroll")
def enroll(body: ImagenIn, _=Depends(auth)):
    import insightface

    emb, q, l = procesar(decodificar(body.image))
    return {
        "embedding": emb,
        "quality": q,
        "liveness_score": l,
        "modelo_version": f"{MODEL_NAME}/{insightface.__version__}",
    }
