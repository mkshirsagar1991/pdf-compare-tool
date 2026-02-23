import fitz
from typing import List, Dict


def extract_tables(page: fitz.Page) -> List[Dict]:
    """
    Detect and extract tables from a PDF page using PyMuPDF's built-in finder.
    Returns list of tables with their cells and bounding boxes.
    """
    tables = []
    try:
        found = page.find_tables()
        for tab in found.tables:
            cells = []
            for row in tab.extract():
                row_cells = []
                for cell in row:
                    row_cells.append(cell if cell is not None else "")
                cells.append(row_cells)

            tables.append({
                "bbox":  list(tab.bbox),   # [x0, y0, x1, y1] in points
                "rows":  len(cells),
                "cols":  len(cells[0]) if cells else 0,
                "cells": cells,
            })
    except Exception:
        pass   # find_tables not available or no tables found
    return tables
