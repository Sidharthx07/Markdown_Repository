/**
 * Universal Markdown Converter Logic
 * Entirely client-side. No backend.
 */

const state = {
    files: [], // Array of { id, file, status, md, error }
    activeFileId: null,
    isProcessing: false
};

// DOM Elements
const els = {
    themeBtn: document.getElementById('theme-toggle'),
    dropzone: document.getElementById('dropzone'),
    fileInput: document.getElementById('file-input'),
    queueSection: document.getElementById('queue-section'),
    fileList: document.getElementById('file-list'),
    workspace: document.getElementById('workspace'),
    activeFilename: document.getElementById('active-filename'),
    mdEditor: document.getElementById('md-editor'),
    mdPreview: document.getElementById('md-preview'),
    btnCopy: document.getElementById('btn-copy'),
    btnDownloadSingle: document.getElementById('btn-download-single'),
    btnDownloadAll: document.getElementById('btn-download-all'),
    optImages: document.getElementById('opt-images'),
    optTables: document.getElementById('opt-tables'),
    optLang: document.getElementById('opt-lang')
};

// ==========================================
// Setup & Utilities
// ==========================================

// Theme Management
function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeBtn(savedTheme);

    els.themeBtn.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        updateThemeBtn(newTheme);
    });
}
function updateThemeBtn(theme) {
    els.themeBtn.textContent = theme === 'light' ? '🌙 Dark Mode' : '☀️ Light Mode';
}

function generateId() {
    return Math.random().toString(36).substring(2, 9);
}

function getExtension(filename) {
    return filename.split('.').pop().toLowerCase();
}

function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}

function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsText(file);
    });
}

function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Turndown Instance
function getTurndownService() {
    const td = new window.TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        emDelimiter: '*'
    });
    if (els.optTables.checked && window.turndownPluginGfm) {
        td.use(window.turndownPluginGfm.gfm);
    }
    return td;
}

// ==========================================
// Converter Modules
// ==========================================

const converters = {
    // Plain text & Code
    'txt': async (file) => await readFileAsText(file),
    'log': async (file) => await readFileAsText(file),
    'json': async (file) => `\`\`\`json\n${await readFileAsText(file)}\n\`\`\``,
    'xml': async (file) => `\`\`\`xml\n${await readFileAsText(file)}\n\`\`\``,
    'js': async (file) => `\`\`\`javascript\n${await readFileAsText(file)}\n\`\`\``,
    'py': async (file) => `\`\`\`python\n${await readFileAsText(file)}\n\`\`\``,
    'java': async (file) => `\`\`\`java\n${await readFileAsText(file)}\n\`\`\``,
    'css': async (file) => `\`\`\`css\n${await readFileAsText(file)}\n\`\`\``,
    'html': async (file) => getTurndownService().turndown(await readFileAsText(file)),
    'htm': async (file) => getTurndownService().turndown(await readFileAsText(file)),

    // PDF via pdf.js
    'pdf': async (file) => {
        const buffer = await readFileAsArrayBuffer(file);
        const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
        let md = '';
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            let lastY = -1;
            let text = '';
            for (let item of content.items) {
                if (lastY !== -1 && Math.abs(lastY - item.transform[5]) > 5) {
                    text += '\n'; // Rough newline estimation
                }
                // Rough heading estimation based on font size (transform scale)
                const fontSize = item.transform[0];
                if (fontSize > 16 && item.str.trim()) {
                    text += `## ${item.str} `;
                } else {
                    text += item.str;
                }
                lastY = item.transform[5];
            }
            md += text + '\n\n';
        }
        return md;
    },

    // DOCX via mammoth + turndown
    'docx': async (file) => {
        const buffer = await readFileAsArrayBuffer(file);
        const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
        return getTurndownService().turndown(result.value);
    },

    // Spreadsheets via SheetJS
    'xlsx': convertSpreadsheet,
    'xls': convertSpreadsheet,
    'csv': convertSpreadsheet,
    'tsv': convertSpreadsheet,

    // PPTX via JSZip
    'pptx': async (file) => {
        const zip = await JSZip.loadAsync(file);
        const slideRegex = /ppt\/slides\/slide(\d+)\.xml/;
        const slides = [];
        
        zip.forEach((path, zipEntry) => {
            const match = path.match(slideRegex);
            if (match) slides.push({ index: parseInt(match[1]), entry: zipEntry });
        });
        
        slides.sort((a, b) => a.index - b.index);
        let md = '';
        const parser = new DOMParser();
        
        for (const slide of slides) {
            const xmlStr = await slide.entry.async('text');
            const xmlDoc = parser.parseFromString(xmlStr, 'text/xml');
            const texts = Array.from(xmlDoc.getElementsByTagName('a:t')).map(n => n.textContent);
            md += `## Slide ${slide.index}\n\n${texts.join(' ')}\n\n---\n\n`;
        }
        return md || '*No parseable text found in presentation.*';
    },

    // EPUB via JSZip
    'epub': async (file) => {
        const zip = await JSZip.loadAsync(file);
        const htmlFiles = [];
        zip.forEach((path, zipEntry) => {
            if (path.endsWith('.html') || path.endsWith('.xhtml') || path.endsWith('.htm')) {
                htmlFiles.push(zipEntry);
            }
        });
        
        let md = '';
        const td = getTurndownService();
        for (const entry of htmlFiles) {
            const htmlStr = await entry.async('text');
            md += td.turndown(htmlStr) + '\n\n---\n\n';
        }
        return md;
    },

    // Images via Tesseract OCR
    'png': convertImage,
    'jpg': convertImage,
    'jpeg': convertImage,
    'webp': convertImage,
    'bmp': convertImage
};

async function convertSpreadsheet(file) {
    const buffer = await readFileAsArrayBuffer(file);
    const workbook = XLSX.read(buffer, { type: 'array' });
    let md = '';
    const td = getTurndownService();
    
    workbook.SheetNames.forEach(sheetName => {
        md += `## Sheet: ${sheetName}\n\n`;
        const html = XLSX.utils.sheet_to_html(workbook.Sheets[sheetName]);
        md += td.turndown(html) + '\n\n';
    });
    return md;
}

async function convertImage(file) {
    const lang = els.optLang.value;
    const includeImg = els.optImages.checked;
    const base64 = await readFileAsDataURL(file);
    
    let md = '';
    if (includeImg) {
        md += `![${file.name}](${base64})\n\n`;
    }
    
    // Tesseract process
    const result = await Tesseract.recognize(base64, lang);
    md += `### Extracted Text\n\n${result.data.text}`;
    return md;
}

// ==========================================
// App Logic
// ==========================================

function handleFiles(filesArray) {
    if (filesArray.length === 0) return;
    
    filesArray.forEach(file => {
        state.files.push({
            id: generateId(),
            file: file,
            status: 'queued',
            md: '',
            error: ''
        });
    });
    
    renderQueue();
    processQueue();
}

function renderQueue() {
    els.queueSection.classList.remove('hidden');
    els.fileList.innerHTML = '';
    
    let doneCount = 0;
    
    state.files.forEach(f => {
        if (f.status === 'done') doneCount++;
        
        const li = document.createElement('li');
        li.className = `file-item ${f.id === state.activeFileId ? 'active' : ''}`;
        li.onclick = () => selectFile(f.id);
        
        let statusText = f.status.charAt(0).toUpperCase() + f.status.slice(1);
        if (f.status === 'error') statusText = 'Error';
        
        li.innerHTML = `
            <span class="file-name">${f.file.name}</span>
            <span class="file-status status-${f.status}">${statusText}</span>
        `;
        els.fileList.appendChild(li);
    });
    
    if (doneCount > 1) {
        els.btnDownloadAll.classList.remove('hidden');
    } else {
        els.btnDownloadAll.classList.add('hidden');
    }
}

async function processQueue() {
    if (state.isProcessing) return;
    state.isProcessing = true;
    
    for (const item of state.files) {
        if (item.status === 'queued') {
            item.status = 'converting';
            renderQueue();
            
            // Allow UI to breathe
            await new Promise(r => setTimeout(r, 50)); 
            
            try {
                const ext = getExtension(item.file.name);
                if (!converters[ext]) {
                    throw new Error(`Unsupported file type: .${ext}. Supported types: PDF, DOCX, XLSX, PPTX, HTML, EPUB, Images, Code.`);
                }
                
                item.md = await converters[ext](item.file);
                item.status = 'done';
            } catch (err) {
                console.error(err);
                item.status = 'error';
                item.error = err.message || 'Conversion failed due to an unknown error or corruption.';
            }
            
            if (!state.activeFileId) {
                selectFile(item.id);
            } else {
                renderQueue();
            }
        }
    }
    
    state.isProcessing = false;
}

function selectFile(id) {
    state.activeFileId = id;
    renderQueue();
    
    const fileData = state.files.find(f => f.id === id);
    if (!fileData) return;
    
    els.workspace.classList.remove('hidden');
    els.activeFilename.textContent = fileData.file.name;
    
    if (fileData.status === 'error') {
        els.mdEditor.value = `ERROR: ${fileData.error}`;
    } else if (fileData.status === 'converting') {
        els.mdEditor.value = 'Converting... Please wait...';
    } else if (fileData.status === 'queued') {
        els.mdEditor.value = 'In queue...';
    } else {
        els.mdEditor.value = fileData.md;
    }
    
    updatePreview();
}

function updatePreview() {
    const rawMd = els.mdEditor.value;
    const html = marked.parse(rawMd);
    const cleanHtml = DOMPurify.sanitize(html);
    els.mdPreview.innerHTML = cleanHtml;
    
    // Sync back to state
    const fileData = state.files.find(f => f.id === state.activeFileId);
    if (fileData && fileData.status === 'done') {
        fileData.md = rawMd;
    }
}

// ==========================================
// Events & Listeners
// ==========================================

// Drag & Drop
els.dropzone.addEventListener('dragover', e => {
    e.preventDefault();
    els.dropzone.classList.add('dragover');
});
els.dropzone.addEventListener('dragleave', () => {
    els.dropzone.classList.remove('dragover');
});
els.dropzone.addEventListener('drop', e => {
    e.preventDefault();
    els.dropzone.classList.remove('dragover');
    handleFiles(Array.from(e.dataTransfer.files));
});
els.dropzone.addEventListener('click', () => {
    els.fileInput.click();
});
els.fileInput.addEventListener('change', e => {
    handleFiles(Array.from(e.target.files));
    e.target.value = ''; // Reset
});

// Editor Sync
els.mdEditor.addEventListener('input', updatePreview);

// Toolbar Buttons
els.btnCopy.addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText(els.mdEditor.value);
        els.btnCopy.textContent = '✅ Copied!';
        setTimeout(() => els.btnCopy.textContent = '📋 Copy', 2000);
    } catch (err) {
        alert('Failed to copy text.');
    }
});

els.btnDownloadSingle.addEventListener('click', () => {
    const fileData = state.files.find(f => f.id === state.activeFileId);
    if (!fileData || fileData.status !== 'done') return;
    
    const blob = new Blob([fileData.md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const baseName = fileData.file.name.substring(0, fileData.file.name.lastIndexOf('.')) || fileData.file.name;
    
    a.href = url;
    a.download = `${baseName}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

els.btnDownloadAll.addEventListener('click', async () => {
    const zip = new JSZip();
    const doneFiles = state.files.filter(f => f.status === 'done');
    
    doneFiles.forEach(f => {
        const baseName = f.file.name.substring(0, f.file.name.lastIndexOf('.')) || f.file.name;
        // Basic duplicate name collision protection
        zip.file(`${baseName}_${f.id.substring(0,4)}.md`, f.md);
    });
    
    const content = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    
    a.href = url;
    a.download = `Converted_Markdowns.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

// Init
initTheme();