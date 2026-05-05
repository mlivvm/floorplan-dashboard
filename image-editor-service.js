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

  FD.ImageEditorService = {
    markerDoorCode,
    markerFitsInsideCrop,
    buildCropSavePlan,
  };
})(window);
