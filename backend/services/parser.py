"""
File text extraction utilities.
Supports PDF (PyPDF2), DOCX (docx2txt), and plain TXT.
"""

import io
import logging
from fastapi import HTTPException

logger = logging.getLogger(__name__)


def extract_text(file_bytes: bytes, filename: str) -> str:
    fname = filename.lower()

    if fname.endswith(".pdf"):
        return _extract_pdf(file_bytes, filename)
    elif fname.endswith(".docx"):
        return _extract_docx(file_bytes, filename)
    elif fname.endswith(".txt") or fname.endswith(".md"):
        return file_bytes.decode("utf-8", errors="ignore").strip()
    else:
        # Try UTF-8 as fallback
        text = file_bytes.decode("utf-8", errors="ignore").strip()
        if text:
            return text
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {filename}. Please upload PDF, DOCX, or TXT."
        )


def _extract_pdf(file_bytes: bytes, filename: str) -> str:
    try:
        import PyPDF2
        reader = PyPDF2.PdfReader(io.BytesIO(file_bytes))
        pages = []
        for page in reader.pages:
            text = page.extract_text()
            if text:
                pages.append(text)
        result = "\n".join(pages).strip()
        if not result:
            raise HTTPException(status_code=400, detail="PDF appears to be empty or scanned (image-only). Please use a text-based PDF.")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"PDF extraction error for {filename}: {e}")
        raise HTTPException(status_code=400, detail=f"Could not read PDF: {str(e)}")


def _extract_docx(file_bytes: bytes, filename: str) -> str:
    try:
        import docx2txt
        text = docx2txt.process(io.BytesIO(file_bytes))
        if not text or not text.strip():
            raise HTTPException(status_code=400, detail="DOCX file appears to be empty.")
        return text.strip()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"DOCX extraction error for {filename}: {e}")
        raise HTTPException(status_code=400, detail=f"Could not read DOCX: {str(e)}")
