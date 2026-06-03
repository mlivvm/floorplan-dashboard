(function (global) {
  const FD = global.FD = global.FD || {};
  const MAX_IMAGE_EDITOR_DATA_URL_LENGTH = 1560000;

  function markerDoorCode(marker) {
    return marker.dataset?.doorId || marker.getAttribute('id') || 'Onbekend';
  }

  function markerFitsInsideCrop(marker, cropX, cropY, cropW, cropH) {
    const cx = parseFloat(marker.getAttribute('cx'));
    const cy = parseFloat(marker.getAttribute('cy'));
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return false;

    const r = parseFloat(marker.getAttribute('r'));
    const rx = parseFloat(marker.getAttribute('rx'));
    const ry = parseFloat(marker.getAttribute('ry'));
    const radiusX = Number.isFinite(rx) ? rx : (Number.isFinite(r) ? r : 0);
    const radiusY = Number.isFinite(ry) ? ry : (Number.isFinite(r) ? r : 0);

    return cx - radiusX >= cropX &&
           cx + radiusX <= cropX + cropW &&
           cy - radiusY >= cropY &&
           cy + radiusY <= cropY + cropH;
  }

  function buildCropSavePlan({ cropData, naturalWidth, naturalHeight, cropContext, markers }) {
    if (!cropContext || !naturalWidth || !naturalHeight || !cropData) return null;
    if (cropData.width < 10 || cropData.height < 10) return null;

    const scaleX = cropContext.imgW / naturalWidth;
    const scaleY = cropContext.imgH / naturalHeight;
    const cropX = cropContext.imgX + cropData.x * scaleX;
    const cropY = cropContext.imgY + cropData.y * scaleY;
    const cropW = cropData.width * scaleX;
    const cropH = cropData.height * scaleY;
    const outsideDoorCodes = [];

    Array.from(markers || []).forEach(marker => {
      if (!markerFitsInsideCrop(marker, cropX, cropY, cropW, cropH)) {
        outsideDoorCodes.push(markerDoorCode(marker));
      }
    });

    return { cropData, cropX, cropY, cropW, cropH, outsideDoorCodes };
  }

  function imageEditorSizeError(message, details = {}) {
    const err = new Error(message);
    err.code = 'image_editor_too_large';
    Object.assign(err, details);
    return err;
  }

  function encodeCanvasJPEGWithinLength(canvas, {
    maxLength,
    startQuality = 0.86,
    minQuality = 0.38,
    qualityStep = 0.08,
  }) {
    const qualities = [];
    for (let quality = startQuality; quality > minQuality; quality -= qualityStep) {
      qualities.push(Math.round(quality * 100) / 100);
    }
    if (qualities[qualities.length - 1] !== minQuality) qualities.push(minQuality);

    let lastResult = null;
    for (const quality of qualities) {
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      lastResult = { dataUrl, quality };
      if (dataUrl.length <= maxLength) return lastResult;
    }
    return lastResult;
  }

  function resizeCanvas(canvas, scale, documentRef = document) {
    const width = Math.max(1, Math.round(canvas.width * scale));
    const height = Math.max(1, Math.round(canvas.height * scale));
    const output = documentRef.createElement('canvas');
    output.width = width;
    output.height = height;
    output.getContext('2d').drawImage(canvas, 0, 0, width, height);
    return output;
  }

  function canvasToLimitedJPEGResult(canvas, {
    maxLength = MAX_IMAGE_EDITOR_DATA_URL_LENGTH,
    startQuality = 0.86,
    minQuality = 0.38,
    qualityStep = 0.08,
    resizeStep = 0.9,
    minScale = 0.65,
    documentRef = document,
    errorMessage = 'Uitsnede is te groot. Maak de uitsnede kleiner.',
  } = {}) {
    const scales = [1];
    let nextScale = resizeStep;
    while (nextScale > minScale) {
      scales.push(Math.round(nextScale * 1000) / 1000);
      nextScale *= resizeStep;
    }
    if (scales[scales.length - 1] !== minScale) scales.push(minScale);

    let lastResult = null;
    for (const scale of scales) {
      const sourceCanvas = scale === 1 ? canvas : resizeCanvas(canvas, scale, documentRef);
      const result = encodeCanvasJPEGWithinLength(sourceCanvas, {
        maxLength,
        startQuality,
        minQuality,
        qualityStep,
      });
      lastResult = {
        dataUrl: result.dataUrl,
        width: sourceCanvas.width,
        height: sourceCanvas.height,
        scale,
        quality: result.quality,
        resized: scale < 1,
      };
      if (result.dataUrl.length <= maxLength) return lastResult;
    }

    throw imageEditorSizeError(errorMessage, {
      maxLength,
      estimatedLength: lastResult?.dataUrl?.length || 0,
      width: lastResult?.width || canvas.width,
      height: lastResult?.height || canvas.height,
      scale: lastResult?.scale || 1,
      quality: lastResult?.quality || minQuality,
    });
  }

  function canvasToLimitedJPEG(canvas, options = {}) {
    return canvasToLimitedJPEGResult(canvas, options).dataUrl;
  }

  function buildCroppedSVGText({
    svgEl,
    imageDataUrl,
    plan,
    markerService = FD.MarkerService,
    serializer = new XMLSerializer(),
  }) {
    if (!svgEl || !imageDataUrl || !plan || !markerService) {
      throw new Error('Crop-save data is incompleet.');
    }

    const width = Math.round(plan.cropW);
    const height = Math.round(plan.cropH);
    const svgClone = svgEl.cloneNode(true);
    svgClone.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svgClone.setAttribute('width', width.toString());
    svgClone.setAttribute('height', height.toString());

    const cloneImage = svgClone.querySelector('image');
    if (!cloneImage) throw new Error('Afbeelding ontbreekt in plattegrond.');
    cloneImage.setAttribute('href', imageDataUrl);
    cloneImage.removeAttributeNS('http://www.w3.org/1999/xlink', 'href');
    cloneImage.setAttribute('x', '0');
    cloneImage.setAttribute('y', '0');
    cloneImage.setAttribute('width', width.toString());
    cloneImage.setAttribute('height', height.toString());

    svgClone.querySelectorAll('[data-fd-label]').forEach(el => el.remove());
    svgClone.querySelectorAll('[data-door-id]').forEach(marker => {
      if (marker.getAttribute('data-fd-label')) return;
      const position = markerService.markerPosition(marker);
      if (!position) return;
      if (!markerFitsInsideCrop(marker, plan.cropX, plan.cropY, plan.cropW, plan.cropH)) {
        marker.remove();
        return;
      }
      markerService.setMarkerPosition(marker, position.x - plan.cropX, position.y - plan.cropY);
      markerService.clearRuntimeMarkerState(marker);
    });

    return serializer.serializeToString(svgClone);
  }

  FD.ImageEditorService = {
    MAX_IMAGE_EDITOR_DATA_URL_LENGTH,
    markerDoorCode,
    markerFitsInsideCrop,
    buildCropSavePlan,
    canvasToLimitedJPEG,
    canvasToLimitedJPEGResult,
    buildCroppedSVGText,
  };
})(window);
