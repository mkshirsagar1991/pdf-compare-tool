import fitz
from typing import List, Dict


def extract_text_blocks(page: fitz.Page) -> List[Dict]:
    """
    Extract text blocks from a page with their bounding boxes.
    Returns list of blocks, each with 'text' and 'bbox' [x0, y0, x1, y1].
    Filters out whitespace-only blocks.
    """
    blocks = []
    raw = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)

    for block in raw.get("blocks", []):
        if block.get("type") != 0:   # 0 = text block
            continue
        lines_text = []
        for line in block.get("lines", []):
            line_text = "".join(span["text"] for span in line.get("spans", []))
            if line_text.strip():
                lines_text.append(line_text.rstrip())

        full_text = "\n".join(lines_text).strip()
        if not full_text:
            continue

        bbox = block["bbox"]
        blocks.append({
            "text":  full_text,
            "bbox":  list(bbox),      # [x0, y0, x1, y1] in PDF points
            "lines": lines_text,
        })

    return blocks
