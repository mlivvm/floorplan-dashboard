(function (global) {
  const FD = global.FD = global.FD || {};

  const NEW_CUSTOMER_VALUE = '__new__';
  const MAX_IMAGE_UPLOAD_BYTES = 20 * 1024 * 1024;
  const MAX_PDF_UPLOAD_BYTES = 50 * 1024 * 1024;
  const MAX_UPLOAD_DATA_URL_LENGTH = 1040000;

  function hide(el) {
    if (el) el.style.display = 'none';
  }

  function show(el, display = 'block') {
    if (el) el.style.display = display;
  }

  function resetPreviewState(elements) {
    elements.imageState.dataUrl = null;
    elements.imageState.width = 0;
    elements.imageState.height = 0;
    elements.previewImg.src = '';
    elements.previewImg.style.display = '';
    elements.previewTitle.textContent = 'Voorbeeld';
    elements.previewRetakeBtn.style.display = '';
    elements.previewAcceptBtn.style.display = '';
    elements.stepChoose.style.display = 'block';
    elements.stepPreview.style.display = 'none';
    elements.stepForm.style.display = 'none';
    hide(elements.stepPdf);
    elements.errorEl.textContent = '';
  }

  function resetFormState(elements) {
    elements.customerSelect.style.display = '';
    elements.newCustomerWrapper.style.display = 'none';
    elements.newCustomerInput.value = '';
    if (elements.buildingNameInput) elements.buildingNameInput.value = '';
    elements.floorplanNameInput.value = '';
  }

  function showPreview(elements, dataUrl, width, height) {
    elements.imageState.dataUrl = dataUrl;
    elements.imageState.width = width;
    elements.imageState.height = height;
    elements.previewImg.src = dataUrl;
    elements.previewImg.style.display = '';
    elements.previewTitle.textContent = 'Voorbeeld';
    elements.previewRetakeBtn.style.display = '';
    elements.previewAcceptBtn.style.display = '';
    elements.stepChoose.style.display = 'none';
    elements.stepPreview.style.display = 'block';
  }

  function showChooseStep(elements) {
    elements.stepPreview.style.display = 'none';
    elements.stepChoose.style.display = 'block';
    elements.stepForm.style.display = 'none';
    hide(elements.stepPdf);
  }

  function populateCustomerSelect(selectEl, customers) {
    selectEl.innerHTML = '<option value="">-- Kies klant --</option>';

    const newOpt = document.createElement('option');
    newOpt.value = NEW_CUSTOMER_VALUE;
    newOpt.textContent = '➕ Nieuwe klant toevoegen';
    selectEl.appendChild(newOpt);

    const sortedCustomers = FD.SelectSheetService?.sortedWithOriginalIndex
      ? FD.SelectSheetService.sortedWithOriginalIndex(customers, customer => customer.customer)
      : (customers || []).map((customer, index) => ({
        item: customer,
        index,
        label: String(customer?.customer || '').trim(),
      }));

    sortedCustomers.forEach(({ index, label }) => {
      const opt = document.createElement('option');
      opt.value = String(index);
      opt.textContent = label;
      selectEl.appendChild(opt);
    });
  }

  function showForm(elements, customers) {
    populateCustomerSelect(elements.customerSelect, customers);
    resetFormState(elements);
    elements.errorEl.textContent = '';
    elements.stepPreview.style.display = 'none';
    elements.stepForm.style.display = 'block';
  }

  function showNewCustomerInput(elements) {
    elements.customerSelect.style.display = 'none';
    elements.newCustomerWrapper.style.display = 'block';
    elements.newCustomerInput.focus();
  }

  function showCustomerSelect(elements) {
    elements.newCustomerWrapper.style.display = 'none';
    elements.customerSelect.style.display = '';
    elements.customerSelect.value = '';
    elements.newCustomerInput.value = '';
  }

  function setUploadFormLayout(controls, active) {
    controls.popup.classList.toggle('upload-form-active', active);
    if (active) controls.popup.scrollTop = 0;
  }

  function setPdfImportLayout(controls, active) {
    controls.popup.classList.toggle('upload-pdf-active', active);
    if (active) controls.popup.scrollTop = 0;
  }

  function prepareCustomerSelectInteraction(elements, controls) {
    const activeEl = global.document.activeElement;
    if (activeEl && activeEl !== elements.customerSelect && controls.popup.contains(activeEl)) {
      if (/^(INPUT|TEXTAREA)$/i.test(activeEl.tagName)) activeEl.blur();
    }
    controls.popup.scrollTop = 0;
    elements.customerSelect.scrollIntoView({ block: 'center', inline: 'nearest' });
  }

  function resizeImageToCanvas(img, maxSize, documentRef = document) {
    const canvas = documentRef.createElement('canvas');
    let width = img.naturalWidth || img.width;
    let height = img.naturalHeight || img.height;

    if (width > maxSize || height > maxSize) {
      if (width > height) {
        height = Math.round(height * maxSize / width);
        width = maxSize;
      } else {
        width = Math.round(width * maxSize / height);
        height = maxSize;
      }
    }

    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(img, 0, 0, width, height);
    return { canvas, width, height };
  }

  function canvasToUploadJPEG(canvas, {
    maxLength = MAX_UPLOAD_DATA_URL_LENGTH,
    startQuality = 0.8,
    minQuality = 0.2,
    qualityStep = 0.1,
    errorMessage = 'Bestand is te groot.',
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

  function validateUploadForm({
    customerValue,
    newCustomerName,
    buildingName = '',
    floorplanName,
    customers,
  }) {
    if (customerValue === '') return { ok: false, error: 'Kies een klant.' };

    let customerName;
    let isNewCustomer = false;

    if (customerValue === NEW_CUSTOMER_VALUE) {
      customerName = newCustomerName.trim();
      if (!customerName) return { ok: false, error: 'Vul een klantnaam in.' };
      const existingMatch = customers.find(c => c.customer.toLowerCase() === customerName.toLowerCase());
      if (existingMatch) {
        return {
          ok: false,
          error: 'Deze klant bestaat al. Selecteer "' + existingMatch.customer + '" uit de lijst.',
        };
      }
      isNewCustomer = true;
    } else {
      customerName = customers[parseInt(customerValue, 10)]?.customer;
      if (!customerName) return { ok: false, error: 'Kies een klant.' };
    }

    const cleanBuildingName = String(buildingName || '').trim();
    const cleanFloorLabel = String(floorplanName || '').trim();
    if (!cleanFloorLabel) return { ok: false, error: 'Vul een verdieping of naam in voor de plattegrond.' };
    const cleanFloorplanName = cleanBuildingName ? `${cleanBuildingName} - ${cleanFloorLabel}` : cleanFloorLabel;

    if (!isNewCustomer) {
      const customer = customers[parseInt(customerValue, 10)];
      const existing = customer?.floorplans?.find(fp => fp.name === cleanFloorplanName);
      if (existing) return { ok: false, error: 'Deze plattegrondnaam bestaat al bij deze klant.' };
    }

    return {
      ok: true,
      customerName,
      floorplanName: cleanFloorplanName,
      buildingName: cleanBuildingName,
      floorLabel: cleanFloorLabel,
      isNewCustomer,
    };
  }

  function sanitizeFilename(name, now = Date.now()) {
    const slug = name.toLowerCase()
      .replace(/[^a-z0-9\-_ ]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .substring(0, 60);
    return slug ? now + '-' + slug : String(now);
  }

  function buildUploadSVGText({ imageDataUrl, width, height }) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">\n  <image href="${imageDataUrl}" width="${width}" height="${height}"/>\n</svg>`;
  }

  function selectedPdfPages(state) {
    return (state.pages || []).filter(page => page.selected);
  }

  function destroyPdfCropper(state) {
    if (state.suppressCropSyncTimer) {
      clearTimeout(state.suppressCropSyncTimer);
      state.suppressCropSyncTimer = null;
    }
    state.suppressCropSync = false;
    if (state.cropper) {
      state.cropper.destroy();
      state.cropper = null;
    }
  }

  function clonePdfCropData(cropData) {
    return cropData ? { ...cropData } : null;
  }

  function browserYield() {
    return new Promise(resolve => {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
      else setTimeout(resolve, 0);
    });
  }

  function normalizePdfCropData(data) {
    const x = Math.round(Number(data?.x) || 0);
    const y = Math.round(Number(data?.y) || 0);
    const width = Math.max(1, Math.round(Number(data?.width) || 0));
    const height = Math.max(1, Math.round(Number(data?.height) || 0));
    return { x, y, width, height };
  }

  function fullPdfCropData(cropper, img) {
    const imageData = cropper?.getImageData ? cropper.getImageData() : {};
    const naturalWidth = Math.round(imageData.naturalWidth || img?.naturalWidth || 1);
    const naturalHeight = Math.round(imageData.naturalHeight || img?.naturalHeight || 1);
    return { x: 0, y: 0, width: Math.max(1, naturalWidth), height: Math.max(1, naturalHeight) };
  }

  function currentPdfCropData(state, elements) {
    if (!state.cropper) return null;
    return normalizePdfCropData(state.cropper.getData(true) || fullPdfCropData(state.cropper, elements.pdfEditorImg));
  }

  function setPdfEditorDataset(elements, state) {
    if (!elements.pdfEditor) return;
    elements.pdfEditor.dataset.mode = 'crop';
    if (state.activePage?.cropData) {
      elements.pdfEditor.dataset.cropData = JSON.stringify(state.activePage.cropData);
    } else {
      delete elements.pdfEditor.dataset.cropData;
    }
  }

  function applyPdfCropData(state, elements, cropData) {
    if (!state.cropper || !cropData) return;
    state.suppressCropSync = true;
    if (state.suppressCropSyncTimer) clearTimeout(state.suppressCropSyncTimer);
    state.cropper.setData(cropData);
    setPdfEditorDataset(elements, state);
    state.suppressCropSyncTimer = setTimeout(() => {
      state.suppressCropSync = false;
      state.suppressCropSyncTimer = null;
    }, 80);
  }

  function resetPdfCropperToPage(state, elements) {
    if (!state.cropper || !state.activePage) return;
    const rotation = state.pdfEditorRotation || 0;
    state.suppressCropSync = true;
    if (state.suppressCropSyncTimer) clearTimeout(state.suppressCropSyncTimer);
    state.cropper.reset();
    if (rotation && typeof state.cropper.rotateTo === 'function') state.cropper.rotateTo(rotation);
    preparePdfCropBoxForFullFit(state);
    requestAnimationFrame(() => {
      if (!state.cropper || !state.activePage) return;
      fitPdfCropperToFullPage(state, elements);
      requestAnimationFrame(() => {
        if (!state.cropper || !state.activePage) return;
        fitPdfCropperToFullPage(state, elements);
        state.suppressCropSyncTimer = setTimeout(() => {
          if (state.cropper && state.activePage) fitPdfCropperToFullPage(state, elements);
          state.suppressCropSync = false;
          state.suppressCropSyncTimer = null;
        }, 160);
      });
    });
  }

  function currentPdfZoomRatio(state) {
    if (!state.cropper?.getImageData || !state.cropper?.getCanvasData) return null;
    const imageData = state.cropper.getImageData();
    const canvasData = state.cropper.getCanvasData();
    const naturalWidth = canvasData.naturalWidth || imageData.naturalWidth || imageData.width || 1;
    return canvasData.width / naturalWidth;
  }

  function pdfCropBoxForVisibleCanvas(canvasData) {
    return {
      left: canvasData.left,
      top: canvasData.top,
      width: canvasData.width,
      height: canvasData.height,
    };
  }

  function fitPdfCropperToFullPage(state, elements) {
    if (!state.cropper || !state.activePage) return;
    preparePdfCropBoxForFullFit(state);
    fitPdfCropperCanvas(state);
    if (typeof state.cropper.setCropBoxData === 'function') {
      state.cropper.setCropBoxData(pdfCropBoxForVisibleCanvas(state.cropper.getCanvasData()));
    }
    state.activePage.cropData = currentPdfCropData(state, elements) || fullPdfCropData(state.cropper, elements.pdfEditorImg);
    setPdfEditorDataset(elements, state);
    state.pdfFitZoomRatio = currentPdfZoomRatio(state);
  }

  function applyPdfCropBoxFromData(state, cropData) {
    if (!state.cropper?.setCropBoxData || !state.cropper?.getCanvasData || !state.cropper?.getImageData || !state.cropper?.getContainerData || !cropData) return;
    if ((state.pdfEditorRotation || 0) % 180 !== 0) return;
    const containerData = state.cropper.getContainerData();
    const canvasData = state.cropper.getCanvasData();
    const imageData = state.cropper.getImageData();
    const naturalWidth = imageData.naturalWidth || imageData.width || 1;
    const naturalHeight = imageData.naturalHeight || imageData.height || 1;
    if (!canvasData.width || !canvasData.height || !naturalWidth || !naturalHeight) return;
    const scaleX = canvasData.width / naturalWidth;
    const scaleY = canvasData.height / naturalHeight;
    let left = canvasData.left + cropData.x * scaleX;
    let top = canvasData.top + cropData.y * scaleY;
    let width = cropData.width * scaleX;
    let height = cropData.height * scaleY;
    if (left < 0) { width += left; left = 0; }
    if (top < 0) { height += top; top = 0; }
    if (left + width > containerData.width) width = containerData.width - left;
    if (top + height > containerData.height) height = containerData.height - top;
    if (width <= 0 || height <= 0) return;
    state.cropper.setCropBoxData({ left, top, width, height });
  }

  function restorePdfCropAfterViewportChange(state, elements, cropData) {
    if (!state.cropper || !state.activePage || !cropData) return;
    state.suppressCropSync = true;
    if (state.suppressCropSyncTimer) clearTimeout(state.suppressCropSyncTimer);
    const applyCropData = () => {
      if (!state.cropper || !state.activePage) return false;
      state.activePage.cropData = cropData;
      state.cropper.setData(cropData);
      setPdfEditorDataset(elements, state);
      return true;
    };
    requestAnimationFrame(() => {
      if (!applyCropData()) return;
      requestAnimationFrame(() => {
        if (!state.cropper || !state.activePage) return;
        applyPdfCropBoxFromData(state, cropData);
        state.activePage.cropData = cropData;
        setPdfEditorDataset(elements, state);
        state.suppressCropSyncTimer = setTimeout(() => {
          if (state.cropper && state.activePage) {
            applyPdfCropBoxFromData(state, cropData);
            state.activePage.cropData = cropData;
            setPdfEditorDataset(elements, state);
          }
          state.suppressCropSync = false;
          state.suppressCropSyncTimer = null;
        }, 140);
      });
    });
  }

  function setPdfEditorLoading(elements, loading) {
    if (elements.pdfEditor) elements.pdfEditor.classList.toggle('is-loading', Boolean(loading));
    [elements.pdfEditorSaveButton, elements.pdfZoomOutButton, elements.pdfZoomFitButton, elements.pdfZoomInButton].forEach(button => {
      if (button) button.disabled = Boolean(loading);
    });
  }

  function setPdfUploadProgress(elements, { visible = true, value = 0, text = '' } = {}) {
    if (!elements.pdfProgress) return;
    elements.pdfProgress.style.display = visible ? 'block' : 'none';
    const percent = Math.max(0, Math.min(100, Math.round(value)));
    if (elements.pdfProgressBar) elements.pdfProgressBar.style.width = `${percent}%`;
    if (elements.pdfProgressText) elements.pdfProgressText.textContent = text || `${percent}%`;
  }

  function fitPdfCropperCanvas(state) {
    if (!state.cropper?.getContainerData || !state.cropper?.getCanvasData || !state.cropper?.setCanvasData || !state.cropper?.getImageData) return;
    const containerData = state.cropper.getContainerData();
    const canvasData = state.cropper.getCanvasData();
    const imageData = state.cropper.getImageData();
    const naturalWidth = canvasData.naturalWidth || imageData.naturalWidth || canvasData.width || 1;
    const naturalHeight = canvasData.naturalHeight || imageData.naturalHeight || canvasData.height || 1;
    if (!containerData.width || !containerData.height || !naturalWidth || !naturalHeight) return;

    const safeSpace = global.matchMedia?.('(pointer: coarse)')?.matches ? 72 : 56;
    const maxWidth = Math.max(1, containerData.width - safeSpace);
    const maxHeight = Math.max(1, containerData.height - safeSpace);
    const scale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight, 1);

    const width = naturalWidth * scale;
    const height = naturalHeight * scale;
    state.cropper.setCanvasData({
      left: (containerData.width - width) / 2,
      top: (containerData.height - height) / 2,
      width,
      height,
    });
  }

  function preparePdfCropBoxForFullFit(state) {
    if (!state.cropper?.getContainerData || !state.cropper?.setCropBoxData) return;
    const containerData = state.cropper.getContainerData();
    if (!containerData.width || !containerData.height) return;
    const width = Math.max(24, Math.min(96, containerData.width * 0.2));
    const height = Math.max(24, Math.min(96, containerData.height * 0.2));
    state.cropper.setCropBoxData({
      left: (containerData.width - width) / 2,
      top: (containerData.height - height) / 2,
      width,
      height,
    });
  }

  function relaxPdfCropBoxForZoomOut(state) {
    preparePdfCropBoxForFullFit(state);
  }

  function constrainPdfEditorImageToHandles(elements) {
    const img = elements.pdfEditorImg;
    const wrap = elements.pdfEditor?.querySelector?.('.upload-pdf-crop-stage');
    if (!img || !wrap) return;
    const safeSpace = 56;
    const minSize = 160;
    const maxWidth = Math.max(minSize, wrap.clientWidth - safeSpace);
    const maxHeight = Math.max(minSize, wrap.clientHeight - safeSpace);
    const naturalWidth = img.naturalWidth || maxWidth;
    const naturalHeight = img.naturalHeight || maxHeight;
    const scale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight);
    img.style.width = `${Math.max(1, Math.round(naturalWidth * scale))}px`;
    img.style.height = `${Math.max(1, Math.round(naturalHeight * scale))}px`;
    img.style.maxWidth = `${maxWidth}px`;
    img.style.maxHeight = `${maxHeight}px`;
  }

  function resetPdfState(elements) {
    const state = elements.pdfState;
    if (!state) return;
    destroyPdfCropper(state);
    state.file = null;
    state.pdf = null;
    state.pages = [];
    state.activePage = null;
    state.activeEditorRun = 0;
    state.pdfEditorRotation = 0;
    state.activeOriginalCropData = null;
    state.suppressCropSync = false;
    if (state.suppressCropSyncTimer) clearTimeout(state.suppressCropSyncTimer);
    state.suppressCropSyncTimer = null;
    state.latestResult = null;
    state.latestUploadedPage = null;
    state.batchCustomerName = '';
    state.pdfFitZoomRatio = null;
    hide(elements.pdfProcessing);
    hide(elements.pdfOverview);
    hide(elements.pdfEditor);
    hide(elements.pdfForm);
    if (elements.pdfPages) elements.pdfPages.innerHTML = '';
    if (elements.pdfNamesList) elements.pdfNamesList.innerHTML = '';
    if (elements.pdfErrorEl) elements.pdfErrorEl.textContent = '';
    if (elements.pdfTitle) elements.pdfTitle.textContent = "Pagina's kiezen";
    if (elements.pdfSummary) elements.pdfSummary.textContent = 'PDF laden...';
    if (elements.pdfCount) elements.pdfCount.textContent = '0 geselecteerd';
    if (elements.pdfEditorImg) {
      elements.pdfEditorImg.onload = null;
      elements.pdfEditorImg.onerror = null;
      elements.pdfEditorImg.removeAttribute('src');
      elements.pdfEditorImg.style.width = '';
      elements.pdfEditorImg.style.height = '';
      elements.pdfEditorImg.style.maxWidth = '';
      elements.pdfEditorImg.style.maxHeight = '';
    }
    setPdfEditorLoading(elements, false);
    setPdfUploadProgress(elements, { visible: false, value: 0 });
  }

  function showPdfStep(elements, controls) {
    elements.stepChoose.style.display = 'none';
    elements.stepPreview.style.display = 'none';
    elements.stepForm.style.display = 'none';
    show(elements.stepPdf, 'flex');
    setUploadFormLayout(controls, false);
    setPdfImportLayout(controls, true);
  }

  function showPdfProcessing(elements, controls, fileName) {
    showPdfStep(elements, controls);
    hide(elements.pdfOverview);
    hide(elements.pdfEditor);
    hide(elements.pdfForm);
    show(elements.pdfProcessing, 'flex');
    elements.pdfTitle.textContent = 'PDF verwerken';
    elements.pdfSummary.textContent = fileName || 'PDF laden...';
  }

  function updatePdfHeader(elements) {
    const state = elements.pdfState;
    const total = state.pages.length;
    const selected = selectedPdfPages(state).length;
    elements.pdfTitle.textContent = "Pagina's kiezen";
    elements.pdfSummary.textContent = total
      ? `${total} pagina's gevonden. Klik op een pagina om te croppen of te roteren.`
      : "Geen pagina's gevonden.";
    elements.pdfCount.textContent = `${selected} van ${total} geselecteerd`;
    if (elements.pdfNextButton) elements.pdfNextButton.disabled = selected === 0;
  }

  function pageStatusLabel(page) {
    if (page.status === 'rendering') return 'Voorbeeld laden...';
    if (page.status === 'uploading') return 'Uploaden...';
    if (page.status === 'uploaded') return 'Geupload';
    if (page.status === 'error') return page.error || 'Fout';
    if (page.edited) return 'Bewerkt';
    return 'Nog niet bewerkt';
  }

  function togglePdfPageSelection(elements, page) {
    if (!page || page.status === 'uploading') return;
    page.selected = !page.selected;
    updatePdfPageCard(elements, page);
    updatePdfHeader(elements);
  }

  function blockElementDragging(el) {
    if (!el) return;
    el.draggable = false;
    el.addEventListener('dragstart', event => event.preventDefault());
  }

  function ensurePdfPreviewOverlay() {
    let overlay = global.document.getElementById('upload-pdf-preview-overlay');
    if (overlay) return overlay;

    overlay = global.document.createElement('div');
    overlay.id = 'upload-pdf-preview-overlay';
    overlay.className = 'upload-pdf-preview-overlay';
    overlay.innerHTML = `
      <div class="upload-pdf-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="upload-pdf-preview-title">
        <div class="upload-pdf-preview-head">
          <span id="upload-pdf-preview-title">Pagina bekijken</span>
          <button type="button" class="upload-pdf-preview-close" aria-label="Voorbeeld sluiten">&times;</button>
        </div>
        <div class="upload-pdf-preview-body">
          <span class="upload-pdf-preview-loading">Voorbeeld laden...</span>
          <img alt="PDF pagina vergroot" draggable="false" style="display:none;">
        </div>
      </div>
    `;
    overlay.addEventListener('click', event => {
      if (event.target === overlay) overlay.classList.remove('is-open');
    });
    overlay.querySelector('.upload-pdf-preview-close')?.addEventListener('click', () => {
      overlay.classList.remove('is-open');
    });
    global.document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && overlay.classList.contains('is-open')) {
        overlay.classList.remove('is-open');
      }
    });
    global.document.body.appendChild(overlay);
    return overlay;
  }

  async function showPdfPagePreview(elements, page) {
    const overlay = ensurePdfPreviewOverlay();
    const title = overlay.querySelector('#upload-pdf-preview-title');
    const img = overlay.querySelector('img');
    const loading = overlay.querySelector('.upload-pdf-preview-loading');
    const setImage = dataUrl => {
      if (!img || !loading || !dataUrl) return;
      img.src = dataUrl;
      img.style.display = '';
      loading.style.display = 'none';
    };

    if (title) title.textContent = `Pagina ${page.pageNumber} bekijken`;
    if (img) {
      img.removeAttribute('src');
      img.style.display = 'none';
    }
    if (loading) {
      loading.textContent = 'Voorbeeld laden...';
      loading.style.display = '';
    }
    overlay.classList.add('is-open');

    const immediatePreview = page.editDataUrl || page.previewDataUrl || page.thumbnailDataUrl;
    if (immediatePreview) setImage(immediatePreview);

    if (!page.editDataUrl && !page.previewDataUrl && elements.pdfState?.pdf) {
      try {
        const rendered = await FD.PdfImportService.renderPdfPageToCanvas(elements.pdfState.pdf, page.pageNumber, {
          scale: FD.PdfImportService.UPLOAD_RENDER_SCALE,
        });
        page.previewDataUrl = rendered.canvas.toDataURL('image/jpeg', 0.82);
        if (overlay.classList.contains('is-open')) setImage(page.previewDataUrl);
      } catch (err) {
        if (loading && !immediatePreview) loading.textContent = 'Voorbeeld kon niet worden geladen';
      }
    } else if (!immediatePreview && loading) {
      loading.textContent = 'Voorbeeld niet beschikbaar';
    }
  }

  function renderPdfPageCard(elements, page) {
    const card = document.createElement('article');
    card.className = 'upload-pdf-page';
    card.classList.toggle('is-selected', page.selected);
    card.classList.toggle('is-error', page.status === 'error');
    card.dataset.pageNumber = String(page.pageNumber);

    const thumb = document.createElement('div');
    thumb.className = 'upload-pdf-page-thumb';
    blockElementDragging(thumb);
    const number = document.createElement('span');
    number.className = 'upload-pdf-page-number';
    number.textContent = String(page.pageNumber);
    thumb.appendChild(number);
    if (page.thumbnailDataUrl) {
      const img = document.createElement('img');
      img.src = page.thumbnailDataUrl;
      img.alt = `PDF pagina ${page.pageNumber}`;
      blockElementDragging(img);
      thumb.appendChild(img);
    } else {
      const loading = document.createElement('span');
      loading.style.color = '#5f6368';
      loading.style.fontWeight = '800';
      loading.textContent = 'Laden...';
      thumb.appendChild(loading);
    }

    const body = document.createElement('div');
    body.className = 'upload-pdf-page-body';
    const title = document.createElement('label');
    title.className = 'upload-pdf-page-title';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = page.selected;
    checkbox.addEventListener('click', event => event.stopPropagation());
    checkbox.addEventListener('change', () => {
      page.selected = checkbox.checked;
      updatePdfPageCard(elements, page);
      updatePdfHeader(elements);
    });
    const titleText = document.createElement('span');
    titleText.textContent = `Pagina ${page.pageNumber}`;
    title.appendChild(checkbox);
    title.appendChild(titleText);

    const status = document.createElement('div');
    status.className = 'upload-pdf-page-status';
    status.classList.toggle('is-error', page.status === 'error');
    status.textContent = pageStatusLabel(page);

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'upload-pdf-page-edit';
    editButton.textContent = 'Bewerken';
    editButton.addEventListener('click', event => {
      event.stopPropagation();
      elements.openPdfEditor(page.pageNumber);
    });

    body.appendChild(title);
    const actions = document.createElement('div');
    actions.className = 'upload-pdf-page-actions';
    actions.appendChild(status);
    actions.appendChild(editButton);
    body.appendChild(actions);
    card.appendChild(thumb);
    card.appendChild(body);
    card.addEventListener('click', () => togglePdfPageSelection(elements, page));
    card.addEventListener('dragstart', event => event.preventDefault());
    return card;
  }

  function updatePdfPageCard(elements, page) {
    const oldCard = elements.pdfPages?.querySelector(`.upload-pdf-page[data-page-number="${page.pageNumber}"]`);
    const newCard = renderPdfPageCard(elements, page);
    if (oldCard) oldCard.replaceWith(newCard);
  }

  function renderPdfPages(elements) {
    const state = elements.pdfState;
    const container = elements.pdfPages;
    if (!container) return;
    container.innerHTML = '';
    state.pages.forEach(page => container.appendChild(renderPdfPageCard(elements, page)));
    updatePdfHeader(elements);
  }

  function renderPdfNameRows(elements) {
    const state = elements.pdfState;
    const container = elements.pdfNamesList;
    if (!container) return;
    container.innerHTML = '';

    selectedPdfPages(state).forEach(page => {
      const row = document.createElement('div');
      row.className = 'upload-pdf-name-row';

      const thumb = document.createElement('button');
      thumb.type = 'button';
      thumb.className = 'upload-pdf-name-thumb';
      thumb.title = `Pagina ${page.pageNumber} vergroot bekijken`;
      thumb.addEventListener('click', () => showPdfPagePreview(elements, page));
      blockElementDragging(thumb);
      const number = document.createElement('span');
      number.textContent = `P${page.pageNumber}`;
      thumb.appendChild(number);
      if (page.thumbnailDataUrl) {
        const img = document.createElement('img');
        img.src = page.thumbnailDataUrl;
        img.alt = `PDF pagina ${page.pageNumber}`;
        blockElementDragging(img);
        thumb.appendChild(img);
      }

      const fieldWrap = document.createElement('div');
      const label = document.createElement('label');
      label.textContent = `Plattegrond beschrijving voor pagina ${page.pageNumber}`;
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'upload-input';
      input.value = page.floorLabel || page.floorplanName || '';
      input.placeholder = 'bv. Begane grond';
      input.addEventListener('input', () => {
        page.floorLabel = input.value;
      });
      const status = document.createElement('div');
      status.className = 'upload-pdf-page-status';
      status.classList.toggle('is-error', page.status === 'error');
      status.textContent = pageStatusLabel(page);
      fieldWrap.appendChild(label);
      fieldWrap.appendChild(input);
      fieldWrap.appendChild(status);

      row.appendChild(thumb);
      row.appendChild(fieldWrap);
      container.appendChild(row);
    });
  }

  function validatePdfBatchForm({ customerValue, newCustomerName, buildingName = '', pages, customers }) {
    if (!pages.length) return { ok: false, error: 'Selecteer minimaal 1 pagina.' };
    if (customerValue === '') return { ok: false, error: 'Kies een klant.' };

    let customerName;
    let isNewCustomer = false;
    let customer = null;

    if (customerValue === NEW_CUSTOMER_VALUE) {
      customerName = newCustomerName.trim();
      if (!customerName) return { ok: false, error: 'Vul een klantnaam in.' };
      const existingMatch = customers.find(c => c.customer.toLowerCase() === customerName.toLowerCase());
      if (existingMatch) {
        return {
          ok: false,
          error: 'Deze klant bestaat al. Selecteer "' + existingMatch.customer + '" uit de lijst.',
        };
      }
      isNewCustomer = true;
    } else {
      customer = customers[parseInt(customerValue, 10)];
      customerName = customer?.customer;
      if (!customerName) return { ok: false, error: 'Kies een klant.' };
    }

    const cleanBuildingName = String(buildingName || '').trim();
    const seen = new Set();
    for (const page of pages) {
      const cleanFloorLabel = String(page.floorLabel || page.floorplanName || '').trim();
      if (!cleanFloorLabel) return { ok: false, error: `Vul een verdieping of naam in voor pagina ${page.pageNumber}.` };
      const cleanName = cleanBuildingName ? `${cleanBuildingName} - ${cleanFloorLabel}` : cleanFloorLabel;
      const key = cleanName.toLowerCase();
      if (seen.has(key)) return { ok: false, error: `Dubbele plattegrondnaam: "${cleanName}".` };
      seen.add(key);
      page.floorLabel = cleanFloorLabel;
      page.floorplanName = cleanName;

      if (!isNewCustomer) {
        const existing = customer?.floorplans?.find(fp => fp.name === cleanName);
        if (existing) return { ok: false, error: `Deze plattegrondnaam bestaat al bij deze klant: "${cleanName}".` };
      }
    }

    return {
      ok: true,
      customerName,
      buildingName: cleanBuildingName,
      isNewCustomer,
      pages,
    };
  }

  function createUploadController({
    elements,
    controls,
    getCustomers,
    modeController,
    modes,
    isEditMode = () => false,
    hideTopbarMenu = () => {},
    showToast = () => {},
    getPdfJsLib = () => global.pdfjsLib,
    onSave,
    onSaved = () => {},
  }) {
    let generation = 0;
    let saving = false;
    let bound = false;
    elements.pdfState = elements.pdfState || { pages: [] };

    function currentCustomers() {
      return typeof getCustomers === 'function' ? getCustomers() : [];
    }

    function resetAll() {
      resetPdfState(elements);
      resetPreviewState(elements);
      resetFormState(elements);
    }

    function enterModeUI() {
      hideTopbarMenu();
      setUploadFormLayout(controls, false);
      setPdfImportLayout(controls, false);
      resetAll();
      controls.overlay.style.display = 'block';
      controls.popup.style.display = 'block';
    }

    function exitModeUI() {
      generation++;
      setUploadFormLayout(controls, false);
      setPdfImportLayout(controls, false);
      controls.overlay.style.display = 'none';
      controls.popup.style.display = 'none';
      controls.pdfInput.value = '';
      controls.photoInput.value = '';
      resetAll();
    }

    function showPopup() {
      if (isEditMode()) {
        showToast('Sluit eerst de bewerkingsmodus', 'error');
        return;
      }
      if (!modeController.isInteractiveView()) {
        showToast('Sluit eerst het huidige scherm', 'error');
        return;
      }
      modeController.enter(modes.UPLOAD);
    }

    function hidePopup() {
      if (saving) return;
      if (modeController.isAny([modes.UPLOAD, modes.UPLOAD_SAVING])) {
        modeController.enter(modes.VIEW);
      } else {
        exitModeUI();
      }
    }

    function handlePhotoChange(event) {
      const file = event.target.files[0];
      if (!file) return;
      if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
        showToast('Bestand is te groot (max 20 MB)', 'error');
        return;
      }

      const runGeneration = ++generation;
      const img = new global.Image();
      img.onload = () => {
        if (runGeneration !== generation) return;
        try {
          const result = resizeImageToCanvas(img, 2000);
          const dataUrl = canvasToUploadJPEG(result.canvas, {
            errorMessage: 'Afbeelding te groot. Probeer een kleinere foto.',
          });
          showPreview(elements, dataUrl, result.width, result.height);
        } catch (err) {
          showToast(err.message, 'error');
        } finally {
          global.URL.revokeObjectURL(img.src);
        }
      };
      img.src = global.URL.createObjectURL(file);
    }

    async function handlePdfChange(event) {
      const file = event.target.files[0];
      if (!file) return;
      if (file.size > MAX_PDF_UPLOAD_BYTES) {
        showToast('PDF is te groot (max 50 MB)', 'error');
        return;
      }

      const pdfjsLib = getPdfJsLib();
      if (!pdfjsLib) {
        showToast('PDF library niet geladen. Gebruik een foto.', 'error');
        return;
      }

      const runGeneration = ++generation;
      resetPdfState(elements);
      showPdfProcessing(elements, controls, file.name);
      try {
        const pdfService = FD.PdfImportService;
        const pdf = await pdfService.loadPdfDocument(pdfjsLib, file);
        if (runGeneration !== generation) return;

        elements.pdfState.file = file;
        elements.pdfState.pdf = pdf;
        elements.pdfState.pages = Array.from({ length: pdf.numPages }, (_, index) => ({
          pageNumber: index + 1,
          selected: true,
          thumbnailDataUrl: '',
          editDataUrl: '',
          outputWidth: 0,
          outputHeight: 0,
          floorplanName: pdfService.suggestedFloorplanName(file.name, index + 1),
          floorLabel: pdfService.suggestedFloorplanName(file.name, index + 1),
          edited: false,
          status: 'rendering',
          error: '',
        }));

        hide(elements.pdfProcessing);
        show(elements.pdfOverview, 'flex');
        renderPdfPages(elements);

        for (let index = 0; index < elements.pdfState.pages.length; index++) {
          const page = elements.pdfState.pages[index];
          if (runGeneration !== generation) return;
          try {
            const thumb = await pdfService.renderPdfPageToCanvas(pdf, page.pageNumber, {
              scale: pdfService.THUMB_RENDER_SCALE,
            });
            page.thumbnailDataUrl = thumb.canvas.toDataURL('image/jpeg', 0.7);
            page.status = 'ready';
          } catch (err) {
            page.status = 'error';
            page.error = 'Voorbeeld mislukt';
          }
          updatePdfPageCard(elements, page);
          if (index >= 5) await browserYield();
        }
      } catch (err) {
        if (runGeneration !== generation) return;
        resetPdfState(elements);
        setPdfImportLayout(controls, false);
        showChooseStep(elements);
        controls.pdfInput.value = '';
        showToast(err.message || 'PDF kon niet worden geladen', 'error');
      }
    }

    async function ensurePdfPageUploadImage(page) {
      if (page.editDataUrl && page.outputWidth && page.outputHeight) {
        return {
          dataUrl: page.editDataUrl,
          width: page.outputWidth,
          height: page.outputHeight,
        };
      }

      const pdfService = FD.PdfImportService;
      const result = await pdfService.renderPdfPageToCanvas(elements.pdfState.pdf, page.pageNumber, {
        scale: pdfService.UPLOAD_RENDER_SCALE,
      });
      const dataUrl = pdfService.canvasToUploadJPEG(result.canvas, {
        errorMessage: `Pagina ${page.pageNumber} is te groot. Crop de pagina kleiner of probeer een lagere kwaliteit PDF.`,
      });
      page.outputWidth = result.width;
      page.outputHeight = result.height;
      return { dataUrl, width: result.width, height: result.height };
    }

    function restoreActivePdfEditorState() {
      const state = elements.pdfState;
      if (!state.activePage) return;
      state.activePage.cropData = clonePdfCropData(state.activeOriginalCropData);
    }

    function clearActivePdfEditorState() {
      const state = elements.pdfState;
      state.activePage = null;
      state.activeOriginalCropData = null;
      state.pdfEditorRotation = 0;
    }

    function showPdfOverview({ discardEditorChanges = true } = {}) {
      if (discardEditorChanges) restoreActivePdfEditorState();
      destroyPdfCropper(elements.pdfState);
      clearActivePdfEditorState();
      setPdfUploadProgress(elements, { visible: false, value: 0 });
      hide(elements.pdfProcessing);
      hide(elements.pdfEditor);
      hide(elements.pdfForm);
      show(elements.pdfOverview, 'flex');
      elements.pdfTitle.textContent = "Pagina's kiezen";
      elements.pdfErrorEl.textContent = '';
      renderPdfPages(elements);
    }

    function rememberActivePdfCrop() {
      const state = elements.pdfState;
      if (!state.cropper || !state.activePage || state.suppressCropSync) return;
      state.activePage.cropData = currentPdfCropData(state, elements);
      setPdfEditorDataset(elements, state);
    }

    function zoomActivePdfPage(multiplier) {
      const state = elements.pdfState;
      if (!state.cropper || !state.activePage) return;
      const cropData = state.activePage.cropData || currentPdfCropData(state, elements) || fullPdfCropData(state.cropper, elements.pdfEditorImg);
      const currentRatio = currentPdfZoomRatio(state);
      const fitRatio = state.pdfFitZoomRatio || currentRatio || 1;
      if (!currentRatio) return;
      const targetRatio = Math.max(fitRatio, Math.min(fitRatio * 5, currentRatio * multiplier));
      state.activePage.cropData = cropData;
      state.suppressCropSync = true;
      if (state.suppressCropSyncTimer) clearTimeout(state.suppressCropSyncTimer);
      if (targetRatio < currentRatio) relaxPdfCropBoxForZoomOut(state);
      state.cropper.zoomTo(targetRatio);
      restorePdfCropAfterViewportChange(state, elements, cropData);
    }

    function fitActivePdfPage() {
      const state = elements.pdfState;
      if (!state.cropper || !state.activePage) return;
      const cropData = state.activePage.cropData || currentPdfCropData(state, elements) || fullPdfCropData(state.cropper, elements.pdfEditorImg);
      state.activePage.cropData = cropData;
      state.suppressCropSync = true;
      if (state.suppressCropSyncTimer) clearTimeout(state.suppressCropSyncTimer);
      state.cropper.reset();
      if (state.pdfEditorRotation && typeof state.cropper.rotateTo === 'function') state.cropper.rotateTo(state.pdfEditorRotation);
      fitPdfCropperCanvas(state);
      applyPdfCropBoxFromData(state, cropData);
      state.pdfFitZoomRatio = currentPdfZoomRatio(state);
      state.activePage.cropData = cropData;
      setPdfEditorDataset(elements, state);
      requestAnimationFrame(() => {
        if (!state.cropper || !state.activePage) return;
        applyPdfCropBoxFromData(state, cropData);
        state.activePage.cropData = cropData;
        setPdfEditorDataset(elements, state);
        state.suppressCropSyncTimer = setTimeout(() => {
          if (state.cropper && state.activePage) {
            applyPdfCropBoxFromData(state, cropData);
            state.activePage.cropData = cropData;
            setPdfEditorDataset(elements, state);
          }
          state.suppressCropSync = false;
          state.suppressCropSyncTimer = null;
        }, 140);
      });
    }

    async function openPdfEditor(pageNumber) {
      if (typeof Cropper === 'undefined') {
        showToast('Crop-tool kon niet worden geladen', 'error');
        return;
      }

      const state = elements.pdfState;
      const page = state.pages.find(item => item.pageNumber === pageNumber);
      if (!page || !state.pdf) return;

      const runId = ++state.activeEditorRun;
      state.activePage = page;
      state.pdfEditorRotation = 0;
      state.activeOriginalCropData = clonePdfCropData(page.cropData);
      state.suppressCropSync = false;
      destroyPdfCropper(state);
      hide(elements.pdfOverview);
      hide(elements.pdfForm);
      show(elements.pdfEditor, 'flex');
      elements.pdfTitle.textContent = `Pagina ${page.pageNumber} bewerken`;
      elements.pdfSummary.textContent = 'Crop of roteer de pagina en sla daarna op.';
      elements.pdfEditorTitle.textContent = `Pagina ${page.pageNumber}`;
      elements.pdfEditorSaveButton.disabled = true;
      elements.pdfEditorSaveButton.textContent = 'Laden...';
      setPdfEditorLoading(elements, true);

      try {
        let dataUrl = page.editDataUrl;
        if (!dataUrl) {
          const rendered = await FD.PdfImportService.renderPdfPageToCanvas(state.pdf, page.pageNumber, {
            scale: FD.PdfImportService.UPLOAD_RENDER_SCALE,
          });
          dataUrl = FD.PdfImportService.canvasToUploadJPEG(rendered.canvas, {
            errorMessage: `Pagina ${page.pageNumber} is te groot. Probeer een kleinere uitsnede.`,
          });
        }
        if (runId !== state.activeEditorRun) return;

        const img = elements.pdfEditorImg;
        img.onload = () => {
          if (runId !== state.activeEditorRun) return;
          constrainPdfEditorImageToHandles(elements);
          destroyPdfCropper(state);
          state.cropper = new Cropper(img, {
            viewMode: 1,
            autoCropArea: 1,
            dragMode: 'move',
            background: false,
            movable: true,
            zoomable: true,
            zoomOnWheel: false,
            zoomOnTouch: false,
            scalable: false,
            rotatable: true,
            cropBoxMovable: true,
            cropBoxResizable: true,
            toggleDragModeOnDblclick: false,
            responsive: true,
            restore: false,
            guides: true,
            crop() {
              rememberActivePdfCrop();
            },
            ready() {
              if (runId !== state.activeEditorRun || !state.cropper) return;
              requestAnimationFrame(() => {
                if (runId !== state.activeEditorRun || !state.cropper) return;
                resetPdfCropperToPage(state, elements);
                setTimeout(() => {
                  if (runId !== state.activeEditorRun || !state.cropper) return;
                  setPdfEditorLoading(elements, false);
                  elements.pdfEditorSaveButton.disabled = false;
                  elements.pdfEditorSaveButton.textContent = 'Opslaan';
                }, 220);
              });
            },
          });
        };
        img.onerror = () => {
          elements.pdfEditorSaveButton.textContent = 'Opslaan';
          setPdfEditorLoading(elements, false);
          showToast('Pagina kon niet worden geopend', 'error');
          showPdfOverview();
        };
        img.removeAttribute('src');
        img.src = dataUrl;
      } catch (err) {
        page.status = 'error';
        page.error = err.message || 'Bewerken mislukt';
        setPdfEditorLoading(elements, false);
        showToast(page.error, 'error');
        showPdfOverview();
      }
    }

    function rotateActivePdfPage(direction) {
      const state = elements.pdfState;
      const cropper = state.cropper;
      if (!cropper || !state.activePage) return;
      state.pdfEditorRotation = (state.pdfEditorRotation + direction * 90 + 360) % 360;
      requestAnimationFrame(() => {
        if (!state.cropper || !state.activePage) return;
        resetPdfCropperToPage(state, elements);
        showToast('Controleer de uitsnede na roteren', 'success');
      });
    }

    async function saveActivePdfPageEdit() {
      const state = elements.pdfState;
      const page = state.activePage;
      if (!page || !state.cropper) return;

      elements.pdfEditorSaveButton.disabled = true;
      elements.pdfEditorSaveButton.textContent = 'Opslaan...';
      try {
        const cropData = page.cropData || currentPdfCropData(state, elements) || fullPdfCropData(state.cropper, elements.pdfEditorImg);
        applyPdfCropData(state, elements, cropData);
        const outputCanvas = state.cropper.getCroppedCanvas({
          fillColor: '#fff',
          imageSmoothingEnabled: true,
          imageSmoothingQuality: 'high',
        });
        const dataUrl = FD.PdfImportService.canvasToUploadJPEG(outputCanvas, {
          errorMessage: `Pagina ${page.pageNumber} is te groot. Maak de uitsnede kleiner.`,
        });
        page.editDataUrl = dataUrl;
        page.outputWidth = outputCanvas.width;
        page.outputHeight = outputCanvas.height;
        page.cropData = { x: 0, y: 0, width: outputCanvas.width, height: outputCanvas.height };
        page.thumbnailDataUrl = await FD.PdfImportService.dataUrlToThumbnail(dataUrl);
        page.edited = true;
        page.status = 'ready';
        page.error = '';
        showToast(`Pagina ${page.pageNumber} bewerkt`, 'success');
        showPdfOverview({ discardEditorChanges: false });
      } catch (err) {
        elements.pdfEditorSaveButton.disabled = false;
        elements.pdfEditorSaveButton.textContent = 'Opslaan';
        showToast(err.message || 'Bewerken mislukt', 'error');
      }
    }

    function showPdfFormForCurrentCustomers() {
      const pages = selectedPdfPages(elements.pdfState);
      if (!pages.length) {
        showToast('Selecteer minimaal 1 pagina', 'error');
        return;
      }
      populateCustomerSelect(elements.pdfCustomerSelect, currentCustomers());
      elements.pdfCustomerSelect.style.display = '';
      elements.pdfNewCustomerWrapper.style.display = 'none';
      elements.pdfNewCustomerInput.value = '';
      if (elements.pdfBuildingNameInput) elements.pdfBuildingNameInput.value = '';
      elements.pdfErrorEl.textContent = '';
      hide(elements.pdfOverview);
      hide(elements.pdfEditor);
      show(elements.pdfForm, 'flex');
      setPdfUploadProgress(elements, { visible: false, value: 0 });
      elements.pdfTitle.textContent = 'Gegevens invullen';
      elements.pdfSummary.textContent = `${pages.length} plattegrond${pages.length === 1 ? '' : 'en'} klaar voor bulk upload.`;
      renderPdfNameRows(elements);
    }

    function handlePdfCustomerChange() {
      if (elements.pdfCustomerSelect.value === NEW_CUSTOMER_VALUE) {
        elements.pdfCustomerSelect.style.display = 'none';
        elements.pdfNewCustomerWrapper.style.display = 'block';
        elements.pdfNewCustomerInput.focus();
      }
    }

    function showPdfCustomerSelect() {
      elements.pdfNewCustomerWrapper.style.display = 'none';
      elements.pdfCustomerSelect.style.display = '';
      elements.pdfCustomerSelect.value = '';
      elements.pdfNewCustomerInput.value = '';
    }

    async function savePdfBatchUpload() {
      if (saving) return;
      const selectedPages = selectedPdfPages(elements.pdfState);
      const pagesToUpload = selectedPages.filter(page => page.status !== 'uploaded');
      if (!pagesToUpload.length) {
        elements.pdfErrorEl.textContent = 'Alle geselecteerde pagina\'s zijn al geupload.';
        return;
      }
      const customers = currentCustomers();
      let customerValue = elements.pdfCustomerSelect.value;
      let newCustomerName = elements.pdfNewCustomerInput.value;
      if (elements.pdfState.batchCustomerName) {
        const customerIndex = customers.findIndex(customer => customer.customer === elements.pdfState.batchCustomerName);
        if (customerIndex >= 0) {
          customerValue = String(customerIndex);
          newCustomerName = '';
        }
      }
      const form = validatePdfBatchForm({
        customerValue,
        newCustomerName,
        buildingName: elements.pdfBuildingNameInput?.value || '',
        pages: pagesToUpload,
        customers,
      });
      if (!form.ok) {
        elements.pdfErrorEl.textContent = form.error;
        return;
      }

      saving = true;
      modeController.enter(modes.UPLOAD_SAVING);
      controls.pdfSaveButton.disabled = true;
      elements.pdfErrorEl.textContent = '';
      let isNewCustomer = form.isNewCustomer;
      let result = null;
      const totalUnits = Math.max(1, form.pages.length * 4);
      const updateBatchProgress = (pageIndex, phase, text) => {
        const units = Math.min(totalUnits, pageIndex * 4 + phase);
        setPdfUploadProgress(elements, {
          visible: true,
          value: (units / totalUnits) * 100,
          text,
        });
      };
      updateBatchProgress(0, 0, `Upload voorbereiden (0/${form.pages.length})`);

      try {
        for (let index = 0; index < form.pages.length; index++) {
          const page = form.pages[index];
          page.status = 'uploading';
          page.error = '';
          controls.pdfSaveButton.textContent = `Uploaden ${index + 1}/${form.pages.length}...`;
          updateBatchProgress(index, 0, `Pagina ${index + 1}/${form.pages.length} voorbereiden...`);
          renderPdfNameRows(elements);

          const image = await ensurePdfPageUploadImage(page);
          updateBatchProgress(index, 1, `Pagina ${index + 1}/${form.pages.length} verwerken...`);
          const svgText = FD.PdfImportService.buildUploadSVGText({
            imageDataUrl: image.dataUrl,
            width: image.width,
            height: image.height,
          });
          const fileName = sanitizeFilename(`${form.customerName} ${page.floorplanName}`, Date.now() + index) + '.svg';
          updateBatchProgress(index, 2, `Pagina ${index + 1}/${form.pages.length} uploaden...`);
          result = await onSave({
            form: {
              customerName: form.customerName,
              floorplanName: page.floorplanName,
              buildingName: form.buildingName,
              floorLabel: page.floorLabel,
              isNewCustomer,
            },
            fileName,
            svgText,
          });
          isNewCustomer = false;
          elements.pdfState.batchCustomerName = form.customerName;
          page.status = 'uploaded';
          page.error = '';
          elements.pdfState.latestResult = result;
          elements.pdfState.latestUploadedPage = page;
          updateBatchProgress(index, 4, `Pagina ${index + 1}/${form.pages.length} klaar`);
          renderPdfNameRows(elements);
        }
      } catch (err) {
        const failedIndex = form.pages.findIndex(page => page.status === 'uploading');
        const failed = failedIndex >= 0 ? form.pages[failedIndex] : null;
        if (failed) {
          failed.status = 'error';
          failed.error = err.message || 'Upload mislukt';
        }
        setPdfUploadProgress(elements, {
          visible: true,
          value: Math.max(0, (Math.max(0, failedIndex) * 4) / totalUnits * 100),
          text: failed ? `Upload gestopt bij pagina ${failed.pageNumber}` : 'Upload gestopt',
        });
        elements.pdfErrorEl.textContent = `Upload gestopt: ${err.message || 'onbekende fout'}. Eerder gelukte pagina's blijven staan.`;
        renderPdfNameRows(elements);
        return;
      } finally {
        controls.pdfSaveButton.textContent = 'Bulk uploaden';
        controls.pdfSaveButton.disabled = false;
        saving = false;
        if (modeController.is(modes.UPLOAD_SAVING)) modeController.enter(modes.UPLOAD);
      }

      const uploadedCount = form.pages.length;
      setPdfUploadProgress(elements, {
        visible: true,
        value: 100,
        text: `${uploadedCount} van ${uploadedCount} geupload`,
      });
      const lastUploadedPage = elements.pdfState.latestUploadedPage || form.pages[form.pages.length - 1];
      hidePopup();
      showToast(`${uploadedCount} plattegrond${uploadedCount === 1 ? '' : 'en'} toegevoegd`, 'success');
      onSaved({
        result,
        form: {
          customerName: form.customerName,
          floorplanName: lastUploadedPage.floorplanName,
        },
        batch: true,
        pages: form.pages,
      });
    }

    function showFormForCurrentCustomers() {
      showForm(elements, currentCustomers());
      setUploadFormLayout(controls, true);
    }

    function retakeUpload() {
      setUploadFormLayout(controls, false);
      setPdfImportLayout(controls, false);
      resetPdfState(elements);
      showChooseStep(elements);
      controls.pdfInput.value = '';
      controls.photoInput.value = '';
    }

    function handleCustomerChange() {
      if (elements.customerSelect.value === NEW_CUSTOMER_VALUE) showNewCustomerInput(elements);
    }

    async function saveUpload() {
      const customers = currentCustomers();
      const form = validateUploadForm({
        customerValue: elements.customerSelect.value,
        newCustomerName: elements.newCustomerInput.value,
        buildingName: elements.buildingNameInput?.value || '',
        floorplanName: elements.floorplanNameInput.value,
        customers,
      });
      if (!form.ok) {
        elements.errorEl.textContent = form.error;
        return;
      }

      const svgText = buildUploadSVGText({
        imageDataUrl: elements.imageState.dataUrl,
        width: elements.imageState.width,
        height: elements.imageState.height,
      });
      const fileName = sanitizeFilename(form.customerName + ' ' + form.floorplanName) + '.svg';

      controls.saveButton.textContent = 'Opslaan...';
      controls.saveButton.disabled = true;
      elements.errorEl.textContent = '';
      saving = true;
      modeController.enter(modes.UPLOAD_SAVING);

      let result;
      try {
        result = await onSave({ form, fileName, svgText });
      } catch (err) {
        elements.errorEl.textContent = 'Fout: ' + err.message;
        return;
      } finally {
        controls.saveButton.textContent = 'Opslaan';
        controls.saveButton.disabled = false;
        saving = false;
        if (modeController.is(modes.UPLOAD_SAVING)) modeController.enter(modes.UPLOAD);
      }

      hidePopup();
      showToast('Plattegrond toegevoegd', 'success');
      onSaved({ result, form, fileName });
    }

    function showFullscreenPreview() {
      if (!elements.previewImg.src || !controls.fullscreenImage || !controls.fullscreenOverlay) return;
      controls.fullscreenImage.src = elements.previewImg.src;
      controls.fullscreenOverlay.style.display = 'block';
    }

    function hideFullscreenPreview() {
      if (controls.fullscreenOverlay) controls.fullscreenOverlay.style.display = 'none';
    }

    function bind() {
      if (bound) return;
      bound = true;
      controls.openButton.addEventListener('click', showPopup);
      controls.pdfButton.addEventListener('click', () => controls.pdfInput.click());
      controls.photoButton.addEventListener('click', () => controls.photoInput.click());
      controls.cancelChooseButton.addEventListener('click', hidePopup);
      controls.retakeButton.addEventListener('click', retakeUpload);
      controls.acceptButton.addEventListener('click', showFormForCurrentCustomers);
      controls.saveButton.addEventListener('click', saveUpload);
      controls.cancelFormButton.addEventListener('click', hidePopup);
      controls.overlay.addEventListener('click', hidePopup);
      controls.photoInput.addEventListener('change', handlePhotoChange);
      controls.pdfInput.addEventListener('change', handlePdfChange);
      elements.customerSelect.addEventListener('pointerdown', () => prepareCustomerSelectInteraction(elements, controls));
      elements.customerSelect.addEventListener('touchstart', () => prepareCustomerSelectInteraction(elements, controls), { passive: true });
      elements.customerSelect.addEventListener('mousedown', () => prepareCustomerSelectInteraction(elements, controls));
      elements.customerSelect.addEventListener('change', handleCustomerChange);
      controls.backToSelectButton.addEventListener('click', () => showCustomerSelect(elements));
      if (controls.pdfCloseButton) controls.pdfCloseButton.addEventListener('click', hidePopup);
      if (controls.pdfRetakeButton) controls.pdfRetakeButton.addEventListener('click', retakeUpload);
      if (controls.pdfSelectAllButton) controls.pdfSelectAllButton.addEventListener('click', () => {
        elements.pdfState.pages.forEach(page => { page.selected = true; });
        renderPdfPages(elements);
      });
      if (controls.pdfSelectNoneButton) controls.pdfSelectNoneButton.addEventListener('click', () => {
        elements.pdfState.pages.forEach(page => { page.selected = false; });
        renderPdfPages(elements);
      });
      if (controls.pdfNextButton) controls.pdfNextButton.addEventListener('click', showPdfFormForCurrentCustomers);
      if (controls.pdfFormBackButton) controls.pdfFormBackButton.addEventListener('click', showPdfOverview);
      if (controls.pdfEditorBackButton) controls.pdfEditorBackButton.addEventListener('click', showPdfOverview);
      if (controls.pdfEditorCancelButton) controls.pdfEditorCancelButton.addEventListener('click', showPdfOverview);
      if (controls.pdfEditorSaveButton) controls.pdfEditorSaveButton.addEventListener('click', saveActivePdfPageEdit);
      if (controls.pdfZoomOutButton) controls.pdfZoomOutButton.addEventListener('click', () => zoomActivePdfPage(1 / 1.2));
      if (controls.pdfZoomFitButton) controls.pdfZoomFitButton.addEventListener('click', fitActivePdfPage);
      if (controls.pdfZoomInButton) controls.pdfZoomInButton.addEventListener('click', () => zoomActivePdfPage(1.2));
      if (controls.pdfRotateLeftButton) controls.pdfRotateLeftButton.addEventListener('click', () => rotateActivePdfPage(-1));
      if (controls.pdfRotateRightButton) controls.pdfRotateRightButton.addEventListener('click', () => rotateActivePdfPage(1));
      if (elements.pdfCustomerSelect) elements.pdfCustomerSelect.addEventListener('change', handlePdfCustomerChange);
      if (controls.pdfBackToSelectButton) controls.pdfBackToSelectButton.addEventListener('click', showPdfCustomerSelect);
      if (controls.pdfSaveButton) controls.pdfSaveButton.addEventListener('click', savePdfBatchUpload);
      elements.previewImg.style.cursor = 'zoom-in';
      elements.previewImg.addEventListener('click', showFullscreenPreview);
      if (controls.fullscreenCloseButton) {
        controls.fullscreenCloseButton.addEventListener('click', hideFullscreenPreview);
      }
    }

    elements.openPdfEditor = openPdfEditor;

    return {
      bind,
      enterModeUI,
      exitModeUI,
      hidePopup,
      isSaving: () => saving,
      showPopup,
    };
  }

  function createUploadedFloorplanActionsController({
    controls,
    getSelectedFloorplan,
    modeController,
    isEditMode = () => false,
    hideTopbarMenu = () => {},
    showToast = () => {},
    requestTopbarUpdate = () => {},
    onDelete,
  }) {
    let bound = false;
    const deleteDialog = FD.UIShellService.createPopupPair({
      overlayEl: controls.deleteOverlay,
      popupEl: controls.deletePopup,
    });

    function getSelection() {
      return typeof getSelectedFloorplan === 'function' ? getSelectedFloorplan() : {};
    }

    function updateButtons() {
      const { floorplan } = getSelection();
      FD.UIShellService.updateUploadActionButtons({
        deleteButtonEl: controls.deleteButton,
        editImageButtonEl: controls.editImageButton,
        metadataButtonEl: controls.metadataButton,
        floorplan,
      });
      requestTopbarUpdate();
    }

    function showDeleteConfirm() {
      if (isEditMode()) {
        showToast('Sluit eerst de bewerkingsmodus', 'error');
        return;
      }
      if (!modeController.isInteractiveView()) {
        showToast('Sluit eerst het huidige scherm', 'error');
        return;
      }
      hideTopbarMenu();
      const { floorplan } = getSelection();
      if (!floorplan) return;
      controls.deleteMessage.textContent = 'Weet je zeker dat je "' + floorplan.name + '" wilt verwijderen?';
      deleteDialog.show();
    }

    function hideDeleteConfirm() {
      deleteDialog.hide();
    }

    async function confirmDelete() {
      const { customer, floorplan } = getSelection();
      if (!customer || !floorplan) return;
      hideDeleteConfirm();

      try {
        await onDelete({ customer, floorplan });
        updateButtons();
        showToast('Plattegrond verwijderd', 'success');
      } catch (err) {
        showToast('Verwijderen mislukt: ' + err.message, 'error');
      }
    }

    function bind() {
      if (bound) return;
      bound = true;
      controls.deleteButton.addEventListener('click', showDeleteConfirm);
      controls.deleteConfirmButton.addEventListener('click', confirmDelete);
      controls.deleteCancelButton.addEventListener('click', hideDeleteConfirm);
      controls.deleteOverlay.addEventListener('click', hideDeleteConfirm);
    }

    return {
      bind,
      hideDeleteConfirm,
      showDeleteConfirm,
      updateButtons,
    };
  }

  FD.UploadService = {
    MAX_IMAGE_UPLOAD_BYTES,
    MAX_PDF_UPLOAD_BYTES,
    MAX_UPLOAD_BYTES: MAX_IMAGE_UPLOAD_BYTES,
    NEW_CUSTOMER_VALUE,
    buildUploadSVGText,
    canvasToUploadJPEG,
    createUploadedFloorplanActionsController,
    createUploadController,
    populateCustomerSelect,
    resetFormState,
    resetPreviewState,
    resizeImageToCanvas,
    sanitizeFilename,
    showChooseStep,
    showCustomerSelect,
    showForm,
    showNewCustomerInput,
    showPdfProcessing,
    showPreview,
    validateUploadForm,
  };
})(window);
