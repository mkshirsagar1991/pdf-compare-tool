import fitz
import hashlib
from typing import List, Dict


def extract_images(page: fitz.Page) -> List[Dict]:
    """
    Extract embedded images from a PDF page with their positions and hashes.
    """
    images = []
    seen_xrefs = set()

    for img_info in page.get_images(full=True):
        xref = img_info[0]
        if xref in seen_xrefs:
            continue
        seen_xrefs.add(xref)

        # Get image bounding rect on the page
        rects = page.get_image_rects(xref)
        if not rects:
            continue

        bbox = list(rects[0])   # take the first occurrence rect

        # Get image bytes for hashing
        try:
            base_img = page.parent.extract_image(xref)
            img_bytes  = base_img.get("image", b"")
            img_hash   = hashlib.md5(img_bytes).hexdigest()
            img_ext    = base_img.get("ext", "png")
            img_width  = base_img.get("width",  0)
            img_height = base_img.get("height", 0)
        except Exception:
            img_hash   = str(xref)
            img_ext    = "unknown"
            img_width  = img_height = 0

        images.append({
            "xref":   xref,
            "hash":   img_hash,
            "bbox":   bbox,
            "width":  img_width,
            "height": img_height,
            "ext":    img_ext,
        })

    return images
