# Servicio facial — Registro de Vacantes

Reconocimiento facial 1:N para el módulo Registro de Vacantes. Corre **serverless
en Vercel** (recomendado, cero infraestructura) o **on-premise con Docker**.

- **Detección + 5 puntos:** OpenCV **YuNet** (~230 KB)
- **Embedding:** **ArcFace 512-d** (`w600k_mbf`, ~13 MB) — normalizado L2
- **Sin `insightface` ni `torch`**: solo `onnxruntime` + OpenCV (wheels
  manylinux → instalan sin compilar, que es lo que hace viable Vercel).
- **Sin estado:** no persiste imágenes ni embeddings.

Como sigue siendo ArcFace **512-d**, el esquema `pgvector`, los umbrales y la app
**no cambian**: solo hay que apuntar `FACIAL_SERVICE_URL`.

## Contrato

```
GET  /health -> { ok, modelo, liveness, liveness_disponible, auth }

POST /face/identify   Authorization: Bearer <FACIAL_SERVICE_TOKEN>
  { "image": "data:image/jpeg;base64,…" }
  -> { embedding[512], quality, liveness_score, liveness_disponible }

POST /face/enroll  -> { ..., modelo_version }
```

`422` sin rostro o con más de uno · `400` imagen inválida · `401` token inválido.

## Desplegar en Vercel (recomendado)

Es un **proyecto Vercel aparte** (no toca el de inventario):

1. Vercel → **Add New Project** → mismo repo.
2. **Root Directory** = `services/facial`  ← importante.
3. Framework Preset = **Other** (el `vercel.json` ya enruta todo a `api/index.py`).
4. Environment Variables:
   ```
   FACIAL_SERVICE_TOKEN=<openssl rand -hex 32>
   LIVENESS_MODE=none
   ```
5. Deploy → te queda algo como `https://ci-facial.vercel.app`.
   Verifica: `curl https://ci-facial.vercel.app/health`

Luego, en el proyecto **inventario** → Environment Variables:

```
FACIAL_SERVICE_URL=https://ci-facial.vercel.app
FACIAL_SERVICE_TOKEN=<el mismo de arriba>
FACIAL_UMBRAL_MATCH=0.50
FACIAL_UMBRAL_DUDA=0.38
FACIAL_LIVENESS_MIN=0.90
```

**Redeploy** de inventario. Ahí los botones de rostro dejan de decir "no
disponible".

### Modelos
No están en el repo (pesan). Se descargan **en el primer request** a `/tmp` y
quedan cacheados mientras la instancia siga viva (Fluid Compute reutiliza
instancias, así que el costo se amortiza). El primer request tarda ~5–15 s; los
siguientes ~300–600 ms.

Si prefieres arranque instantáneo, súbelos a Vercel Blob y define
`FACIAL_URL_YUNET` y `FACIAL_URL_BUFFALO_S` apuntando allí.

## Desplegar on-premise (opcional, GPU)

```bash
cp .env.example .env      # FACIAL_SERVICE_TOKEN=..., LIVENESS_MODE=fasnet
# descomenta deepface/tf-keras en requirements.txt para el anti-spoofing
docker build -t ci-facial .
docker run -d --gpus all -p 8000:8000 --env-file .env --name ci-facial ci-facial
```
Vercel no puede llamar a una IP privada → expón con un túnel:
`cloudflared tunnel --url http://localhost:8000`.

## ⚠️ Liveness (anti-spoofing) — léelo

MiniFASNet necesita **torch (~800 MB)**, que **no cabe en serverless**. Por eso en
Vercel el servicio corre con `LIVENESS_MODE=none` y devuelve
`liveness_score: null` (no miente diciendo que verificó).

Consecuencia, implementada en la app:

| | Con liveness (on-prem) | Sin liveness (Vercel) |
|---|---|---|
| Identificar en el registro (dedup) | ✅ | ✅ (siempre exige 2º factor después) |
| Enrolar el rostro | ✅ | ✅ |
| **Login solo con la cara** | ✅ | ❌ → pide documento + contraseña |

Sin prueba de vida, **una foto impresa podría suplantar a alguien**, así que el
rostro solo *sugiere* identidad y nunca otorga sesión por sí solo. Para habilitar
el login 100% facial hay que correr on-premise con `LIVENESS_MODE=fasnet` (o
integrar un MiniFASNet en ONNX, que sí cabría en serverless).

## ⚠️ Habeas Data

Vercel **no tiene región en Colombia**: con este despliegue los rostros **salen
del país** → hay que declarar **transferencia internacional** en el aviso de
privacidad y en el consentimiento biométrico
(`apps/inventario/lib/registro/consentimientos.ts`), y subir la versión del texto
(`VERSION_CONSENTIMIENTOS`). La opción on-premise evita este trámite.

## Calibración

`FACIAL_UMBRAL_MATCH=0.50` / `DUDA=0.38` son un punto de partida para ArcFace,
**no un veredicto**. Calíbralos con 200+ rostros reales: súbelo si hay falsos
positivos, bájalo si hay falsos negativos. `w600k_mbf` es más liviano y algo
menos preciso que `buffalo_l`, así que revisa el umbral con datos reales.
