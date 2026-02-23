import sys, os
_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _dir)
os.environ["PYTHONPATH"] = _dir + os.pathsep + os.environ.get("PYTHONPATH", "")

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
import uvicorn, logging, uuid
from pathlib import Path

from services.pdf_compare import PDFComparer

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="PDF Diff Pro", version="2.0.0")

app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])

UPLOAD_DIR = Path(_dir) / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
MAX_MB = 50

# Mount frontend folder
app.mount("/static", StaticFiles(directory="../frontend"), name="static")

@app.get("/")
def serve_frontend():
    return FileResponse("../frontend/index.html")
    
# @app.get("/")
def root():
    return {"status": "ok", "version": "2.0.0"}


@app.post("/compare")
async def compare(
    file1: UploadFile = File(...),
    file2: UploadFile = File(...),
):
    # ── validate ────────────────────────────────────────────────────────────────
    for f, name in [(file1, "file1"), (file2, "file2")]:
        if not f.filename.lower().endswith(".pdf"):
            raise HTTPException(400, f"{name} must be a PDF")

    uid = uuid.uuid4().hex
    p1 = UPLOAD_DIR / f"{uid}_1.pdf"
    p2 = UPLOAD_DIR / f"{uid}_2.pdf"

    try:
        content1 = await file1.read()
        content2 = await file2.read()

        if len(content1) > MAX_MB * 1024 * 1024:
            raise HTTPException(400, "file1 exceeds 50 MB limit")
        if len(content2) > MAX_MB * 1024 * 1024:
            raise HTTPException(400, "file2 exceeds 50 MB limit")

        # Check for password protection / corruption
        _validate_pdf(content1, "file1")
        _validate_pdf(content2, "file2")

        p1.write_bytes(content1)
        p2.write_bytes(content2)

        logger.info(f"Comparing {file1.filename} ({len(content1)//1024}KB) "
                    f"vs {file2.filename} ({len(content2)//1024}KB)")

        result = PDFComparer().compare(p1, p2)
        result["file1_name"] = file1.filename
        result["file2_name"] = file2.filename
        return JSONResponse(result)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Comparison error: {e}", exc_info=True)
        raise HTTPException(500, f"Comparison failed: {e}")
    finally:
        if p1.exists(): p1.unlink()
        if p2.exists(): p2.unlink()


def _validate_pdf(data: bytes, name: str):
    import fitz
    try:
        doc = fitz.open(stream=data, filetype="pdf")
        if doc.needs_pass:
            raise HTTPException(400, f"{name} is password-protected")
        doc.close()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(400, f"{name} appears to be corrupted or invalid")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
