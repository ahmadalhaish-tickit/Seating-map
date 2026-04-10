from pydantic import BaseModel
from typing import Dict, List, Optional


class SectionResult(BaseModel):
    name: str
    label: str                        # max 6 chars
    sectionType: str                  # RESERVED | GA | STAGE | BAR | etc.
    polygonPath: str                  # "M x y L x y ... Z"
    rows: List = []                   # always empty from analyzer; seats generated server-side on import
    sourceLayerName: str
    confidence: float                 # 0.0–1.0
    estimatedSeats: int = 0           # shown in preview modal only
    bbox: Optional[Dict[str, float]] = None  # {top, left, bottom, right} in SVG coords — used by Node import
    tableChairs: Optional[int] = None  # TABLE only: number of chairs around the table


class AnalyzeResponse(BaseModel):
    sections: List[SectionResult]
    psdWidth: int
    psdHeight: int
    warnings: List[str]
