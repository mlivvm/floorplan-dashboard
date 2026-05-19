(function (global) {
  const FD = global.FD = global.FD || {};

  const MAX_PDF_PAGES = 30;
  const THUMB_RENDER_SCALE = 0.3;
  const UPLOAD_RENDER_SCALE = 1.5;
  const MAX_UPLOAD_DATA_URL_LENGTH = 1040000;

  function pdfError(message, code) {
    const err = new Error(message);
    err.code = code;
    return err;
  }

  async function loadPdfDocument(pdfjsLib, file) {
    if (!pdfjsLib) throw pdfError('PDF library niet geladen. Gebruik een foto.', 'pdfjs_missing');
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw pdfError(`Deze PDF heeft ${pdf.numPages} pagina's. Maximaal ${MAX_PDF_PAGES} pagina's per upload.`, 'too_many_pages');
    }
    return pdf;
  }

  async function renderPdfPageToCanvas(pdf, pageNumber, { scale = UPLOAD_RENDER_SCALE, rotation = 0, documentRef = document } = {}) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale, rotation });
    const canvas = documentRef.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return { canvas, width: canvas.width, height: canvas.height };
  }

  function canvasToUploadJPEG(canvas, {
    maxLength = MAX_UPLOAD_DATA_URL_LENGTH,
    startQuality = 0.82,
    minQuality = 0.28,
    qualityStep = 0.08,
    errorMessage = 'Pagina is te groot. Maak de uitsnede kleiner.',
  } = {}) {
    let quality = startQuality;
    let dataUrl;
    do {
      dataUrl = canvas.toDataURL('image/jpeg', quality);
      quality -= qualityStep;
    } while (dataUrl.length > maxLength && quality > minQuality);

    if (dataUrl.length > maxLength) throw new Error(errorMessage);
    return dataUrl;
  }

  function dataUrlToImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new global.Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Pagina-afbeelding kon niet worden geladen.'));
      img.src = dataUrl;
    });
  }

  async function dataUrlToThumbnail(dataUrl, { maxWidth = 260, maxHeight = 180, documentRef = document } = {}) {
    const img = await dataUrlToImage(dataUrl);
    const scale = Math.min(maxWidth / img.naturalWidth, maxHeight / img.naturalHeight, 1);
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = documentRef.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.72);
  }

  function buildUploadSVGText({ imageDataUrl, width, height }) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">\n  <image href="${imageDataUrl}" width="${width}" height="${height}"/>\n</svg>`;
  }

  function suggestedFloorplanName(fileName, pageNumber) {
    const base = String(fileName || 'PDF')
      .replace(/\.[^.]+$/, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'PDF';
    return `${base} - pagina ${String(pageNumber).padStart(2, '0')}`;
  }

  FD.PdfImportService = {
    MAX_PDF_PAGES,
    THUMB_RENDER_SCALE,
    UPLOAD_RENDER_SCALE,
    MAX_UPLOAD_DATA_URL_LENGTH,
    loadPdfDocument,
    renderPdfPageToCanvas,
    canvasToUploadJPEG,
    dataUrlToThumbnail,
    buildUploadSVGText,
    suggestedFloorplanName,
  };
})(window);
