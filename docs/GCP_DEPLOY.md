# Deploy Backend to Cloud Run (Vertex AI + ElevenLabs TTS)

This deploys the `backend/` service to Cloud Run and configures:
- Vertex AI (Gemini) via runtime service account IAM
- ElevenLabs API key via Secret Manager
- `AURA_BACKEND_AUTH_TOKEN` via Secret Manager

## Prereqs

- GCP project selected and billing enabled
- APIs enabled:
  - Cloud Run Admin API
  - Vertex AI API
  - Secret Manager API
  - Artifact Registry API
  - Cloud Build API
- Runtime service account exists (example): `aura-cloudrun@PROJECT_ID.iam.gserviceaccount.com`
  - Roles:
    - `roles/aiplatform.user`
    - `roles/secretmanager.secretAccessor` (or per-secret binding)

## 1) Create secrets (Secret Manager)

Create:
- `ELEVENLABS_API_KEY`
- `AURA_BACKEND_AUTH_TOKEN`

## 2) Deploy (buildpacks)

From the repo root:

```bash
gcloud run deploy aura-backend \
  --source backend \
  --region us-central1 \
  --service-account aura-cloudrun@PROJECT_ID.iam.gserviceaccount.com \
  --allow-unauthenticated \
  --set-env-vars GOOGLE_CLOUD_PROJECT=PROJECT_ID,GOOGLE_CLOUD_REGION=us-central1,AURA_GEMINI_MODEL=GEMINI_MODEL_ID,ELEVENLABS_VOICE_ID=VOICE_ID \
  --set-secrets ELEVENLABS_API_KEY=ELEVENLABS_API_KEY:latest,AURA_BACKEND_AUTH_TOKEN=AURA_BACKEND_AUTH_TOKEN:latest
```

Notes:
- “Allow unauthenticated” is OK for a demo **only if** your backend enforces `Authorization: Bearer $AURA_BACKEND_AUTH_TOKEN`.
- Keep Cloud Run + Vertex AI in the same region where possible.

## 3) Smoke test

```bash
curl -sS https://YOUR_CLOUD_RUN_URL/healthz
```

For authenticated endpoints:

```bash
curl -sS https://YOUR_CLOUD_RUN_URL/plan \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"instruction":"Open Chrome","desktop_state":{"os":"macos","frontmost_app":"Finder"}}'
```

## 4) Proof of GCP deployment

Record a short screen capture showing:
- Cloud Run service page (URL + recent revisions)
- Cloud Run logs containing requests to `/plan` and successful Vertex AI invocation

