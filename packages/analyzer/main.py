import os

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

from dxf_parser import parse_dxf
from local_analyzer import analyze_image_locally, record_correction
from models import AnalyzeResponse
from psd_parser import parse_psd
from vision_analyzer import CropInfo, analyze_dxf_with_vision, analyze_psd_with_vision, autocrop_to_content, call_claude_vision, zones_to_sections

load_dotenv()

app = FastAPI(title="TICKIT Analyzer", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3001"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

MAX_FILE_BYTES = 50 * 1024 * 1024  # 50 MB
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}


def _api_key() -> str | None:
    return os.environ.get("ANTHROPIC_API_KEY") or None


@app.get("/health")
async def health():
    key = _api_key()
    return {
        "status": "ok",
        "vision": "enabled" if key else "disabled (set ANTHROPIC_API_KEY to enable)",
        "local_analyzer": "enabled",
    }


# ── PSD ───────────────────────────────────────────────────────────────────────

@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(
    file: UploadFile = File(...),
    svgWidth: int = Query(default=1200, ge=1),
    svgHeight: int = Query(default=800, ge=1),
):
    filename = file.filename or ""
    if not filename.lower().endswith(".psd"):
        raise HTTPException(status_code=400, detail="Only .psd files are accepted")
    content = await file.read()
    if len(content) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 50 MB)")
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    api_key = _api_key()
    try:
        result = analyze_psd_with_vision(content, svgWidth, svgHeight, api_key) if api_key \
            else parse_psd(content, svgWidth, svgHeight)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"PSD parse error: {exc}") from exc
    return result


# ── DXF / DWG ─────────────────────────────────────────────────────────────────

@app.post("/analyze-dxf", response_model=AnalyzeResponse)
async def analyze_dxf_endpoint(
    file: UploadFile = File(...),
    svgWidth: int = Query(default=1200, ge=1),
    svgHeight: int = Query(default=800, ge=1),
):
    filename = (file.filename or "").lower()
    if not (filename.endswith(".dxf") or filename.endswith(".dwg")):
        raise HTTPException(status_code=400, detail="Only .dxf and .dwg files are accepted")
    content = await file.read()
    if len(content) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 50 MB)")
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    api_key = _api_key()
    try:
        result = analyze_dxf_with_vision(content, svgWidth, svgHeight, api_key) if api_key \
            else parse_dxf(content, svgWidth, svgHeight)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"DXF parse error: {exc}") from exc
    return result


# ── Image (PNG / JPEG / WebP) ─────────────────────────────────────────────────

@app.post("/analyze-image", response_model=AnalyzeResponse)
async def analyze_image_endpoint(
    file: UploadFile = File(...),
    svgWidth: int = Query(default=1200, ge=1),
    svgHeight: int = Query(default=800, ge=1),
):
    """
    Accept a raster image (PNG/JPEG/WebP).
    - API key set → send directly to Claude vision (image is already rendered)
    - No API key → local K-means + rules pipeline
    """
    filename = (file.filename or "").lower()
    ext = "." + filename.rsplit(".", 1)[-1] if "." in filename else ""
    if ext not in IMAGE_EXTS:
        raise HTTPException(
            status_code=400,
            detail="Only .png, .jpg, .jpeg, .webp images are accepted"
        )
    content = await file.read()
    if len(content) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 50 MB)")
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")

    api_key = _api_key()
    try:
        if api_key:
            # Crop black borders; get back both cropped bytes AND the crop region in the original
            content, crop_info = autocrop_to_content(content)
            zones = call_claude_vision(content, api_key)
            # Map Claude's crop-relative percentages → original image pixels → SVG coords
            sections, warnings = zones_to_sections(zones, svgWidth, svgHeight, crop_info)
            result = {
                "sections": [s.model_dump() for s in sections],
                "psdWidth": svgWidth,
                "psdHeight": svgHeight,
                "warnings": warnings,
            }
        else:
            result = analyze_image_locally(content, svgWidth, svgHeight)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Image analysis error: {exc}") from exc

    return result


# ── Correction feedback (builds the dataset) ──────────────────────────────────

class CorrectionPayload(BaseModel):
    original_type: str
    corrected_type: str
    features: dict
    bbox: Optional[dict] = None


@app.post("/record-correction")
async def record_correction_endpoint(body: CorrectionPayload):
    """
    Called by Node.js when an organizer corrects a section type in MapEditor.
    Appends the correction to training_data.jsonl which train.py reads to
    retune venue_rules.json thresholds.
    """
    try:
        record_correction(
            original_type=body.original_type,
            corrected_type=body.corrected_type,
            features=body.features,
            bbox=body.bbox,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not record correction: {exc}") from exc
    return {"ok": True}
