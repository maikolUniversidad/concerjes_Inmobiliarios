# Servicio facial — Registro de Vacantes

Microservicio de reconocimiento facial 1:N para el módulo Registro de Vacantes.
Corresponde a la **⚙️ DECISIÓN 1, Opción B** del spec: motor propio sobre la GPU
on-premise (la misma infraestructura de VIGIAS-IA).

- **Detección:** SCRFD · **Embedding:** ArcFace `buffalo_l` (512-d, normalizado L2)
- **Anti-spoofing:** MiniFASNet (pasivo) vía `deepface`
- **Sin estado:** no persiste imágenes ni embeddings. Los datos biométricos
  **no salen de Colombia** (por eso no hay que declarar transferencia
  internacional ante la SIC).

## Contrato

```
GET  /health
  -> { ok, modelo, ctx_id, liveness, auth }

POST /face/identify    Authorization: Bearer <FACIAL_SERVICE_TOKEN>
  { "image": "data:image/jpeg;base64,…" }
  -> { "embedding": [512 floats], "quality": 0..1, "liveness_score": 0..1 }

POST /face/enroll      Authorization: Bearer <FACIAL_SERVICE_TOKEN>
  { "image": "…" }
  -> { "embedding": [...], "quality": …, "liveness_score": …, "modelo_version": "buffalo_l/0.7.3" }
```

Errores: `422` si no hay rostro o hay más de uno · `400` imagen inválida ·
`401` token incorrecto.

Los **umbrales viven en la app**, no aquí (`FACIAL_UMBRAL_MATCH`,
`FACIAL_UMBRAL_DUDA`, `FACIAL_LIVENESS_MIN`).

## Despliegue en la GPU

```bash
cd services/facial
cp .env.example .env          # define FACIAL_SERVICE_TOKEN (openssl rand -hex 32)
docker build -t ci-facial .
docker run -d --restart unless-stopped --gpus all -p 8000:8000 \
  --env-file .env --name ci-facial ci-facial

curl localhost:8000/health    # -> {"ok":true,...}
```

Sin Docker: `pip install -r requirements.txt && uvicorn main:app --host 0.0.0.0 --port 8000`
(en CPU, cambia `onnxruntime-gpu` por `onnxruntime` y usa `FACIAL_CTX_ID=-1`).

## ⚠️ Exponerlo a Vercel (el paso que suele faltar)

La app corre en Vercel (nube) y este servicio en tu red local. Vercel **no puede
llamar a una IP privada**. Necesitas una URL pública HTTPS. Lo más simple y
seguro es un túnel (no abre puertos en el firewall):

```bash
# Cloudflare Tunnel (recomendado, gratis)
cloudflared tunnel --url http://localhost:8000
# te da algo como https://xxxx.trycloudflare.com
```

Para producción, crea un túnel nombrado con un dominio propio
(p. ej. `facial.conserjesinmobiliarios.com`) para que la URL sea estable.

Luego, en **Vercel → proyecto de inventario → Settings → Environment Variables**:

```
FACIAL_SERVICE_URL=https://facial.conserjesinmobiliarios.com
FACIAL_SERVICE_TOKEN=<el mismo del .env>
FACIAL_UMBRAL_MATCH=0.50
FACIAL_UMBRAL_DUDA=0.38
FACIAL_LIVENESS_MIN=0.90
```

**Redeploy** para que tomen efecto. En cuanto `FACIAL_SERVICE_URL` exista, la app
deja de responder `disponible:false` y los botones de rostro empiezan a funcionar.

## Calibración de umbrales (importante)

Los valores por defecto (`MATCH ≥ 0.50`, `DUDA 0.38–0.50`) son un punto de
partida razonable para ArcFace, **no un veredicto**. El spec pide calibrarlos con
un set real de **200+ rostros** del personal:

- Sube el umbral si aparecen **falsos positivos** (reconoce a quien no es).
- Bájalo si hay muchos **falsos negativos** (no reconoce a quien sí es).

Se ajustan por variable de entorno, sin tocar código.

## Notas de seguridad y ley

- `LIVENESS_MODE=disabled` devuelve `1.0` siempre: **solo para pruebas**. Sin
  anti-spoofing, una foto impresa puede engañar al sistema.
- Si el anti-spoofing falla por cualquier razón, el servicio devuelve
  `liveness_score = 0.0` (falla cerrado, nunca deja pasar como "vivo").
- Un MATCH facial **no autentica por sí solo** en el registro: la app siempre
  pide el 2º factor (últimos 4 del documento) antes de mostrar datos personales.
- Protege el servicio con `FACIAL_SERVICE_TOKEN` y exponlo **solo** por el túnel.
