(function (global) {
  const FD = global.FD = global.FD || {};

  function fitToBounds({ containerWidth, containerHeight, overlayHeight = 0, contentWidth, contentHeight, margin = 0.92 }) {
    const availableWidth = containerWidth;
    const availableHeight = containerHeight - overlayHeight;
    const scaleX = availableWidth / contentWidth;
    const scaleY = availableHeight / contentHeight;
    const scale = Math.min(scaleX, scaleY) * margin;

    return {
      scale,
      panX: (availableWidth - contentWidth * scale) / 2,
      panY: overlayHeight + (availableHeight - contentHeight * scale) / 2,
    };
  }

  function clampPan({ panX, panY, scale, contentWidth, contentHeight, containerWidth, containerHeight, overlayHeight = 0 }) {
    const renderedWidth = contentWidth * scale;
    const renderedHeight = contentHeight * scale;
    const minVisibleX = Math.min(160, Math.max(64, containerWidth * 0.14));
    const minVisibleY = Math.min(160, Math.max(64, containerHeight * 0.14));

    const minPanX = minVisibleX - renderedWidth;
    const maxPanX = containerWidth - minVisibleX;
    const minPanY = overlayHeight + minVisibleY - renderedHeight;
    const maxPanY = containerHeight - minVisibleY;

    return {
      panX: Math.max(minPanX, Math.min(maxPanX, panX)),
      panY: Math.max(minPanY, Math.min(maxPanY, panY)),
    };
  }

  function clientToSvgPoint({ clientX, clientY, containerLeft, containerTop, panX, panY, scale, viewBoxX = 0, viewBoxY = 0 }) {
    return {
      x: viewBoxX + ((clientX - containerLeft - panX) / scale),
      y: viewBoxY + ((clientY - containerTop - panY) / scale),
    };
  }

  function zoomAtPoint({ pointX, pointY, panX, panY, scale, nextScale }) {
    return {
      scale: nextScale,
      panX: pointX - (pointX - panX) * (nextScale / scale),
      panY: pointY - (pointY - panY) * (nextScale / scale),
    };
  }

  function touchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function touchCenter(touches) {
    return {
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
    };
  }

  FD.ViewportService = {
    fitToBounds,
    clampPan,
    clientToSvgPoint,
    zoomAtPoint,
    touchDistance,
    touchCenter,
  };
})(window);
