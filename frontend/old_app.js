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
    initDrop('dz1', 'fi1', 1);
    initDrop('dz2', 'fi2', 2);
    syncScrollSetup();
});

// ── Screen nav ───────────────────────────────────────────
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => {
        s.classList.remove('active');
        s.style.display = 'none';
    });
    const el = document.getElementById(id);
    el.style.display = id === 'screen-results' ? 'flex' : id === 'screen-loading' ? 'flex' : 'block';
    el.classList.add('active');
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
async function startCompare() {
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
        buildResults(transformedData);
        showScreen('screen-results');

    } catch (err) {
        console.error(err);
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

    // Summary bar
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
}

function makePageWrap(pg, b64, wPx, side) {
    const wrap = document.createElement('div');
    wrap.className = 'page-wrap';
    wrap.id = `pw-${side}-${
        pg.page_num
    }`;
    wrap.style.width = wPx + 'px';

    const img = document.createElement('img');
    img.src = 'data:image/png;base64,' + b64;
    img.style.width = '100%';
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
        hl.style.left = (bbox.x * scaleX) + 'px';
        hl.style.top = (bbox.y * scaleY) + 'px';
        hl.style.width = (bbox.w * scaleX) + 'px';
        hl.style.height = (bbox.h * scaleY) + 'px';
        hl.dataset.id = ch.id;
        hl.title = tooltipText(ch);
        hl.addEventListener('click', () => selectChange(ch.id));
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
            if (ch.word_diff && ch.word_diff.length) {
                const tokens = ch.word_diff.map(
                    w => {
                    if (w.status === 'deleted') 
                        return `<del>${

                        

                        esc(w.text)
                    } < /del>`;
                    
                    if (w.status === 'added') 
                        return `<ins>${
                            esc(w.text)
                        }</ins > `;
                    
                    return esc(w.text.slice(0, 30));
                }).join(' ');
                previewHtml = ` < div class = "ci-text" > $ {
                        tokens
                } < /div>`;
            } else {
                const txt = (ch.old_text || ch.new_text || '').slice(0, 80);
                previewHtml = `<div class="ci-text">${
                    esc(txt)
                }</div > `;
            }
        } else if (ch.type === 'table') {
            const changed = (ch.cell_diffs || []).filter(c => c.change !== 'same').length;
            previewHtml = ` < div class = "ci-text" > $ {
                    changed
            }
            cell$ {
                changed !== 1 ? 's' : ''
            }
            changed in table < /div>`;
        } else if (ch.type === 'image') {
            previewHtml = `<div class="ci-text">${
                ch.description || 'Image changed'
            }</div > `;
        }

        el.innerHTML = ` < div class = "ci-header" > <span class="ci-badge ${
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
        $ {
                previewHtml
        }
        `;

        el.addEventListener('click', () => selectChange(ch.id));
        list.appendChild(el);
    });
}

// ── Navigation ────────────────────────────────────────────
function updateNav() {
    const n = visibleChanges.length;
    document.getElementById('navLabel').textContent = n === 0 ? 'No changes' : ` $ {
            n
        }
        change$ {
            n !== 1 ? 's' : ''
        }
        `;
    document.getElementById('navPos').textContent = n > 0 && currentIdx >= 0 ? ` $ {
            currentIdx + 1
        } / $ {
            n
        }
        ` : ` — / $ {
            n
        }
        `;
    document.getElementById('prevBtn').disabled = currentIdx <= 0;
    document.getElementById('nextBtn').disabled = currentIdx >= n - 1;
}

function prevDiff() {
    if (currentIdx > 0) 
        selectByIndex(currentIdx - 1);
    
}
function nextDiff() {
    if (currentIdx < visibleChanges.length - 1) 
        selectByIndex(currentIdx + 1);
    
}

function selectByIndex(i) {
    currentIdx = i;
    const ch = visibleChanges[i];
    if (ch) 
        selectChange(ch.id, false);
    
}

function selectChange(id, updateIdx = true) {
    const ch = visibleChanges.find(c => c.id === id) || allChanges.find(c => c.id === id);
    if (! ch) 
        return;
    

    if (updateIdx) 
        currentIdx = visibleChanges.indexOf(ch);
    

    document.querySelectorAll('.hl').forEach(el => el.classList.remove('active'));
    document.querySelectorAll(` [data - id = "${id}"]`).forEach(el => el.classList.add('active'));

    document.querySelectorAll('.ci').forEach(el => el.classList.remove('active'));
    const ci = document.getElementById(` ci - $ {
            id
        }
        `);
    if (ci) {
        ci.classList.add('active');
        ci.scrollIntoView({block: 'nearest', behavior: 'smooth'});
    }

    scrollToPage(ch._page, ch.old_bbox || ch.new_bbox);
    updateNav();
}

function scrollToPage(pageNum, bbox) {
    const scrollTo = (el) => {
        const pw = document.getElementById(` pw - left - $ {
            pageNum
        }
        `) || document.getElementById(` pw - right - $ {
            pageNum
        }
        `);
        if (! pw) 
            return;
        
        const offset = bbox ? bbox.y * (pw.offsetWidth / (diffData ?. pages[pageNum - 1] ?. width || 1)) : 0;
        el.scrollTop = pw.offsetTop + offset - 60;
    };
    scrollTo(document.getElementById('vsLeft'));
    scrollTo(document.getElementById('vsRight'));
}

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
function syncScrollSetup() {
    const L = document.getElementById('vsLeft');
    const R = document.getElementById('vsRight');
    if (! L || ! R) 
        return;
    

    L.addEventListener('scroll', () => {
        if (syncingScroll) 
            return;
        
        syncingScroll = true;
        R.scrollTop = L.scrollTop;
        syncingScroll = false;
    });
    R.addEventListener('scroll', () => {
        if (syncingScroll) 
            return;
        
        syncingScroll = true;
        L.scrollTop = R.scrollTop;
        syncingScroll = false;
    });
}

// ── Misc UI ───────────────────────────────────────────────
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
