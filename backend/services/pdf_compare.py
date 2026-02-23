import base64
import logging
from pathlib import Path
from typing import Dict

import fitz

from .text_extractor  import extract_text_blocks
from .table_extractor import extract_tables
from .image_extractor import extract_images
from .diff_engine     import diff_text_blocks, diff_tables, diff_images

logger = logging.getLogger(__name__)
ZOOM = 2.0   # render at 2× for crisp highlights


class PDFComparer:

    # ── public ─────────────────────────────────────────────────────────────────

    def compare(self, pdf1_path: Path, pdf2_path: Path) -> Dict:
        doc1 = fitz.open(str(pdf1_path))
        doc2 = fitz.open(str(pdf2_path))

        pages1, pages2 = len(doc1), len(doc2)
        max_pages = max(pages1, pages2)

        pages_changed  = 0
        text_changes   = 0
        table_changes  = 0
        image_changes  = 0
        page_results   = []

        for i in range(max_pages):
            p1 = doc1[i] if i < pages1 else None
            p2 = doc2[i] if i < pages2 else None
            pr = self._compare_page(p1, p2, i + 1, doc1, doc2)
            page_results.append(pr)

            if pr["has_changes"]:
                pages_changed += 1
            for c in pr["changes"]:
                if   c["type"] == "text":  text_changes  += 1
                elif c["type"] == "table": table_changes += 1
                elif c["type"] == "image": image_changes += 1

        doc1.close()
        doc2.close()

        total = text_changes + table_changes + image_changes
        return {
            "summary": {
                "total_pages":   max_pages,
                "pages_changed": pages_changed,
                "text_changes":  text_changes,
                "table_changes": table_changes,
                "image_changes": image_changes,
                "total_changes": total,
            },
            "pages": page_results,
        }

    # ── private ────────────────────────────────────────────────────────────────

    def _render_b64(self, page: fitz.Page) -> tuple[str, int, int]:
        mat = fitz.Matrix(ZOOM, ZOOM)
        pix = page.get_pixmap(matrix=mat, colorspace=fitz.csRGB)
        data = base64.b64encode(pix.tobytes("png")).decode()
        return data, pix.width, pix.height

    def _blank_b64(self, w: int, h: int) -> str:
        """Blank white page of given pixel size."""
        from PIL import Image
        import io
        img = Image.new("RGB", (w, h), "white")
        buf = io.BytesIO()
        img.save(buf, "PNG")
        return base64.b64encode(buf.getvalue()).decode()

    def _compare_page(self, p1, p2, page_num: int, doc1, doc2) -> Dict:
        # ── render images ───────────────────────────────────────────────────────
        if p1:
            b1, pw, ph = self._render_b64(p1)
        else:
            b2_tmp, pw, ph = self._render_b64(p2)
            b1 = self._blank_b64(pw, ph)

        if p2:
            b2, pw2, ph2 = self._render_b64(p2)
            if not p1:
                pw, ph = pw2, ph2
        else:
            b2 = self._blank_b64(pw, ph)

        # ── extract content ─────────────────────────────────────────────────────
        tb1 = extract_text_blocks(p1)  if p1 else []
        tb2 = extract_text_blocks(p2)  if p2 else []
        tbl1 = extract_tables(p1)      if p1 else []
        tbl2 = extract_tables(p2)      if p2 else []
        img1 = extract_images(p1)      if p1 else []
        img2 = extract_images(p2)      if p2 else []

        # ── diff ────────────────────────────────────────────────────────────────
        changes = []

        # Page missing entirely
        if not p1:
            changes.append({"type": "text", "change": "added",
                             "old_text": "", "new_text": "(entire page added)",
                             "old_bbox": None, "new_bbox": None, "word_diff": []})
        elif not p2:
            changes.append({"type": "text", "change": "deleted",
                             "old_text": "(entire page deleted)", "new_text": "",
                             "old_bbox": None, "new_bbox": None, "word_diff": []})
        else:
            changes += diff_text_blocks(tb1, tb2, ZOOM)
            changes += diff_tables(tbl1, tbl2, ZOOM)
            changes += diff_images(img1, img2, ZOOM)

        # Assign sequential IDs
        for idx, c in enumerate(changes):
            c["id"] = f"p{page_num}c{idx}"

        return {
            "page_num":    page_num,
            "has_changes": len(changes) > 0,
            "width":       pw,
            "height":      ph,
            "page1_b64":   b1,
            "page2_b64":   b2,
            "changes":     changes,
        }
