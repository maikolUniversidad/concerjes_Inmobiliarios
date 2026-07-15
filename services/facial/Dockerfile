# Servicio facial (GPU on-premise) — Conserjes Inmobiliarios
# Build:  docker build -t ci-facial .
# Run:    docker run --gpus all -p 8000:8000 --env-file .env ci-facial
FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip \
      libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

COPY main.py .

# Pre-descarga los pesos de buffalo_l en la imagen (evita latencia y
# dependencia de red en el primer request). Se hace en CPU (ctx_id=-1).
RUN python3 -c "from insightface.app import FaceAnalysis; \
    a=FaceAnalysis(name='buffalo_l', providers=['CPUExecutionProvider']); \
    a.prepare(ctx_id=-1, det_size=(640,640)); print('modelos ok')"

EXPOSE 8000

# 1 worker: el modelo vive en memoria de GPU; escala con réplicas, no con workers.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
