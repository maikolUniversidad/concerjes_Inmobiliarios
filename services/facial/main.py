"""
Microservicio de reconocimiento facial — Conserjes Inmobiliarios Ltda.
Módulo Registro de Vacantes.

Diseñado para correr SERVERLESS (Vercel, runtime Python) y también on-premise.
Por eso evita `insightface` y `torch`: solo onnxruntime + OpenCV, que tienen
wheels manylinux y instalan sin compilar.

Pipeline:
  1. Detección + 5 puntos faciales → OpenCV YuNet (~230 KB)
  2. Alineación afín al template estándar de ArcFace (112x112)
  3. Embedding ArcFace 512-d (w600k_mbf, ~13 MB) → normalizado L2
  4. Liveness / anti-spoofing → ver LIVENESS_MODE (en serverless no hay torch)

Contrato (el que ya consume la app Next.js):
  POST /face/identify { "image": "<data-url|base64>" }
    -> { embedding[512], quality, liveness_score, liveness_disponible }
  POST /face/enroll   -> { ..., modelo_version }
  GET  /health

`liveness_score` es null cuando no hay motor de anti-spoofing. La app trata
null como "no verificado": permite IDENTIFICAR (que siempre exige 2º factor
antes de mostrar datos) pero NO otorga sesión por sí solo.

Sin estado: no persiste imágenes ni embeddings.
"""

import base64
import binascii
import io
import logging
import os
import threading
import urllib.request
import zipfile
from typing import List, Optional, Tuple

import cv2
import numpy as np
import onnxruntime as ort
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel

log = logging.getLogger("facial")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))

# En serverless solo /tmp es escribible.
CACHE_DIR = os.getenv("FACIAL_CACHE_DIR", "/tmp/modelos-facial")
TOKEN = os.getenv("FACIAL_SERVICE_TOKEN")
LIVENESS_MODE = os.getenv("LIVENESS_MODE", "none").lower()  # none | fasnet(on-prem)

URL_YUNET = os.getenv(
    "FACIAL_URL_YUNET",
    "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
)
# w600k_mbf.onnx vive dentro del pack buffalo_s (ArcFace, 512-d).
URL_BUFFALO_S = os.getenv(
    "FACIAL_URL_BUFFALO_S",
    "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_s.zip",
)
MODELO_REC = os.getenv("FACIAL_MODELO_REC", "w600k_mbf.onnx")
MODEL_VERSION = f"{MODELO_REC}/yunet2023mar"

app = FastAPI(title="Servicio facial · Conserjes Inmobiliarios", version="2.0.0")

_lock = threading.Lock()
_detector = None
_recognizer: Optional[ort.InferenceSession] = None

# Template de 5 puntos de ArcFace para 112x112 (orden: ojo izq, ojo der,
# nariz, comisura izq, comisura der — en coordenadas de imagen).
ARCFACE_SRC = np.array(
    [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366],
     [41.5493, 92.3655], [70.7299, 92.2041]],
    dtype=np.float32,
)


def _descargar(url: str, destino: str) -> str:
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    if os.path.exists(destino) and os.path.getsize(destino) > 0:
        return destino
    log.info("Descargando %s …", url)
    with urllib.request.urlopen(url, timeout=120) as r, open(destino, "wb") as f:
        f.write(r.read())
    return destino


def _ruta_yunet() -> str:
    return _descargar(URL_YUNET, os.path.join(CACHE_DIR, "yunet.onnx"))


def _ruta_reconocedor() -> str:
    destino = os.path.join(CACHE_DIR, MODELO_REC)
    if os.path.exists(destino) and os.path.getsize(destino) > 0:
        return destino
    os.makedirs(CACHE_DIR, exist_ok=True)
    log.info("Descargando pack %s …", URL_BUFFALO_S)
    with urllib.request.urlopen(URL_BUFFALO_S, timeout=300) as r:
        datos = r.read()
    with zipfile.ZipFile(io.BytesIO(datos)) as z:
        nombre = next((n for n in z.namelist() if n.endswith(MODELO_REC)), None)
        if not nombre:
            raise RuntimeError(f"{MODELO_REC} no está en el pack")
        with z.open(nombre) as src, open(destino, "wb") as dst:
            dst.write(src.read())
    return destino


def detector():
    """YuNet. Carga perezosa y reutilizable entre invocaciones tibias."""
    global _detector
    with _lock:
        if _detector is None:
            _detector = cv2.FaceDetectorYN.create(
                model=_ruta_yunet(), config="", input_size=(320, 320),
                score_threshold=0.6, nms_threshold=0.3, top_k=50,
            )
        return _detector


def recognizer() -> ort.InferenceSession:
    global _recognizer
    with _lock:
        if _recognizer is None:
            _recognizer = ort.InferenceSession(
                _ruta_reconocedor(), providers=["CPUExecutionProvider"]
            )
        return _recognizer


def auth(authorization: str | None = Header(default=None)):
    if not TOKEN:
        return
    if authorization != f"Bearer {TOKEN}":
        raise HTTPException(status_code=401, detail="No autorizado")


class ImagenIn(BaseModel):
    image: str


def decodificar(data: str) -> np.ndarray:
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


def detectar(img: np.ndarray) -> np.ndarray:
    """Devuelve la fila de la cara detectada: [x,y,w,h, 10 coords, score]."""
    h, w = img.shape[:2]
    d = detector()
    d.setInputSize((w, h))
    _, caras = d.detect(img)
    if caras is None or len(caras) == 0:
        raise HTTPException(status_code=422, detail="No se detectó ningún rostro")
    if len(caras) > 1:
        raise HTTPException(status_code=422, detail="Se detectó más de un rostro")
    return caras[0]


def alinear(img: np.ndarray, cara: np.ndarray) -> np.ndarray:
    """Recorta y alinea a 112x112 usando los 5 puntos y el template ArcFace."""
    pts = cara[4:14].reshape(5, 2).astype(np.float32)
    M, _ = cv2.estimateAffinePartial2D(pts, ARCFACE_SRC, method=cv2.LMEDS)
    if M is None:
        raise HTTPException(status_code=422, detail="No se pudo alinear el rostro")
    return cv2.warpAffine(img, M, (112, 112), borderValue=0.0)


def embedding(chip: np.ndarray) -> List[float]:
    """ArcFace: BGR→RGB, normaliza a [-1,1], NCHW. Devuelve 512-d L2-normalizado."""
    x = cv2.cvtColor(chip, cv2.COLOR_BGR2RGB).astype(np.float32)
    x = (x - 127.5) / 127.5
    x = np.transpose(x, (2, 0, 1))[None, ...]
    s = recognizer()
    salida = s.run(None, {s.get_inputs()[0].name: x})[0][0]
    v = np.asarray(salida, dtype=np.float32)
    if v.shape[0] != 512:
        raise HTTPException(status_code=500, detail=f"Se esperaban 512 dims, llegaron {v.shape[0]}")
    norma = np.linalg.norm(v)
    if norma == 0:
        raise HTTPException(status_code=500, detail="Embedding inválido")
    return (v / norma).tolist()


def calidad(img: np.ndarray, cara: np.ndarray) -> float:
    """0..1 por confianza de detección, nitidez y tamaño del rostro."""
    score = float(cara[14])
    x, y, w, h = [int(v) for v in cara[:4]]
    x, y = max(0, x), max(0, y)
    crop = img[y:y + max(0, h), x:x + max(0, w)]
    nitidez = 0.0
    if crop.size:
        gris = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        nitidez = float(cv2.Laplacian(gris, cv2.CV_64F).var())
    nitidez_n = min(1.0, nitidez / 120.0)
    tam_n = min(1.0, (w * h) / float(112 * 112 * 4))
    return round(float(max(0.0, min(1.0, 0.5 * score + 0.3 * nitidez_n + 0.2 * tam_n))), 4)


def liveness(img: np.ndarray) -> Optional[float]:
    """None = no hay motor de anti-spoofing (serverless sin torch)."""
    if LIVENESS_MODE != "fasnet":
        return None
    try:
        from deepface import DeepFace  # solo disponible on-premise

        caras = DeepFace.extract_faces(img_path=img, anti_spoofing=True, enforce_detection=False)
        if not caras:
            return 0.0
        c = caras[0]
        s = float(c.get("antispoof_score", 0.0) or 0.0)
        return round(s if bool(c.get("is_real", False)) else max(0.0, 1.0 - s), 4)
    except Exception as e:  # noqa: BLE001
        log.exception("Anti-spoofing falló: %s", e)
        return 0.0  # falla cerrado: nunca "vivo" por defecto


def procesar(img: np.ndarray) -> Tuple[List[float], float, Optional[float]]:
    cara = detectar(img)
    emb = embedding(alinear(img, cara))
    return emb, calidad(img, cara), liveness(img)


@app.get("/health")
def health():
    return {
        "ok": True,
        "modelo": MODEL_VERSION,
        "liveness": LIVENESS_MODE,
        "liveness_disponible": LIVENESS_MODE == "fasnet",
        "auth": bool(TOKEN),
    }


@app.post("/face/identify")
def identify(body: ImagenIn, _=Depends(auth)):
    emb, q, l = procesar(decodificar(body.image))
    return {
        "embedding": emb, "quality": q,
        "liveness_score": l, "liveness_disponible": l is not None,
    }


@app.post("/face/enroll")
def enroll(body: ImagenIn, _=Depends(auth)):
    emb, q, l = procesar(decodificar(body.image))
    return {
        "embedding": emb, "quality": q,
        "liveness_score": l, "liveness_disponible": l is not None,
        "modelo_version": MODEL_VERSION,
    }
