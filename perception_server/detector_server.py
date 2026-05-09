"""GroundingDINO detector server (port 8001) with tiling and spatial masking.

Exposes a single endpoint matching the contract that
sar_agent.perception_client.PerceptionClient.detect() expects.

Environment:
    DETECTOR_HOST         default 0.0.0.0
    DETECTOR_PORT         default 8001
    DETECTOR_MODEL_ID     default IDEA-Research/grounding-dino-base
    DETECTOR_DEVICE       default auto
    DETECTOR_BOX_THRESH   default 0.35
    DETECTOR_TEXT_THRESH  default 0.25
    DETECTOR_TILING       default true
    DETECTOR_TILE_SIZE    default 800
    DETECTOR_TILE_OVERLAP default 200
    DETECTOR_DISTRACTORS  default "drone landing gear . drone frame . propellers"
    DETECTOR_MASK_REGIONS default "" (format: "y1,x1,y2,x2;y1,x1,y2,x2" in 0-1 range)
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
from PIL import Image, ImageDraw
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
        self.model_id = os.environ.get('DETECTOR_MODEL_ID', 'IDEA-Research/grounding-dino-base')
        self.device = _resolve_device()
        self.box_threshold = float(os.environ.get('DETECTOR_BOX_THRESH', '0.35'))
        self.text_threshold = float(os.environ.get('DETECTOR_TEXT_THRESH', '0.25'))
        
        self.use_tiling = os.environ.get('DETECTOR_TILING', 'true').lower() == 'true'
        self.tile_size = int(os.environ.get('DETECTOR_TILE_SIZE', '800'))
        self.tile_overlap = int(os.environ.get('DETECTOR_TILE_OVERLAP', '200'))
        
        self.distractors = os.environ.get(
            'DETECTOR_DISTRACTORS', 
            'drone landing gear . drone frame . propellers'
        ).strip()
        
        # Parse mask regions: "y1,x1,y2,x2;..."
        self.mask_regions = []
        mask_str = os.environ.get('DETECTOR_MASK_REGIONS', '').strip()
        if mask_str:
            try:
                for region in mask_str.split(';'):
                    self.mask_regions.append([float(v) for v in region.split(',')])
                log.info(f'Parsed {len(self.mask_regions)} mask regions.')
            except Exception as e:
                log.error(f'Failed to parse DETECTOR_MASK_REGIONS "{mask_str}": {e}')

        log.info(f'Loading {self.model_id} on {self.device}...')
        self.processor = AutoProcessor.from_pretrained(self.model_id)
        self.model = AutoModelForZeroShotObjectDetection.from_pretrained(self.model_id).to(self.device)
        self.model.eval()
        log.info(f'Detector ready (Tiling={self.use_tiling}, Masks={len(self.mask_regions)}).')

    def _apply_masks(self, image: Image.Image) -> Image.Image:
        """Draw black rectangles over masked regions to ignore drone parts."""
        if not self.mask_regions:
            return image
            
        # Work on a copy to avoid side effects
        draw_img = image.copy()
        draw = ImageDraw.Draw(draw_img)
        w, h = image.size
        
        for y1, x1, y2, x2 in self.mask_regions:
            # Convert normalized 0-1 coordinates to pixels
            shape = [x1 * w, y1 * h, x2 * w, y2 * h]
            draw.rectangle(shape, fill=(0, 0, 0))
            
        return draw_img

    def _run_grounding_dino(self, image: Image.Image, prompt: str) -> list[dict]:
        clean_prompt = prompt.strip().rstrip('.')
        text = f"{clean_prompt} . {self.distractors} ."
            
        inputs = self.processor(images=image, text=text, return_tensors='pt').to(self.device)
        with torch.no_grad():
            outputs = self.model(**inputs)
            
        target_sizes = torch.tensor([image.size[::-1]], device=self.device)
        results = self.processor.post_process_grounded_object_detection(
            outputs,
            inputs.input_ids,
            threshold=self.box_threshold,
            text_threshold=self.text_threshold,
            target_sizes=target_sizes,
        )[0]
        
        out = []
        for box, score, label in zip(results['boxes'], results['scores'], results['labels']):
            label_str = str(label) if label else clean_prompt
            if any(d.strip() in label_str.lower() for d in self.distractors.split('.')):
                continue
            
            x1, y1, x2, y2 = box.tolist()
            out.append({
                'label': label_str,
                'bbox': [float(x1), float(y1), float(x2 - x1), float(y2 - y1)],
                'confidence': float(score),
            })
        return out

    def detect(self, image: Image.Image, prompt: str) -> list[dict]:
        # Apply spatial masking first to ignore landing gear
        masked_image = self._apply_masks(image)
        
        if not self.use_tiling:
            return self._run_grounding_dino(masked_image, prompt)

        w, h = masked_image.size
        stride = self.tile_size - self.tile_overlap
        
        all_detections = []
        
        for y0 in range(0, h, stride):
            for x0 in range(0, w, stride):
                x1 = min(x0 + self.tile_size, w)
                y1 = min(y0 + self.tile_size, h)
                
                tile = masked_image.crop((x0, y0, x1, y1))
                tile_detections = self._run_grounding_dino(tile, prompt)
                
                for d in tile_detections:
                    tx, ty, tw, th = d['bbox']
                    all_detections.append({
                        'label': d['label'],
                        'bbox': [tx + x0, ty + y0, tw, th],
                        'confidence': d['confidence']
                    })
                
                if x1 == w: break
            if y1 == h: break
            
        return self._nms(all_detections, iou_threshold=0.5)

    def _nms(self, detections: list[dict], iou_threshold: float) -> list[dict]:
        if not detections:
            return []
            
        boxes = torch.tensor([d['bbox'] for d in detections])
        boxes[:, 2] += boxes[:, 0]
        boxes[:, 3] += boxes[:, 1]
        
        scores = torch.tensor([d['confidence'] for d in detections])
        
        keep_indices = self._torch_nms(boxes, scores, iou_threshold)
        return [detections[i] for i in keep_indices]

    @staticmethod
    def _torch_nms(boxes: torch.Tensor, scores: torch.Tensor, iou_threshold: float) -> list[int]:
        x1 = boxes[:, 0]
        y1 = boxes[:, 1]
        x2 = boxes[:, 2]
        y2 = boxes[:, 3]
        areas = (x2 - x1) * (y2 - y1)
        
        _, order = scores.sort(0, descending=True)
        keep = []
        
        while order.numel() > 0:
            if order.numel() == 1:
                keep.append(order.item())
                break
            i = order[0].item()
            keep.append(i)
            
            xx1 = x1[order[1:]].clamp(min=x1[i])
            yy1 = y1[order[1:]].clamp(min=y1[i])
            xx2 = x2[order[1:]].clamp(max=x2[i])
            yy2 = y2[order[1:]].clamp(max=y2[i])
            
            w = (xx2 - xx1).clamp(min=0)
            h = (yy2 - yy1).clamp(min=0)
            inter = w * h
            
            ovr = inter / (areas[i] + areas[order[1:]] - inter)
            ids = (ovr <= iou_threshold).nonzero().squeeze()
            if ids.numel() == 0:
                break
            order = order[ids + 1]
            
        return keep


service: DetectorService | None = None
app = FastAPI(title='ASAR Detector (GroundingDINO)', version='0.5.0')


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
        'distractors': service.distractors,
        'masks': len(service.mask_regions)
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
