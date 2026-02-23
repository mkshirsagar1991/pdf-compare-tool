import difflib
import hashlib
from typing import List, Dict, Optional


# ── helpers ────────────────────────────────────────────────────────────────────

def _bbox_px(bbox, zoom: float) -> Dict:
    """Convert [x0,y0,x1,y1] PDF-point bbox → pixel dict for the frontend."""
    x0, y0, x1, y1 = bbox
    return {"x": round(x0 * zoom), "y": round(y0 * zoom),
            "w": round((x1 - x0) * zoom), "h": round((y1 - y0) * zoom)}


def _norm(text: str) -> str:
    return " ".join(text.split()).lower()


# ── text diff ──────────────────────────────────────────────────────────────────

def diff_text_blocks(blocks1: List[Dict], blocks2: List[Dict],
                     zoom: float) -> List[Dict]:
    changes = []
    texts1 = [_norm(b["text"]) for b in blocks1]
    texts2 = [_norm(b["text"]) for b in blocks2]

    sm = difflib.SequenceMatcher(None, texts1, texts2, autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue

        if tag in ("replace", "delete", "insert"):
            old_blocks = blocks1[i1:i2]
            new_blocks = blocks2[j1:j2]
            n = max(len(old_blocks), len(new_blocks))

            for k in range(n):
                b1 = old_blocks[k] if k < len(old_blocks) else None
                b2 = new_blocks[k] if k < len(new_blocks) else None

                if b1 and b2:
                    change_type = "modified"
                elif b1:
                    change_type = "deleted"
                else:
                    change_type = "added"

                # Word-level highlight inside the block
                old_t = b1["text"] if b1 else ""
                new_t = b2["text"] if b2 else ""
                word_diff = _word_diff(old_t, new_t)

                changes.append({
                    "type":      "text",
                    "change":    change_type,
                    "old_text":  old_t,
                    "new_text":  new_t,
                    "word_diff": word_diff,
                    "old_bbox":  _bbox_px(b1["bbox"], zoom) if b1 else None,
                    "new_bbox":  _bbox_px(b2["bbox"], zoom) if b2 else None,
                })

    return changes


def _word_diff(old: str, new: str) -> List[Dict]:
    """Return word-level diff tokens for inline display."""
    words1 = old.split()
    words2 = new.split()
    result = []
    sm = difflib.SequenceMatcher(None, words1, words2, autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            result.append({"text": " ".join(words1[i1:i2]), "status": "same"})
        elif tag == "replace":
            result.append({"text": " ".join(words1[i1:i2]), "status": "deleted"})
            result.append({"text": " ".join(words2[j1:j2]), "status": "added"})
        elif tag == "delete":
            result.append({"text": " ".join(words1[i1:i2]), "status": "deleted"})
        elif tag == "insert":
            result.append({"text": " ".join(words2[j1:j2]), "status": "added"})
    return result


# ── table diff ─────────────────────────────────────────────────────────────────

def diff_tables(tables1: List[Dict], tables2: List[Dict],
                zoom: float) -> List[Dict]:
    changes = []
    used2 = set()

    for t1 in tables1:
        # Match by position (nearest table in t2)
        best = _best_table_match(t1, tables2, used2)

        if best is None:
            changes.append({
                "type": "table", "change": "deleted",
                "old_bbox": _bbox_px(t1["bbox"], zoom), "new_bbox": None,
                "old_cells": t1["cells"], "new_cells": None,
                "cell_diffs": [],
            })
        else:
            used2.add(best["idx"])
            t2 = best["table"]
            cell_diffs = _diff_cells(t1["cells"], t2["cells"])
            if any(cd["change"] != "same" for cd in cell_diffs):
                changes.append({
                    "type": "table", "change": "modified",
                    "old_bbox": _bbox_px(t1["bbox"], zoom),
                    "new_bbox": _bbox_px(t2["bbox"], zoom),
                    "old_cells": t1["cells"], "new_cells": t2["cells"],
                    "cell_diffs": cell_diffs,
                })

    for i, t2 in enumerate(tables2):
        if i not in used2:
            changes.append({
                "type": "table", "change": "added",
                "old_bbox": None, "new_bbox": _bbox_px(t2["bbox"], zoom),
                "old_cells": None, "new_cells": t2["cells"],
                "cell_diffs": [],
            })

    return changes


def _best_table_match(t1, tables2, used2):
    best_score, best_idx, best_t2 = float("inf"), None, None
    cx1 = (t1["bbox"][0] + t1["bbox"][2]) / 2
    cy1 = (t1["bbox"][1] + t1["bbox"][3]) / 2
    for i, t2 in enumerate(tables2):
        if i in used2:
            continue
        cx2 = (t2["bbox"][0] + t2["bbox"][2]) / 2
        cy2 = (t2["bbox"][1] + t2["bbox"][3]) / 2
        dist = abs(cx1 - cx2) + abs(cy1 - cy2)
        if dist < best_score:
            best_score, best_idx, best_t2 = dist, i, t2
    if best_idx is None or best_score > 200:   # 200 points away = different table
        return None
    return {"idx": best_idx, "table": best_t2}


def _diff_cells(cells1, cells2) -> List[Dict]:
    diffs = []
    rows = max(len(cells1), len(cells2))
    for r in range(rows):
        r1 = cells1[r] if r < len(cells1) else []
        r2 = cells2[r] if r < len(cells2) else []
        cols = max(len(r1), len(r2))
        for c in range(cols):
            v1 = str(r1[c]) if c < len(r1) else ""
            v2 = str(r2[c]) if c < len(r2) else ""
            if v1 == v2:
                status = "same"
            elif not v1:
                status = "added"
            elif not v2:
                status = "deleted"
            else:
                status = "modified"
            diffs.append({"row": r, "col": c, "old": v1, "new": v2,
                           "change": status})
    return diffs


# ── image diff ─────────────────────────────────────────────────────────────────

def diff_images(images1: List[Dict], images2: List[Dict],
                zoom: float) -> List[Dict]:
    changes = []
    used2 = set()

    for img1 in images1:
        match = _best_image_match(img1, images2, used2)
        if match is None:
            changes.append({
                "type": "image", "change": "deleted",
                "old_bbox": _bbox_px(img1["bbox"], zoom), "new_bbox": None,
                "description": "Image removed",
            })
        else:
            used2.add(match["idx"])
            img2 = match["image"]
            if img1["hash"] != img2["hash"]:
                changes.append({
                    "type": "image", "change": "modified",
                    "old_bbox": _bbox_px(img1["bbox"], zoom),
                    "new_bbox": _bbox_px(img2["bbox"], zoom),
                    "description": "Image replaced",
                })

    for i, img2 in enumerate(images2):
        if i not in used2:
            changes.append({
                "type": "image", "change": "added",
                "old_bbox": None, "new_bbox": _bbox_px(img2["bbox"], zoom),
                "description": "Image added",
            })

    return changes


def _best_image_match(img1, images2, used2):
    cx1 = (img1["bbox"][0] + img1["bbox"][2]) / 2
    cy1 = (img1["bbox"][1] + img1["bbox"][3]) / 2
    best_score, best_idx, best_img = float("inf"), None, None
    for i, img2 in enumerate(images2):
        if i in used2:
            continue
        cx2 = (img2["bbox"][0] + img2["bbox"][2]) / 2
        cy2 = (img2["bbox"][1] + img2["bbox"][3]) / 2
        dist = abs(cx1 - cx2) + abs(cy1 - cy2)
        if dist < best_score:
            best_score, best_idx, best_img = dist, i, img2
    if best_idx is None or best_score > 150:
        return None
    return {"idx": best_idx, "image": best_img}
