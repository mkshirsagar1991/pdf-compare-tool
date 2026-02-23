/* ══════════════════════════════════════════════════════════
   DiffDoc — PDF Comparison Frontend
   ══════════════════════════════════════════════════════════ */
const API = 'http://localhost:8000';

// ── State ────────────────────────────────────────────────
let file1 = null,
    file2 = null;
let diffData = null;
let allChanges = []; // flat list of all change objects (with page ref)
let visibleChanges = []; // after filters applied
let currentIdx = -1;
let zoom = 1.0;
let syncingScroll = false;

// ── Boot ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Initialize with upload screen (hide all others)
    // CRITICAL: Only upload screen should be visible on page load
    showScreen('screen-upload');

    // Verify screen state
    console.log('[Init] Page loaded - Upload screen should be visible');

    // Initialize drop zones
    initDrop('dz1', 'fi1', 1);
    initDrop('dz2', 'fi2', 2);
    syncScrollSetup();
});

// ── Screen nav ───────────────────────────────────────────
// Manages screen transitions: upload → loading → results
// CRITICAL: Only ONE screen visible at any time
function showScreen(id) { // STEP 1: Force hide ALL screens (no exceptions)
    const allScreens = ['screen-upload', 'screen-loading', 'screen-results'];
    allScreens.forEach(screenId => {
        const screen = document.getElementById(screenId);
        if (screen) {
            screen.classList.remove('active');
            screen.style.display = 'none';
        }
    });

    // STEP 2: Show ONLY the requested screen
    const targetScreen = document.getElementById(id);
    if (! targetScreen) {
        console.error(`Screen not found: ${id}`);
        return;
    }

    targetScreen.style.display = id === 'screen-results' ? 'flex' : id === 'screen-loading' ? 'flex' : 'block';
    targetScreen.classList.add('active');

    // STEP 3: Hide detail panel when not on results screen
    const detailPanel = document.getElementById('detailDiffPanel');
    if (detailPanel && id !== 'screen-results') {
        detailPanel.style.display = 'none';
    }

    // Debug log (can be removed in production)
    console.log(`[Screen] Showing: ${id}, Hidden: ${
        allScreens.filter(s => s !== id).join(', ')
    }`);

    // Verify only one screen is visible
    verifyScreenState();
    if (detailPanel && id !== 'screen-results') {
        detailPanel.style.display = 'none';
    }
}

// Utility function to verify only one screen is visible
function verifyScreenState() {
    const visibleScreens = [];
    ['screen-upload', 'screen-loading', 'screen-results'].forEach(id => {
        const screen = document.getElementById(id);
        if (screen && screen.classList.contains('active')) {
            visibleScreens.push(id);
        }
    });

    if (visibleScreens.length !== 1) {
        console.error(`[Screen] ERROR: ${
            visibleScreens.length
        } screens visible (should be 1):`, visibleScreens);
    } else {
        console.log(`[Screen] ✓ Verified: Only ${
            visibleScreens[0]
        } is visible`);
    }
}


// ── Drop zones ───────────────────────────────────────────
function initDrop(dzId, inputId, num) {
    const dz = document.getElementById(dzId);
    const inp = document.getElementById(inputId);

    inp.addEventListener('change', e => pickFile(e.target.files[0], num));
    dz.addEventListener('dragover', e => {
        e.preventDefault();
        dz.classList.add('over');
    });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', e => {
        e.preventDefault();
        dz.classList.remove('over');
        const f = e.dataTransfer.files[0];
        if (f) 
            pickFile(f, num);
        


    });
}

function pickFile(file, num) {
    if (! file || ! file.name.toLowerCase().endsWith('.pdf')) {
        return showToast('Please select a PDF file');
    }
    if (file.size > 50 * 1024 * 1024) 
        return showToast('File exceeds 50 MB limit');
    


    if (num === 1) {
        file1 = file;
        renderFilled(file, 'dz1-empty', 'dz1-filled', 'fn1', 'fs1');
    } else {
        file2 = file;
        renderFilled(file, 'dz2-empty', 'dz2-filled', 'fn2', 'fs2');
    }
    document.getElementById('compareBtn').disabled = !(file1 && file2);
}

function renderFilled(file, emptyId, filledId, nameId, sizeId) {
    document.getElementById(emptyId).style.display = 'none';
    document.getElementById(filledId).style.display = 'flex';
    document.getElementById(nameId).textContent = file.name;
    document.getElementById(sizeId).textContent = fmtBytes(file.size);
}

function removeFile(num, e) {
    e.stopPropagation();
    if (num === 1) {
        file1 = null;
        document.getElementById('fi1').value = '';
        document.getElementById('dz1-empty').style.display = '';
        document.getElementById('dz1-filled').style.display = 'none';
    } else {
        file2 = null;
        document.getElementById('fi2').value = '';
        document.getElementById('dz2-empty').style.display = '';
        document.getElementById('dz2-filled').style.display = 'none';
    }
    document.getElementById('compareBtn').disabled = true;
}

function fmtBytes(b) {
    const u = [
            'B', 'KB', 'MB'
        ],
        i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), 2);
    return(b / Math.pow(1024, i)).toFixed(1) + ' ' + u[i];
}

// ── Compare ──────────────────────────────────────────────
async function startCompare() { // STEP 1: Show loading screen (hide upload screen)
    showScreen('screen-loading');
    animateLoading();

    try {
        const fd = new FormData();
        fd.append('file1', file1);
        fd.append('file2', file2);

        setLoadStep(2);
        const resp = await fetch(`${API}/compare`, {
            method: 'POST',
            body: fd
        });

        // Guard: check content-type before attempting JSON parse
        const contentType = resp.headers.get('content-type') || '';
        if (! contentType.includes('application/json')) {
            const text = await resp.text();
            console.error('Non-JSON response from server:', text);
            throw new Error(`Server returned unexpected content (${
                resp.status
            }). Check console for details.`);
        }

        const data = await resp.json();

        if (! resp.ok) {
            throw new Error(data.detail || `Server error ${
                resp.status
            }`);
        }

        setLoadStep(5);
        await sleep(400);

        console.log('API response:', data);

        if (! data || ! data.pages) {
            throw new Error(data ?. detail || data ?. message || 'Unexpected response from server. Check console for details.');
        }

        // Build summary from response if server doesn't provide one
        if (! data.summary) {
            let text_changes = 0,
                table_changes = 0,
                image_changes = 0;
            const changedPages = new Set();
            data.pages.forEach(pg => {
                pg.changes.forEach(ch => {
                    if (ch.type === 'text') 
                        text_changes++;
                     else if (ch.type === 'table') 
                        table_changes++;
                     else if (ch.type === 'image') 
                        image_changes++;
                    


                    if (ch.change !== 'same') 
                        changedPages.add(pg.page_num);
                    


                });
            });
            data.summary = {
                total_pages: data.total_pages || data.pages.length,
                pages_changed: changedPages.size,
                text_changes,
                table_changes,
                image_changes
            };
        }

        // Transform API response to expected format
        const transformedData = transformApiResponse(data);
        diffData = transformedData;

        // Build the results UI
        buildResults(transformedData);

        // STEP 2: Show results screen (hide loading screen)
        showScreen('screen-results');

    } catch (err) {
        console.error(err);
        // On error: Show upload screen again (hide loading screen)
        showScreen('screen-upload');
        showToast(err.message || 'Comparison failed. Please try again.');
    }
}


// ── Adapt API Response ───────────────────────────────
// Simple adapter for new API format that already has correct structure
function transformApiResponse(apiData) {
    // New API format already has pages with correct structure
    // Just need to ensure top-level fields are present
    return {
        total_pages: apiData.summary ? apiData.summary.total_pages : apiData.pages.length,
        file1_name: apiData.file1_name || 'Original',
        file2_name: apiData.file2_name || 'Modified',
        summary: apiData.summary,
        pages: apiData.pages
    };
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

let loadStep = 1;
function animateLoading() {
    loadStep = 1;
    setLoadStep(1);
    const steps = [2, 3, 4];
    let i = 0;
    const t = setInterval(() => {
        if (i >= steps.length) {
            clearInterval(t);
            return;
        }
        setLoadStep(steps[i++]);
    }, 1200);
}
function setLoadStep(n) {
    for (let i = 1; i <= 5; i++) {
        const el = document.getElementById(`ls${i}`);
        if (! el) 
            continue;
        


        el.classList.remove('active', 'done');
        if (i < n) 
            el.classList.add('done');
         else if (i === n) 
            el.classList.add('active');
        


    }
}

// ── Build Results ─────────────────────────────────────────
// Populates the results screen UI with comparison data
// NOTE: Does NOT manage screen visibility - caller must call showScreen('screen-results')
function buildResults(data) {
    if (! data ?. pages) {
        console.error('Invalid response structure:', data);
        showToast('Server returned an unexpected response.');
        showScreen('screen-upload');
        return;
    }
    const s = data.summary;

    // Labels
    document.getElementById('lbl1').textContent = data.file1_name || 'Original';
    document.getElementById('lbl2').textContent = data.file2_name || 'Modified';

    // Summary bar with legend
    document.getElementById('summaryBar').innerHTML = `
    ${
        scard('📄', 'Total Pages', s.total_pages, 'white')
    }
    ${
        scard('⚡', 'Pages Changed', s.pages_changed, 'yellow')
    }
    ${
        scard('🔤', 'Text Changes', s.text_changes, 'blue')
    }
    ${
        scard('📊', 'Table Changes', s.table_changes, 'blue')
    }
    ${
        scard('🖼', 'Image Changes', s.image_changes, 'blue')
    }
    ${
        scard('✅', 'Identical Pages', s.total_pages - s.pages_changed, 'green')
    }
    <div style="flex: 1;"></div>
    <div style="display: flex; gap: 12px; align-items: center; padding: 0 15px; font-size: 11px;">
        <span style="color: #999;">Legend:</span>
        <span style="display: flex; align-items: center; gap: 4px;">
            <span style="width: 12px; height: 12px; background: #C8E6C9; border: 1px solid #4CAF50; border-radius: 2px;"></span>
            <span style="color: #ccc;">Added</span>
        </span>
        <span style="display: flex; align-items: center; gap: 4px;">
            <span style="width: 12px; height: 12px; background: #FFCDD2; border: 1px solid #F44336; border-radius: 2px;"></span>
            <span style="color: #ccc;">Deleted</span>
        </span>
        <span style="display: flex; align-items: center; gap: 4px;">
            <span style="width: 12px; height: 12px; background: #FFF9C4; border: 1px solid #FBC02D; border-radius: 2px;"></span>
            <span style="color: #ccc;">Modified</span>
        </span>
    </div>
  `;

    // Collect all changes flat
    allChanges = [];
    data.pages.forEach(pg => {
        pg.changes.forEach(ch => {
            allChanges.push({
                ...ch,
                _page: pg.page_num,
                _pgData: pg
            });
        });
    });

    // Render pages
    renderPages(data.pages);
    applyFilters();
}

function scard(icon, label, val, color) {
    return `<div class="scard">
    <div class="scard-icon">${icon}</div>
    <div class="scard-info">
      <div class="scard-label">${label}</div>
      <div class="scard-val ${color}">${val}</div>
    </div>
  </div>`;
}

// ── Render Pages ──────────────────────────────────────────
function renderPages(pages) {
    const leftEl = document.getElementById('pagesLeft');
    const rightEl = document.getElementById('pagesRight');
    leftEl.innerHTML = '';
    rightEl.innerHTML = '';

    pages.forEach(pg => {
        const wPx = Math.min(pg.width, 700);

        const lWrap = makePageWrap(pg, pg.page1_b64, wPx, 'left');
        leftEl.appendChild(lWrap);

        const rWrap = makePageWrap(pg, pg.page2_b64, wPx, 'right');
        rightEl.appendChild(rWrap);
    });

    // Add page selector if multiple pages
    if (pages.length > 1) {
        renderPageSelector(pages);
    }
}

function renderPageSelector(pages) { // Create page selector bar (find or create container)
    let selector = document.getElementById('pageSelector');
    if (! selector) {
        selector = document.createElement('div');
        selector.id = 'pageSelector';
        selector.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0,0,0,0.8);
            padding: 10px 15px;
            border-radius: 25px;
            display: flex;
            gap: 8px;
            align-items: center;
            z-index: 1000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        `;
        document.body.appendChild(selector);
    }

    selector.innerHTML = '<span style="color: #888; font-size: 12px; margin-right: 5px;">Page:</span>';

    currentVisiblePage = 1; // Reset to page 1

    pages.forEach(pg => {
        const btn = document.createElement('button');
        btn.textContent = pg.page_num;
        const isActive = pg.page_num === 1;
        btn.style.cssText = `
            padding: 6px 12px;
            border: none;
            border-radius: 15px;
            background: ${
            isActive ? '#2ecc71' : (pg.has_changes ? '#4a90e2' : '#555')
        };
            color: white;
            cursor: pointer;
            font-size: 13px;
            transition: all 0.2s;
            transform: ${
            isActive ? 'scale(1.1)' : 'scale(1)'
        };
        `;
        btn.onclick = () => {
            jumpToPage(pg.page_num);
        };
        btn.onmouseover = () => {
            if (btn.style.background !== 'rgb(46, 204, 113)') { // not active
                btn.style.background = pg.has_changes ? '#5fa3ef' : '#666';
            }
        };
        btn.onmouseout = () => {
            if (btn.style.background !== 'rgb(46, 204, 113)') { // not active
                btn.style.background = pg.has_changes ? '#4a90e2' : '#555';
            }
        };
        selector.appendChild(btn);
    });
}

function makePageWrap(pg, b64, wPx, side) {
    const wrap = document.createElement('div');
    wrap.className = 'page-wrap';
    wrap.id = `pw-${side}-${
        pg.page_num
    }`;
    wrap.style.cssText = `
        width: ${wPx}px;
        position: relative;
        margin-bottom: 20px;
        background: white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    `;

    const img = document.createElement('img');
    img.src = 'data:image/png;base64,' + b64;
    img.style.cssText = 'width: 100%; display: block;';
    img.draggable = false;
    wrap.appendChild(img);

    const scaleX = wPx / pg.width;
    const scaleY = scaleX;

    pg.changes.forEach(ch => {
        const bbox = side === 'left' ? ch.old_bbox : ch.new_bbox;
        if (! bbox) 
            return;
        


        const hl = document.createElement('div');
        hl.className = `hl ${
            ch.change
        } ${
            ch.type === 'image' ? 'image' : ''
        }`;

        // Color based on change type
        let bgColor = 'rgba(255, 235, 59, 0.3)'; // yellow for modified
        let borderColor = '#FBC02D';
        if (ch.change === 'added') {
            bgColor = 'rgba(76, 175, 80, 0.3)'; // green
            borderColor = '#4CAF50';
        } else if (ch.change === 'deleted') {
            bgColor = 'rgba(244, 67, 54, 0.3)'; // red
            borderColor = '#F44336';
        }

        hl.style.cssText = `
            position: absolute;
            left: ${
            bbox.x * scaleX
        }px;
            top: ${
            bbox.y * scaleY
        }px;
            width: ${
            bbox.w * scaleX
        }px;
            height: ${
            bbox.h * scaleY
        }px;
            background: ${bgColor};
            border: 2px solid ${borderColor};
            cursor: pointer;
            transition: all 0.2s;
            pointer-events: auto;
            z-index: 10;
            overflow: visible;
        `;

        hl.dataset.id = ch.id;
        hl.title = tooltipText(ch);

        // ═══════════════════════════════════════════════════════
        // REVOLUTIONARY FEATURE: Inline Character-Level Highlighting
        // Shows character differences directly on the PDF like code diff
        // ALWAYS VISIBLE - No hover/click needed!
        // ═══════════════════════════════════════════════════════
        if (ch.type === 'text' && ch.word_diff && ch.word_diff.length > 0) {
            const textOverlay = document.createElement('div');
            textOverlay.className = 'text-diff-overlay';
            textOverlay.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                display: flex;
                align-items: center;
                flex-wrap: wrap;
                padding: 2px 4px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Arial', sans-serif;
                font-size: ${
                Math.max(9, Math.min(14, bbox.h * scaleY * 0.55))
            }px;
                line-height: 1.3;
                overflow: hidden;
                pointer-events: none;
                opacity: 1;
                transition: opacity 0.3s ease;
                background: rgba(255, 255, 255, 0.95);
                border-radius: 3px;
            `;

            // Build character-level highlighted text
            let htmlContent = '';
            ch.word_diff.forEach(word => {
                if (word.status === 'same') { // Unchanged text - light gray
                    htmlContent += `<span style="color: rgba(100,100,100,0.6); font-weight: 400; margin: 0 1px;">${
                        esc(word.text)
                    }</span> `;
                } else if (word.status === 'added') { // Added text - bright green background, white text
                    htmlContent += `<span style="background: #2E7D32; color: white; padding: 2px 4px; font-weight: 700; border-radius: 2px; margin: 0 1px; box-shadow: 0 1px 2px rgba(0,0,0,0.2); display: inline-block;">${
                        esc(word.text)
                    }</span> `;
                } else if (word.status === 'deleted') { // Deleted text - bright red background, white text, strikethrough
                    htmlContent += `<span style="background: #C62828; color: white; padding: 2px 4px; font-weight: 700; text-decoration: line-through; border-radius: 2px; margin: 0 1px; box-shadow: 0 1px 2px rgba(0,0,0,0.2); display: inline-block;">${
                        esc(word.text)
                    }</span> `;
                } else if (word.status === 'modified') { // Modified text - bright orange/yellow background, dark text
                    htmlContent += `<span style="background: #F57C00; color: white; padding: 2px 4px; font-weight: 700; border-radius: 2px; margin: 0 1px; box-shadow: 0 1px 2px rgba(0,0,0,0.2); display: inline-block;">${
                        esc(word.text)
                    }</span> `;
                }
            });

            textOverlay.innerHTML = htmlContent;
            hl.appendChild(textOverlay);
        }

        hl.addEventListener('mouseenter', () => {
            hl.style.background = bgColor.replace('0.3', '0.5');
            hl.style.transform = 'scale(1.02)';
            hl.style.zIndex = '20';
            // Overlay already visible - no need to show/hide
        });

        hl.addEventListener('mouseleave', () => {
            if (! hl.classList.contains('active')) {
                hl.style.background = bgColor;
                hl.style.transform = 'scale(1)';
                hl.style.zIndex = '10';
                // Overlay stays visible - no need to hide
            }
        });

        hl.addEventListener('click', (e) => {
            e.stopPropagation();
            selectChange(ch.id, true, true); // Show detail panel on direct click
        });

        wrap.appendChild(hl);
    });

    return wrap;
}

function tooltipText(ch) {
    const label = {
        added: 'Added',
        deleted: 'Deleted',
        modified: 'Modified'
    }[ch.change] || ch.change;
    const type = {
        text: 'Text',
        table: 'Table',
        image: 'Image'
    }[ch.type] || ch.type;
    if (ch.type === 'text') {
        if (ch.old_text && ch.new_text) 
            return `${label} ${type}: "${
             ch.old_text.slice(0, 40)
        }
        " → " $ {
            ch.new_text.slice(0, 40)
        }
        "`;

        return `${label} ${type}: "${
            (ch.old_text || ch.new_text).slice(0, 60)
        }"`;
    }
    return `${label} ${type}`;
}

// ── Filters ───────────────────────────────────────────────
function toggleFilters () {
    const s = document.getElementById('filterStrip');
    s.style.display = s.style.display === 'none' ? 'flex' : 'none';
}

function applyFilters () {
    const showText = document.getElementById('fText').checked;
    const showTable = document.getElementById('fTable').checked;
    const showImage = document.getElementById('fImage').checked;
    const showAdded = document.getElementById('fAdded').checked;
    const showDel = document.getElementById('fDeleted').checked;
    const showMod = document.getElementById('fModified').checked;

    visibleChanges = allChanges.filter(ch => {
        const typeOk = (ch.type === 'text' && showText) || (ch.type === 'table' && showTable) || (ch.type === 'image' && showImage);
        const changeOk = (ch.change === 'added' && showAdded) || (ch.change === 'deleted' && showDel) || (ch.change === 'modified' && showMod);
        return typeOk && changeOk;
    });

    document.querySelectorAll('.hl').forEach(el => {
        const ch = allChanges.find(c => c.id === el.dataset.id);
        if (! ch) 
            return;
        


        el.style.display = visibleChanges.includes(ch) ? '' : 'none';
    });

    buildChangePanel();
    updateNav();
}

// ── Change Panel ──────────────────────────────────────────
function buildChangePanel () {
    const list = document.getElementById('changeList');
    list.innerHTML = '';

    if (visibleChanges.length === 0) {
        list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:14px;">No changes match current filters</div>';
        return;
    }

    visibleChanges.forEach((ch, i) => {
        const el = document.createElement('div');
        el.className = 'ci';
        el.id = `ci-${
            ch.id
        }`;

        let previewHtml = '';
        if (ch.type === 'text') {
            if (ch.word_diff && ch.word_diff.length) { // Enhanced character-level diff with color coding
                let tokens = '';
                const wordsToShow = ch.word_diff.slice(0, 25); // Limit display

                wordsToShow.forEach(w => {
                    if (w.status === 'deleted') {
                        tokens += `<span style="background: #FFCDD2; color: #C62828; padding: 1px 3px; border-radius: 2px; text-decoration: line-through; font-size: 11px;">${
                            esc(w.text)
                        }</span> `;
                    } else if (w.status === 'added') {
                        tokens += `<span style="background: #C8E6C9; color: #2E7D32; padding: 1px 3px; border-radius: 2px; font-weight: 500; font-size: 11px;">${
                            esc(w.text)
                        }</span> `;
                    } else if (w.status === 'modified') {
                        tokens += `<span style="background: #FFF9C4; color: #F57F17; padding: 1px 3px; border-radius: 2px; font-weight: 500; font-size: 11px;">${
                            esc(w.text)
                        }</span> `;
                    } else {
                        tokens += `<span style="color: #666; font-size: 11px;">${
                            esc(w.text)
                        }</span> `;
                    }
                });

                if (ch.word_diff.length > 25) {
                    tokens += '<span style="color: #999; font-size: 11px;">...</span>';
                }

                previewHtml = `<div class="ci-text" style="line-height: 1.6; margin-top: 8px;">${tokens}</div>`;
            } else {
                const txt = (ch.old_text || ch.new_text || '').slice(0, 80);
                previewHtml = `<div class="ci-text">${
                    esc(txt)
                }</div>`;
            }
        } else if (ch.type === 'table') {
            const changed = (ch.cell_diffs || []).filter(c => c.change !== 'same').length;
            previewHtml = `<div class="ci-text" style="font-size: 11px; color: #666; margin-top: 5px;">${changed} cell${
                changed !== 1 ? 's' : ''
            } changed in table</div>`;
        } else if (ch.type === 'image') {
            previewHtml = `<div class="ci-text" style="font-size: 11px; color: #666; margin-top: 5px;">${
                ch.description || 'Image changed'
            }</div>`;
        }

        el.innerHTML = `
            <div class="ci-header">
                <span class="ci-badge ${
            ch.change
        }">${
            ch.change
        }</span>
                <span class="ci-type">${
            ch.type
        }</span>
                <span class="ci-page">Page ${
            ch._page
        }</span>
            </div>
            ${previewHtml}
        `;

        el.addEventListener('click', () => selectChange(ch.id, true, true)); // Show detail on click
        list.appendChild(el);
    });
}

// ── Navigation ────────────────────────────────────────────
function updateNav () {
    const n = visibleChanges.length;
    document.getElementById('navLabel').textContent = n === 0 ? 'No changes' : `${n} change${
        n !== 1 ? 's' : ''
    }`;
    document.getElementById('navPos').textContent = n > 0 && currentIdx >= 0 ? `${
        currentIdx + 1
    } / ${n}` : `— / ${n}`;
    document.getElementById('prevBtn').disabled = currentIdx <= 0;
    document.getElementById('nextBtn').disabled = currentIdx >= n - 1;
}

function prevDiff () {
    if (currentIdx > 0) 
        selectByIndex(currentIdx - 1);
    


}
function nextDiff () {
    if (currentIdx < visibleChanges.length - 1) 
        selectByIndex(currentIdx + 1);
    


}

function selectByIndex (i) {
    currentIdx = i;
    const ch = visibleChanges[i];
    if (ch) 
        selectChange(ch.id, false);
    


}

function selectChange (id, updateIdx = true, showDetail = false) {
    const ch = visibleChanges.find(c => c.id === id) || allChanges.find(c => c.id === id);
    if (! ch) 
        return;
    


    if (updateIdx) 
        currentIdx = visibleChanges.indexOf(ch);
    


    // Update highlights
    document.querySelectorAll('.hl').forEach(el => {
        el.classList.remove('active');
        const bgColor = el.classList.contains('added') ? 'rgba(76, 175, 80, 0.3)' : el.classList.contains('deleted') ? 'rgba(244, 67, 54, 0.3)' : 'rgba(255, 235, 59, 0.3)';
        el.style.background = bgColor;
        el.style.transform = 'scale(1)';
        el.style.zIndex = '10';

        // Overlay stays visible always - no need to hide
    });

    document.querySelectorAll(`[data-id="${id}"]`).forEach(el => {
        el.classList.add('active');
        const bgColor = el.classList.contains('added') ? 'rgba(76, 175, 80, 0.6)' : el.classList.contains('deleted') ? 'rgba(244, 67, 54, 0.6)' : 'rgba(255, 235, 59, 0.6)';
        el.style.background = bgColor;
        el.style.transform = 'scale(1.05)';
        el.style.zIndex = '30';

        // Overlay already visible - no need to show
    });

    // Update change list
    document.querySelectorAll('.ci').forEach(el => el.classList.remove('active'));
    const ci = document.getElementById(`ci-${id}`);
    if (ci) {
        ci.classList.add('active');
        ci.scrollIntoView({block: 'nearest', behavior: 'smooth'});
    }

    // Only show detailed diff panel if explicitly requested (direct click)
    if (showDetail) {
        showDetailedDiff(ch);
    }

    scrollToPage(ch._page, ch.old_bbox || ch.new_bbox);
    updateNav();
}

function showDetailedDiff (ch) {
    let panel = document.getElementById('detailDiffPanel');
    if (! panel) {
        panel = document.createElement('div');
        panel.id = 'detailDiffPanel';
        panel.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            width: 400px;
            max-height: 500px;
            background: white;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            z-index: 2000;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        `;
        document.body.appendChild(panel);
    }

    const changeTypeLabel = {
        'added': 'Added',
        'deleted': 'Deleted',
        'modified': 'Modified'
    }[ch.change] || ch.change;

    const typeLabel = {
        'text': 'Text',
        'table': 'Table',
        'image': 'Image'
    }[ch.type] || ch.type;

    let contentHtml = '';

    if (ch.type === 'text' && ch.word_diff && ch.word_diff.length > 0) { // Character-level diff display
        contentHtml = '<div style="padding: 15px; overflow-y: auto; max-height: 400px;">';
        contentHtml += '<div style="font-weight: 600; margin-bottom: 10px; color: #333;">Character-level Changes:</div>';

        // Render word diff with character highlighting
        contentHtml += '<div style="line-height: 1.8; font-family: monospace; font-size: 13px;">';
        ch.word_diff.forEach(word => {
            if (word.status === 'same') {
                contentHtml += `<span style="color: #666;">${
                    esc(word.text)
                } </span>`;
            } else if (word.status === 'added') {
                contentHtml += `<span style="background: #C8E6C9; color: #2E7D32; padding: 2px 4px; border-radius: 3px; font-weight: 600;">${
                    esc(word.text)
                }</span> `;
            } else if (word.status === 'deleted') {
                contentHtml += `<span style="background: #FFCDD2; color: #C62828; padding: 2px 4px; border-radius: 3px; text-decoration: line-through; font-weight: 600;">${
                    esc(word.text)
                }</span> `;
            } else if (word.status === 'modified') {
                contentHtml += `<span style="background: #FFF9C4; color: #F57F17; padding: 2px 4px; border-radius: 3px; font-weight: 600;">${
                    esc(word.text)
                }</span> `;
            }
        });
        contentHtml += '</div>';

        // Show full before/after
        if (ch.old_text || ch.new_text) {
            contentHtml += '<div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #eee;">';

            if (ch.old_text && ch.change !== 'added') {
                contentHtml += '<div style="margin-bottom: 10px;">';
                contentHtml += '<div style="font-size: 11px; color: #999; margin-bottom: 5px;">ORIGINAL:</div>';
                contentHtml += `<div style="padding: 8px; background: #FFEBEE; border-left: 3px solid #F44336; border-radius: 4px; font-size: 12px;">${
                    esc(ch.old_text)
                }</div>`;
                contentHtml += '</div>';
            }

            if (ch.new_text && ch.change !== 'deleted') {
                contentHtml += '<div>';
                contentHtml += '<div style="font-size: 11px; color: #999; margin-bottom: 5px;">MODIFIED:</div>';
                contentHtml += `<div style="padding: 8px; background: #E8F5E9; border-left: 3px solid #4CAF50; border-radius: 4px; font-size: 12px;">${
                    esc(ch.new_text)
                }</div>`;
                contentHtml += '</div>';
            }

            contentHtml += '</div>';
        }

        contentHtml += '</div>';
    } else if (ch.type === 'table') {
        contentHtml = '<div style="padding: 15px; overflow-y: auto; max-height: 400px;">';
        contentHtml += '<div style="font-weight: 600; margin-bottom: 10px;">Table Changes:</div>';
        if (ch.cell_diffs && ch.cell_diffs.length > 0) {
            contentHtml += '<div style="font-size: 13px;">';
            ch.cell_diffs.slice(0, 10).forEach(cell => {
                if (cell.change !== 'same') {
                    const changeLabel = cell.change === 'added' ? '➕' : cell.change === 'deleted' ? '➖' : '✏️';
                    contentHtml += `<div style="margin-bottom: 8px; padding: 8px; background: #f5f5f5; border-radius: 4px;">`;
                    contentHtml += `<div style="color: #666; font-size: 11px;">Row ${
                        cell.row + 1
                    }, Col ${
                        cell.col + 1
                    } ${changeLabel}</div>`;
                    if (cell.old) 
                        contentHtml += `<div style="color: #C62828; text-decoration: line-through;">${


                        


                        esc(cell.old)
                    } < /div>`;
                    
                    if (cell.new) 
                        contentHtml += `<div style="color: #2E7D32; font-weight: 600;">${
                            esc(cell.new)
                        }</div > `;
                    
                    contentHtml += ` < /div>`;
                }
            });
            if (ch.cell_diffs.length > 10) {
                contentHtml += `<div style="color: #999; font-size: 12px; margin-top: 10px;">... and ${
                    ch.cell_diffs.length - 10
                } more cells</div > `;
            }
            contentHtml += '</div>';
        }
        contentHtml += '</div>';
    } else {
        contentHtml = ` < div style = "padding: 15px;" > <div style="color: #666;">${
                        ch.description || 'Visual change detected'
                    }</div>
                </div>
                    `;
    } panel.innerHTML = ` < div style = "background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px; display: flex; justify-content: space-between; align-items: center;" > <div>
                        <div style="font-weight: 600; font-size: 16px;">${changeTypeLabel}
                            ${typeLabel}</div>
                        <div style="font-size: 12px; opacity: 0.9;">Page ${
                            ch._page
                        }</div>
                    </div>
                    <button id="closePanelBtn" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 30px; height: 30px; border-radius: 50%; cursor: pointer; font-size: 18px; font-weight: bold;">×</button>
                </div>
                $ {
                        contentHtml
                    }
                    `;

    panel.style.display = 'flex';

    // Add close button handler
    const closeBtn = document.getElementById('closePanelBtn');
    if (closeBtn) {
        closeBtn.onclick = () => {
            panel.style.display = 'none';
        };
    }
}

function scrollToPage(pageNum, bbox) {
    const vsLeft = document.getElementById('vsLeft');
    const vsRight = document.getElementById('vsRight');
    if (! vsLeft || ! vsRight) {
        console.error('Viewer containers not found');
        return;
    }

    const pw = document.getElementById(` pw - left - $ {
                        pageNum
                    }
                    `);
    if (! pw) {
        console.error(` Page wrap not found forpage $ {
                        pageNum
                }
                `);
        return;
    }

    // Calculate scroll position
    const pageTop = pw.offsetTop;
    let scrollPos = pageTop - 80;
    // Account for header

    // If we have a bbox, try to center it
    if (bbox && diffData && diffData.pages && diffData.pages[pageNum - 1]) {
        const pageData = diffData.pages[pageNum - 1];
        const scale = pw.offsetWidth / pageData.width;
        const bboxTopInPx = bbox.y * scale;
        scrollPos = pageTop + bboxTopInPx - 200; // Center vertically
    }

    // Disable sync temporarily to prevent flickering
    syncingScroll = true;
    vsLeft.scrollTop = scrollPos;
    vsRight.scrollTop = scrollPos;
    setTimeout(() => {
        syncingScroll = false;
    }, 100);
}

// Jump to specific page (for manual navigation)
function jumpToPage(pageNum) {
    if (! diffData || ! diffData.pages) {
        console.error('No diff data available');
        return;
    }

    if (pageNum < 1 || pageNum > diffData.pages.length) {
        console.error(` Invalid page number : $ {
                    pageNum
                }
                `);
        return;
    }

    scrollToPage(pageNum, null);

    // Update page selector if it exists
    updatePageSelectorState(pageNum);
}

function updatePageSelectorState(pageNum) {
    const selector = document.getElementById('pageSelector');
    if (! selector || ! diffData) 
        return;
    

    currentVisiblePage = pageNum;
    selector.querySelectorAll('button').forEach(btn => {
        const btnPageNum = parseInt(btn.textContent);
        if (btnPageNum === pageNum) {
            btn.style.background = '#2ecc71';
            btn.style.transform = 'scale(1.1)';
        } else {
            const pg = diffData.pages.find(p => p.page_num === btnPageNum);
            btn.style.background = pg && pg.has_changes ? '#4a90e2' : '#555';
            btn.style.transform = 'scale(1)';
        }
    });
}

// Keyboard navigation
document.addEventListener('keydown', (e) => {
    if (! diffData || ! diffData.pages) 
        return;
    

    // Get current visible page (approximate from scroll position)
    const vsLeft = document.getElementById('vsLeft');
    if (! vsLeft) 
        return;
    

    const currentScroll = vsLeft.scrollTop;
    let currentPage = 1;

    // Find which page is currently visible
    for (let i = 1; i <= diffData.pages.length; i++) {
        const pw = document.getElementById(` pw - left - $ {
                    i
                }
                `);
        if (pw && pw.offsetTop <= currentScroll + 100) {
            currentPage = i;
        }
    }

    // Page navigation with Page Up/Down or Ctrl+Up/Down
    if ((e.key === 'PageUp' || (e.ctrlKey && e.key === 'ArrowUp')) && currentPage > 1) {
        e.preventDefault();
        jumpToPage(currentPage - 1);
    } else if ((e.key === 'PageDown' || (e.ctrlKey && e.key === 'ArrowDown')) && currentPage < diffData.pages.length) {
        e.preventDefault();
        jumpToPage(currentPage + 1);
    }
    // Home/End for first/last page 
    else if (e.key === 'Home' && e.ctrlKey) {
        e.preventDefault();
        jumpToPage(1);
    } else if (e.key === 'End' && e.ctrlKey) {
        e.preventDefault();
        jumpToPage(diffData.pages.length);
    }
});

// ── Zoom ──────────────────────────────────────────────────
function zoomIn() {
    setZoom(Math.min(zoom + 0.25, 3));
}
function zoomOut() {
    setZoom(Math.max(zoom - 0.25, 0.5));
}

function setZoom(z) {
    zoom = z;
    document.getElementById('zoomLabel').textContent = Math.round(z * 100) + '%';
    document.querySelectorAll('.page-wrap').forEach(pw => {
        pw.style.transform = ` scale($ {
                    z
                })`;
        pw.style.transformOrigin = 'top left';
        pw.parentElement.style.height = (pw.offsetHeight * z) + 'px';
    });
}

// ── Scroll sync ───────────────────────────────────────────
let scrollRAF = null;
let currentVisiblePage = 1;

function updateCurrentPageIndicator() {
    const selector = document.getElementById('pageSelector');
    if (! selector || ! diffData) 
        return;
    

    const vsLeft = document.getElementById('vsLeft');
    if (! vsLeft) 
        return;
    

    const currentScroll = vsLeft.scrollTop;
    let newPage = 1;

    // Find which page is currently visible
    for (let i = 1; i <= diffData.pages.length; i++) {
        const pw = document.getElementById(` pw - left - $ {
                    i
                }
                `);
        if (pw && pw.offsetTop <= currentScroll + 100) {
            newPage = i;
        }
    }

    if (newPage !== currentVisiblePage) {
        updatePageSelectorState(newPage);
    }
}

function syncScrollSetup() {
    const L = document.getElementById('vsLeft');
    const R = document.getElementById('vsRight');
    if (! L || ! R) 
        return;
    

    L.addEventListener('scroll', () => {
        if (syncingScroll) 
            return;
        
        if (scrollRAF) 
            cancelAnimationFrame(scrollRAF);
        
        scrollRAF = requestAnimationFrame(() => {
            syncingScroll = true;
            R.scrollTop = L.scrollTop;
            updateCurrentPageIndicator();
            setTimeout(() => {
                syncingScroll = false;
            }, 10);
        });
    });

    R.addEventListener('scroll', () => {
        if (syncingScroll) 
            return;
        
        if (scrollRAF) 
            cancelAnimationFrame(scrollRAF);
        
        scrollRAF = requestAnimationFrame(() => {
            syncingScroll = true;
            L.scrollTop = R.scrollTop;
            updateCurrentPageIndicator();
            setTimeout(() => {
                syncingScroll = false;
            }, 10);
        });
    });
}

// ── Misc UI ───────────────────────────────────────────────
// Reset to upload screen for a new comparison
function newComparison() {
    diffData = null;
    allChanges = [];
    visibleChanges = [];
    currentIdx = -1;
    file1 = null;
    file2 = null;
    ['fi1', 'fi2'].forEach(id => {
        document.getElementById(id).value = '';
    });
    ['dz1-empty', 'dz2-empty'].forEach(id => {
        document.getElementById(id).style.display = '';
    });
    ['dz1-filled', 'dz2-filled'].forEach(id => {
        document.getElementById(id).style.display = 'none';
    });
    document.getElementById('compareBtn').disabled = true;
    document.getElementById('pagesLeft').innerHTML = '';
    document.getElementById('pagesRight').innerHTML = '';
    document.getElementById('changeList').innerHTML = '';

    // Remove page selector if exists
    const selector = document.getElementById('pageSelector');
    if (selector) 
        selector.remove();
    

    // Return to upload screen
    showScreen('screen-upload');
}

function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 4500);
}

function esc(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
