(function (global) {
  const FD = global.FD = global.FD || {};

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

  function canvasToLimitedJPEG(canvas, {
    maxLength = 1040000,
    startQuality = 0.86,
    minQuality = 0.38,
    qualityStep = 0.08,
  } = {}) {
    let quality = startQuality;
    let dataUrl;
    do {
      dataUrl = canvas.toDataURL('image/jpeg', quality);
      quality -= qualityStep;
    } while (dataUrl.length > maxLength && quality > minQuality);

    if (dataUrl.length > maxLength) {
      throw new Error('Uitsnede is te groot. Maak de uitsnede kleiner.');
    }
    return dataUrl;
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
    markerDoorCode,
    markerFitsInsideCrop,
    buildCropSavePlan,
    canvasToLimitedJPEG,
    buildCroppedSVGText,
  };
})(window);
