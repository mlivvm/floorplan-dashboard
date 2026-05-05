(function (global) {
  const FD = global.FD = global.FD || {};

  function sliderRange(svgEl) {
    if (!svgEl) return { max: 30, def: 15 };
    const vb = svgEl.viewBox.baseVal;
    const shortest = Math.min(vb.width || 1000, vb.height || 1000);
    const max = Math.max(20, Math.min(150, Math.round(shortest * 0.03)));
    return { max, def: Math.round(max / 3) };
  }

  function markerRadius(marker, fallback = 10) {
    const rx = parseFloat(marker.getAttribute('rx')) || parseFloat(marker.getAttribute('r')) || fallback;
    const ry = parseFloat(marker.getAttribute('ry')) || parseFloat(marker.getAttribute('r')) || rx;
    return Math.max(rx, ry);
  }

  function editableBounds(svgEl) {
    if (!svgEl) return null;

    const imageBounds = Array.from(svgEl.querySelectorAll('image'))
      .map(img => {
        const x = parseFloat(img.getAttribute('x') || '0');
        const y = parseFloat(img.getAttribute('y') || '0');
        const width = parseFloat(img.getAttribute('width') || '');
        const height = parseFloat(img.getAttribute('height') || '');
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
        return { x, y, width, height };
      })
      .filter(Boolean);

    if (imageBounds.length) {
      const minX = Math.min(...imageBounds.map(b => b.x));
      const minY = Math.min(...imageBounds.map(b => b.y));
      const maxX = Math.max(...imageBounds.map(b => b.x + b.width));
      const maxY = Math.max(...imageBounds.map(b => b.y + b.height));
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }

    const vb = svgEl.viewBox.baseVal;
    if (!vb.width || !vb.height) return null;
    return { x: vb.x, y: vb.y, width: vb.width, height: vb.height };
  }

  function clampPosition(svgX, svgY, radius, bounds) {
    if (!bounds) return { x: svgX, y: svgY };
    const minX = bounds.x + radius;
    const minY = bounds.y + radius;
    const maxX = bounds.x + bounds.width - radius;
    const maxY = bounds.y + bounds.height - radius;

    if (minX > maxX || minY > maxY) {
      return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    }

    return {
      x: Math.max(minX, Math.min(maxX, svgX)),
      y: Math.max(minY, Math.min(maxY, svgY)),
    };
  }

  function pointInsideBounds(svgX, svgY, bounds) {
    if (!bounds) return false;
    return svgX >= bounds.x &&
           svgY >= bounds.y &&
           svgX <= bounds.x + bounds.width &&
           svgY <= bounds.y + bounds.height;
  }

  function maxRadiusAtPosition(marker, bounds) {
    if (!bounds) return Infinity;
    const cx = parseFloat(marker.getAttribute('cx')) || 0;
    const cy = parseFloat(marker.getAttribute('cy')) || 0;
    return Math.max(1, Math.floor(Math.min(
      cx - bounds.x,
      cy - bounds.y,
      bounds.x + bounds.width - cx,
      bounds.y + bounds.height - cy
    )));
  }

  FD.MarkerService = {
    sliderRange,
    markerRadius,
    editableBounds,
    clampPosition,
    pointInsideBounds,
    maxRadiusAtPosition,
  };
})(window);
