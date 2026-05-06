(function (global) {
  const FD = global.FD = global.FD || {};

  const NEW_CUSTOMER_VALUE = '__new__';
  const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
  const MAX_UPLOAD_DATA_URL_LENGTH = 1040000;

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
    elements.errorEl.textContent = '';
  }

  function resetFormState(elements) {
    elements.customerSelect.style.display = '';
    elements.newCustomerWrapper.style.display = 'none';
    elements.newCustomerInput.value = '';
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

  function showPdfProcessing(elements) {
    elements.stepChoose.style.display = 'none';
    elements.stepPreview.style.display = 'block';
    elements.previewImg.style.display = 'none';
    elements.previewTitle.textContent = 'PDF verwerken...';
    elements.previewRetakeBtn.style.display = 'none';
    elements.previewAcceptBtn.style.display = 'none';
  }

  function showChooseStep(elements) {
    elements.stepPreview.style.display = 'none';
    elements.stepChoose.style.display = 'block';
  }

  function populateCustomerSelect(selectEl, customers) {
    selectEl.innerHTML = '<option value="">-- Kies klant --</option>';

    const newOpt = document.createElement('option');
    newOpt.value = NEW_CUSTOMER_VALUE;
    newOpt.textContent = '➕ Nieuwe klant toevoegen';
    selectEl.appendChild(newOpt);

    customers.forEach((customer, index) => {
      const opt = document.createElement('option');
      opt.value = index;
      opt.textContent = customer.customer;
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

  async function renderPdfFirstPageToCanvas(pdfjsLib, file, { scale = 1.5, documentRef = document } = {}) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale });
    const canvas = documentRef.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return { canvas, width: viewport.width, height: viewport.height };
  }

  function validateUploadForm({
    customerValue,
    newCustomerName,
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

    const cleanFloorplanName = floorplanName.trim();
    if (!cleanFloorplanName) return { ok: false, error: 'Vul een naam in voor de plattegrond.' };

    if (!isNewCustomer) {
      const customer = customers[parseInt(customerValue, 10)];
      const existing = customer?.floorplans?.find(fp => fp.name === cleanFloorplanName);
      if (existing) return { ok: false, error: 'Deze plattegrondnaam bestaat al bij deze klant.' };
    }

    return {
      ok: true,
      customerName,
      floorplanName: cleanFloorplanName,
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

    function currentCustomers() {
      return typeof getCustomers === 'function' ? getCustomers() : [];
    }

    function resetAll() {
      resetPreviewState(elements);
      resetFormState(elements);
    }

    function enterModeUI() {
      hideTopbarMenu();
      resetAll();
      controls.overlay.style.display = 'block';
      controls.popup.style.display = 'block';
    }

    function exitModeUI() {
      generation++;
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
      if (file.size > MAX_UPLOAD_BYTES) {
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
      if (file.size > MAX_UPLOAD_BYTES) {
        showToast('Bestand is te groot (max 20 MB)', 'error');
        return;
      }

      const pdfjsLib = getPdfJsLib();
      if (!pdfjsLib) {
        showToast('PDF library niet geladen. Gebruik een foto.', 'error');
        return;
      }

      const runGeneration = ++generation;
      showPdfProcessing(elements);
      try {
        const result = await renderPdfFirstPageToCanvas(pdfjsLib, file);
        if (runGeneration !== generation) return;
        const dataUrl = canvasToUploadJPEG(result.canvas, {
          errorMessage: 'PDF te groot. Probeer een andere pagina of foto.',
        });
        showPreview(elements, dataUrl, result.width, result.height);
      } catch (err) {
        if (runGeneration !== generation) return;
        showChooseStep(elements);
        showToast(err.message === 'PDF te groot. Probeer een andere pagina of foto.' ? err.message : 'PDF kon niet worden geladen', 'error');
      }
    }

    function showFormForCurrentCustomers() {
      showForm(elements, currentCustomers());
    }

    function retakeUpload() {
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
      elements.customerSelect.addEventListener('change', handleCustomerChange);
      controls.backToSelectButton.addEventListener('click', () => showCustomerSelect(elements));
      elements.previewImg.style.cursor = 'zoom-in';
      elements.previewImg.addEventListener('click', showFullscreenPreview);
      if (controls.fullscreenCloseButton) {
        controls.fullscreenCloseButton.addEventListener('click', hideFullscreenPreview);
      }
    }

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
    MAX_UPLOAD_BYTES,
    NEW_CUSTOMER_VALUE,
    buildUploadSVGText,
    canvasToUploadJPEG,
    createUploadedFloorplanActionsController,
    createUploadController,
    populateCustomerSelect,
    renderPdfFirstPageToCanvas,
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
