# The Pantry Chef API as a Hugging Face Docker Space (https://huggingface.co/docs/hub/spaces-sdks-docker),
# or any other container host. Configuration comes from environment variables (Space secrets):
# DATABASE_URL, SUPABASE_URL, ANTHROPIC_API_KEY, CORS_ORIGINS, ... (see .env.example).
FROM python:3.11-slim

# ONNX Runtime needs OpenMP; OpenCV's headless build needs GLib.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Spaces run the container as user 1000.
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    PYTHONUNBUFFERED=1
WORKDIR /home/user/app

COPY --chown=user requirements.txt requirements-vision.txt ./
RUN pip install --no-cache-dir --user -r requirements.txt -r requirements-vision.txt

# Bake the grocery detector into the image: a Space's disk is wiped on restart, and downloading
# 155 MB every time it wakes up would make the first scan very slow.
ARG VISION_MODEL_REPO=Xenova/owlv2-base-patch16-ensemble
ARG VISION_MODEL_FILE=onnx/model_quantized.onnx
ENV VISION_MODEL_REPO=$VISION_MODEL_REPO \
    VISION_MODEL_FILE=$VISION_MODEL_FILE
RUN python -c "from huggingface_hub import hf_hub_download as get; \
[get('$VISION_MODEL_REPO', f) for f in ('$VISION_MODEL_FILE', 'tokenizer.json', 'preprocessor_config.json')]"

COPY --chown=user app ./app

EXPOSE 7860
CMD ["fastapi", "run", "app/main.py", "--host", "0.0.0.0", "--port", "7860"]
