"""GroundingDINO detector server (port 8001).

Exposes a single endpoint matching the contract that
sar_agent.perception_client.PerceptionClient.detect() expects:

    POST /detect
    multipart/form-data:
        image:  JPEG bytes
        prompt: free-form text describing the target

    200 OK:
    {"detections": [{"label": str, "bbox": [x, y, w, h], "confidence": float}, ...]}

Designed to run on the MI300X (vlm-host) alongside vLLM. ROCm-capable; falls
back to CPU if no GPU is available so the same image runs on developer
laptops for testing.

Why GroundingDINO over YOLO-World here:
- Stronger natural-language grounding (better with phrases like
  "person wearing a red jacket"); YOLO-World is faster but more class-bound.
- Both are zero-shot; no training needed.

Environment:
    DETECTOR_HOST         default 0.0.0.0
    DETECTOR_PORT         default 8001
    DETECTOR_MODEL_ID     default IDEA-Research/grounding-dino-tiny
    DETECTOR_DEVICE       default auto  (cuda|cpu|auto)
    DETECTOR_BOX_THRESH   default 0.30
    DETECTOR_TEXT_THRESH  default 0.25
"""

from __future__ import annotations

import io
import logging
import os
import time

import numpy as np
import torch
import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from PIL import Image
from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor


log = logging.getLogger('detector_server')
logging.basicConfig(level=os.environ.get('LOG_LEVEL', 'INFO'))


def _resolve_device() -> str:
    pref = os.environ.get('DETECTOR_DEVICE', 'auto')
    if pref == 'cpu':
        return 'cpu'
    if pref == 'cuda':
        return 'cuda'
    return 'cuda' if torch.cuda.is_available() else 'cpu'


class DetectorService:
    def __init__(self) -> None:
        self.model_id = os.environ.get(
            'DETECTOR_MODEL_ID', 'IDEA-Research/grounding-dino-tiny'
        )
        self.device = _resolve_device()
        self.box_threshold = float(os.environ.get('DETECTOR_BOX_THRESH', '0.30'))
        self.text_threshold = float(os.environ.get('DETECTOR_TEXT_THRESH', '0.25'))
        log.info(
            f'Loading {self.model_id} on {self.device} '
            f'(box>={self.box_threshold}, text>={self.text_threshold})...'
        )
        self.processor = AutoProcessor.from_pretrained(self.model_id)
        self.model = AutoModelForZeroShotObjectDetection.from_pretrained(self.model_id).to(self.device)
        self.model.eval()
        log.info('Detector ready.')

    def detect(self, image: Image.Image, prompt: str) -> list[dict]:
        # GroundingDINO expects period-separated phrases as the text query.
        text = prompt.strip()
        if not text.endswith('.'):
            text = text + '.'
        inputs = self.processor(images=image, text=text, return_tensors='pt').to(self.device)
        with torch.no_grad():
            outputs = self.model(**inputs)
        target_sizes = torch.tensor([image.size[::-1]], device=self.device)
        results = self.processor.post_process_grounded_object_detection(
            outputs,
            inputs.input_ids,
            threshold=self.box_threshold,
            target_sizes=target_sizes,
        )[0]
        out: list[dict] = []
        for box, score, label in zip(results['boxes'], results['scores'], results['labels']):
            x1, y1, x2, y2 = box.tolist()
            out.append({
                'label': str(label) if label else prompt,
                'bbox': [float(x1), float(y1), float(x2 - x1), float(y2 - y1)],
                'confidence': float(score),
            })
        return out


service: DetectorService | None = None
app = FastAPI(title='ASAR Detector', version='0.1.0')


@app.on_event('startup')
def _startup() -> None:
    global service
    service = DetectorService()


@app.get('/healthz')
def healthz() -> dict:
    if service is None:
        raise HTTPException(503, 'model not loaded')
    return {
        'status': 'ok',
        'model': service.model_id,
        'device': service.device,
    }


@app.post('/detect')
async def detect(image: UploadFile = File(...), prompt: str = Form(...)) -> dict:
    if service is None:
        raise HTTPException(503, 'model not loaded')
    raw = await image.read()
    try:
        pil = Image.open(io.BytesIO(raw)).convert('RGB')
    except Exception as exc:
        raise HTTPException(400, f'invalid image: {exc}') from exc
    t0 = time.time()
    detections = service.detect(pil, prompt)
    dt_ms = (time.time() - t0) * 1000
    log.info(f'detect prompt="{prompt[:60]}" -> {len(detections)} boxes in {dt_ms:.1f} ms')
    return {'detections': detections}


def main() -> None:
    host = os.environ.get('DETECTOR_HOST', '0.0.0.0')
    port = int(os.environ.get('DETECTOR_PORT', '8001'))
    uvicorn.run(app, host=host, port=port)


if __name__ == '__main__':
    main()
