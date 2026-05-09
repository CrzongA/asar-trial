"""HTTP clients for the open-vocabulary detector and the Qwen3-VL backend.

Both servers run on the MI300X (`vlm-host` over Tailscale). The detector
(GroundingDINO or YOLO-World) listens on DETECTOR_URL; the VLM (Qwen3-VL via
vLLM) speaks an OpenAI-compatible REST API at VLM_BASE_URL.

Environment:
  VLM_BASE_URL       default http://vlm-host:8000
  VLM_MODEL          default Qwen/Qwen3-VL-235B-A22B-Instruct-FP8
  DETECTOR_URL       default http://vlm-host:8001
  PERCEPTION_TIMEOUT default 5.0  (seconds)

JPEG-compress every frame before sending; raw RGB at 720p is ~3 MB per frame
which saturates a residential VPN tunnel.
"""

from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass

import cv2
import httpx
import numpy as np


@dataclass
class Detection:
    label: str
    bbox: tuple[float, float, float, float]  # x, y, w, h in image pixels
    confidence: float


@dataclass
class TargetAssessment:
    found: bool
    health: str
    terrain: str
    distance_to_safety_m: float
    confidence: float
    rationale: str


def _encode_jpeg(image_bgr: np.ndarray, quality: int = 80) -> bytes:
    ok, buf = cv2.imencode('.jpg', image_bgr, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        raise RuntimeError('cv2.imencode failed')
    return buf.tobytes()


def _b64_data_url(jpeg: bytes) -> str:
    return f'data:image/jpeg;base64,{base64.b64encode(jpeg).decode("ascii")}'


class PerceptionClient:
    def __init__(
        self,
        *,
        vlm_base_url: str | None = None,
        vlm_model: str | None = None,
        detector_url: str | None = None,
        timeout: float | None = None,
    ) -> None:
        self.vlm_base_url = vlm_base_url or os.environ.get('VLM_BASE_URL', 'http://vlm-host:8000')
        self.vlm_model = vlm_model or os.environ.get('VLM_MODEL', 'Qwen/Qwen2.5-VL-72B-Instruct')
        self.detector_url = detector_url or os.environ.get('DETECTOR_URL', 'http://vlm-host:8001')
        self.timeout = float(timeout if timeout is not None else os.environ.get('PERCEPTION_TIMEOUT', '5.0'))
        self._client = httpx.Client(timeout=self.timeout)

    def close(self) -> None:
        self._client.close()

    # ---- Stage 1: open-vocabulary detector --------------------------------
    def detect(self, image_bgr: np.ndarray, prompt: str) -> list[Detection]:
        """Run the detector against `image_bgr` with a free-form text prompt.

        Expected response JSON: {"detections": [{"label": str, "bbox": [x,y,w,h], "confidence": float}, ...]}
        """
        jpeg = _encode_jpeg(image_bgr)
        files = {'image': ('frame.jpg', jpeg, 'image/jpeg')}
        data = {'prompt': prompt}
        resp = self._client.post(f'{self.detector_url}/detect', files=files, data=data)
        resp.raise_for_status()
        payload = resp.json()
        out: list[Detection] = []
        for d in payload.get('detections', []):
            bbox = d.get('bbox') or [0, 0, 0, 0]
            out.append(Detection(
                label=str(d.get('label', '')),
                bbox=(float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3])),
                confidence=float(d.get('confidence', 0.0)),
            ))
        return out

    # ---- Stage 2: VLM confirmation + status ------------------------------
    def assess_target(
        self,
        image_bgr: np.ndarray,
        target_description: str,
        bbox_hint: tuple[float, float, float, float] | None = None,
    ) -> TargetAssessment:
        """Ask the VLM to confirm the target and produce a structured status.

        Uses the OpenAI-compatible chat completions endpoint exposed by vLLM.
        """
        jpeg = _encode_jpeg(image_bgr)
        data_url = _b64_data_url(jpeg)

        bbox_clause = (
            f' A candidate bounding box was found at [x={bbox_hint[0]:.0f}, y={bbox_hint[1]:.0f}, '
            f'w={bbox_hint[2]:.0f}, h={bbox_hint[3]:.0f}].' if bbox_hint else ''
        )

        system = (
            'You are an aerial search-and-rescue analyst. You will be shown a frame from a '
            'drone gimbal camera and asked to confirm whether a described target is visible. '
            'Respond ONLY with compact JSON conforming to this schema: '
            '{"found": bool, "health": "responsive|injured|unconscious|unknown", '
            '"terrain": "forest|water|road|rubble|open|unknown", '
            '"distance_to_safety_m": float, "confidence": float, "rationale": str}'
        )
        user_text = (
            f'The briefed target is: "{target_description}".{bbox_clause} '
            'Confirm whether the target is in the frame and produce the JSON status.'
        )

        body = {
            'model': self.vlm_model,
            'messages': [
                {'role': 'system', 'content': system},
                {'role': 'user', 'content': [
                    {'type': 'text', 'text': user_text},
                    {'type': 'image_url', 'image_url': {'url': data_url}},
                ]},
            ],
            'temperature': 0.0,
            'max_tokens': 256,
            'response_format': {'type': 'json_object'},
        }

        resp = self._client.post(f'{self.vlm_base_url}/v1/chat/completions', json=body)
        resp.raise_for_status()
        msg = resp.json()['choices'][0]['message']['content']
        return self._parse_assessment(msg)

    # ---- Briefing helper: derive target description from a clue image ----
    def describe_clue_image(self, image_bgr: np.ndarray) -> str:
        jpeg = _encode_jpeg(image_bgr)
        data_url = _b64_data_url(jpeg)
        body = {
            'model': self.vlm_model,
            'messages': [
                {'role': 'system', 'content': (
                    'You are aiding a search-and-rescue mission briefing. Describe the subject '
                    'of the provided image in one short sentence suitable for an open-vocabulary '
                    'object detector prompt (e.g. "person wearing a red jacket").'
                )},
                {'role': 'user', 'content': [
                    {'type': 'text', 'text': 'Describe the subject:'},
                    {'type': 'image_url', 'image_url': {'url': data_url}},
                ]},
            ],
            'temperature': 0.0,
            'max_tokens': 40,
        }
        resp = self._client.post(f'{self.vlm_base_url}/v1/chat/completions', json=body)
        resp.raise_for_status()
        return resp.json()['choices'][0]['message']['content'].strip()

    # ---- Parsing ---------------------------------------------------------
    @staticmethod
    def _parse_assessment(raw: str) -> TargetAssessment:
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            start = raw.find('{')
            end = raw.rfind('}')
            if start == -1 or end == -1:
                raise
            payload = json.loads(raw[start:end + 1])
        return TargetAssessment(
            found=bool(payload.get('found', False)),
            health=str(payload.get('health', 'unknown')),
            terrain=str(payload.get('terrain', 'unknown')),
            distance_to_safety_m=float(payload.get('distance_to_safety_m', 0.0)),
            confidence=float(payload.get('confidence', 0.0)),
            rationale=str(payload.get('rationale', '')),
        )
