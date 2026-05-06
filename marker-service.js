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

  function getDoorId(marker) {
    const id = marker.getAttribute('id') || '';
    const label = marker.getAttributeNS('http://www.inkscape.org/namespaces/inkscape', 'label') || '';
    if (/^(ellipse|circle)\d+$/i.test(id) && label) return label;
    return id || label;
  }

  function isIgnoredDoorId(doorId) {
    return !doorId || /^(defs|namedview|image)\d*$/i.test(doorId);
  }

  function prepareInteractiveMarker(marker, doorId) {
    marker.dataset.doorId = doorId;
    marker.style.cursor = 'pointer';
    marker.style.pointerEvents = 'all';
    marker.style.transition = 'opacity 0.2s';
    marker.style.stroke = 'transparent';
    marker.style.strokeWidth = '20';
  }

  function setMarkerCode(marker, doorId) {
    marker.setAttribute('id', doorId);
    marker.setAttributeNS('http://www.inkscape.org/namespaces/inkscape', 'label', doorId);
    marker.dataset.doorId = doorId;
  }

  function setMarkerRadius(marker, radius) {
    marker.setAttribute('rx', radius.toString());
    marker.setAttribute('ry', radius.toString());
  }

  function setMarkerPosition(marker, x, y) {
    marker.setAttribute('cx', Math.round(x).toString());
    marker.setAttribute('cy', Math.round(y).toString());
  }

  function markerPosition(marker) {
    const cx = parseFloat(marker.getAttribute('cx'));
    const cy = parseFloat(marker.getAttribute('cy'));
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
    return { x: cx, y: cy };
  }

  function clearRuntimeMarkerState(marker) {
    marker.style.fill = '';
    marker.style.opacity = '';
    marker.style.cursor = '';
    marker.style.pointerEvents = '';
    marker.style.transition = '';
    marker.style.stroke = '';
    marker.style.strokeWidth = '';
    marker.style.filter = '';
    marker.removeAttribute('data-door-id');
  }

  function allMarkers(root) {
    return Array.from(root?.querySelectorAll?.('[data-door-id]') || []);
  }

  function findMarkerByDoorId(root, doorId) {
    return allMarkers(root).find(marker => marker.dataset.doorId === doorId) || null;
  }

  function markerExists(root, doorId) {
    return !!findMarkerByDoorId(root, doorId);
  }

  function createEllipseMarker({ doorId, x, y, radius, fill = '#1a73e8', opacity = '0.7' }) {
    const ns = 'http://www.w3.org/2000/svg';
    const inkNs = 'http://www.inkscape.org/namespaces/inkscape';
    const ellipse = document.createElementNS(ns, 'ellipse');
    ellipse.setAttribute('id', doorId);
    ellipse.setAttributeNS(inkNs, 'inkscape:label', doorId);
    ellipse.setAttribute('cx', Math.round(x));
    ellipse.setAttribute('cy', Math.round(y));
    ellipse.setAttribute('rx', radius.toString());
    ellipse.setAttribute('ry', radius.toString());
    ellipse.style.fill = fill;
    ellipse.style.opacity = opacity;
    return ellipse;
  }

  function addChange(doorId) {
    return { type: 'add', doorId };
  }

  function deleteChange(marker, doorId) {
    return {
      type: 'delete',
      doorId,
      element: marker,
      parent: marker.parentNode,
      nextSibling: marker.nextSibling,
    };
  }

  function renameChange(oldId, newId) {
    return { type: 'rename', oldId, newId };
  }

  function resizeChange(doorId, oldRx) {
    return { type: 'resize', doorId, oldRx };
  }

  function moveChange(doorId, oldCx, oldCy) {
    return { type: 'move', doorId, oldCx, oldCy };
  }

  function restoreDeletedMarker(change, fallbackParent) {
    const parent = change.parent && change.parent.isConnected ? change.parent : fallbackParent;
    if (!parent) return null;

    if (change.nextSibling && change.nextSibling.parentNode === parent) {
      parent.insertBefore(change.element, change.nextSibling);
    } else {
      parent.appendChild(change.element);
    }
    return parent;
  }

  function revertEditChange(change, root, { initMarker } = {}) {
    if (!change) return;
    if (change.type === 'add') {
      const marker = findMarkerByDoorId(root, change.doorId);
      if (marker) marker.remove();
      return;
    }

    if (change.type === 'delete') {
      const svgEl = root?.querySelector?.('svg') || root;
      restoreDeletedMarker(change, svgEl);
      if (typeof initMarker === 'function') initMarker(change.element, change.doorId);
      return;
    }

    if (change.type === 'rename') {
      const marker = findMarkerByDoorId(root, change.newId);
      if (marker) setMarkerCode(marker, change.oldId);
      return;
    }

    if (change.type === 'resize') {
      const marker = findMarkerByDoorId(root, change.doorId);
      if (marker) setMarkerRadius(marker, change.oldRx);
      return;
    }

    if (change.type === 'move') {
      const marker = findMarkerByDoorId(root, change.doorId);
      if (marker) setMarkerPosition(marker, change.oldCx, change.oldCy);
    }
  }

  function revertEditChanges(changes, root, options) {
    Array.from(changes || []).reverse().forEach(change => revertEditChange(change, root, options));
  }

  function serializeCleanSVG(svgEl, serializer = new XMLSerializer()) {
    if (!svgEl) throw new Error('Geen SVG gevonden');
    const svgClone = svgEl.cloneNode(true);
    svgClone.querySelectorAll('[data-door-id]').forEach(marker => clearRuntimeMarkerState(marker));
    svgClone.querySelectorAll('[data-fd-label]').forEach(el => el.remove());
    return serializer.serializeToString(svgClone);
  }

  function nextAutoCode(markers, prefix, padding) {
    if (!prefix) return '';
    let max = 0;
    Array.from(markers || []).forEach(marker => {
      const id = marker.dataset?.doorId || '';
      if (!id.startsWith(prefix)) return;
      const suffix = id.slice(prefix.length);
      if (!/^\d+$/.test(suffix)) return;
      const n = parseInt(suffix, 10);
      if (n > max) max = n;
    });
    return prefix + String(max + 1).padStart(padding, '0');
  }

  function boxesOverlap(a, b) {
    return a.left < b.right &&
           a.right > b.left &&
           a.top < b.bottom &&
           a.bottom > b.top;
  }

  function markerBox(marker, padding = 0) {
    const cx = parseFloat(marker.getAttribute('cx')) || 0;
    const cy = parseFloat(marker.getAttribute('cy')) || 0;
    const rx = parseFloat(marker.getAttribute('rx')) || parseFloat(marker.getAttribute('r')) || 10;
    const ry = parseFloat(marker.getAttribute('ry')) || parseFloat(marker.getAttribute('r')) || rx;
    return {
      left: cx - rx - padding,
      right: cx + rx + padding,
      top: cy - ry - padding,
      bottom: cy + ry + padding,
    };
  }

  function labelMetrics(scale = 1) {
    const currentScale = scale || 1;
    const fontSize = Math.max(5, Math.min(120, 16 / currentScale));
    const strokeWidth = Math.max(1, 3 / currentScale);
    const padding = Math.max(1, 3 / currentScale);
    const labelGap = Math.max(6 / currentScale, strokeWidth + padding + 4 / currentScale);
    return { currentScale, fontSize, strokeWidth, padding, labelGap };
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

  function labelBounds(svgEl) {
    if (!svgEl) return null;
    const vb = svgEl.viewBox.baseVal;
    if (vb.width && vb.height) {
      return { x: vb.x, y: vb.y, width: vb.width, height: vb.height };
    }
    return editableBounds(svgEl);
  }

  function labelPlacements(markers, { scale = 1, activeDoorId = '', bounds = null } = {}) {
    const { currentScale, fontSize, strokeWidth, padding, labelGap } = labelMetrics(scale);
    const placedBoxes = [];
    const orderedMarkers = Array.from(markers || [])
      .filter(marker => marker?.dataset?.doorId)
      .sort((a, b) => {
        const aActive = a.dataset.doorId === activeDoorId ? 1 : 0;
        const bActive = b.dataset.doorId === activeDoorId ? 1 : 0;
        return bActive - aActive;
      });

    const clampY = (value) => bounds
      ? Math.max(bounds.y + fontSize, Math.min(bounds.y + bounds.height - fontSize * 0.25, value))
      : value;

    const fitCandidateToBounds = (candidate, estimatedWidth) => {
      const left = candidate.anchor === 'end'
        ? candidate.x - estimatedWidth
        : candidate.anchor === 'middle'
          ? candidate.x - estimatedWidth / 2
          : candidate.x;
      const right = left + estimatedWidth;
      const top = candidate.y - fontSize;
      const bottom = candidate.y + fontSize * 0.25;
      const fitted = {
        ...candidate,
        box: { left: left - padding, right: right + padding, top: top - padding, bottom: bottom + padding },
      };
      if (!bounds) return fitted;

      let dx = 0;
      let dy = 0;
      if (fitted.box.left < bounds.x) dx = bounds.x - fitted.box.left;
      if (fitted.box.right + dx > bounds.x + bounds.width) dx = bounds.x + bounds.width - fitted.box.right;
      if (fitted.box.top < bounds.y) dy = bounds.y - fitted.box.top;
      if (fitted.box.bottom + dy > bounds.y + bounds.height) dy = bounds.y + bounds.height - fitted.box.bottom;
      if (!dx && !dy) return fitted;
      return {
        ...fitted,
        x: fitted.x + dx,
        y: fitted.y + dy,
        box: {
          left: fitted.box.left + dx,
          right: fitted.box.right + dx,
          top: fitted.box.top + dy,
          bottom: fitted.box.bottom + dy,
        },
      };
    };

    const placements = [];
    orderedMarkers.forEach(marker => {
      const cx = parseFloat(marker.getAttribute('cx')) || 0;
      const cy = parseFloat(marker.getAttribute('cy')) || 0;
      const rx = parseFloat(marker.getAttribute('rx')) || 10;
      const ry = parseFloat(marker.getAttribute('ry')) || rx;
      const labelText = marker.dataset.doorId;
      const estimatedWidth = labelText.length * fontSize * 0.62;
      const active = labelText === activeDoorId;
      const markerPadding = Math.max(padding * 2, 6 / currentScale);
      const ownMarkerBox = {
        left: cx - rx,
        right: cx + rx,
        top: cy - ry,
        bottom: cy + ry,
      };
      const markerBoxes = [ownMarkerBox].concat(
        orderedMarkers
          .filter(other => other !== marker)
          .map(other => markerBox(other, markerPadding))
      );
      const candidates = [
        { anchor: 'start', x: cx + rx + labelGap, y: clampY(cy + fontSize * 0.4) },
        { anchor: 'end', x: cx - rx - labelGap, y: clampY(cy + fontSize * 0.4) },
        { anchor: 'middle', x: cx, y: clampY(cy - ry - labelGap) },
        { anchor: 'middle', x: cx, y: clampY(cy + ry + labelGap + fontSize) },
        { anchor: 'start', x: cx + rx + labelGap, y: clampY(cy - ry - labelGap) },
        { anchor: 'start', x: cx + rx + labelGap, y: clampY(cy + ry + labelGap + fontSize) },
        { anchor: 'end', x: cx - rx - labelGap, y: clampY(cy - ry - labelGap) },
        { anchor: 'end', x: cx - rx - labelGap, y: clampY(cy + ry + labelGap + fontSize) },
      ].map(candidate => fitCandidateToBounds(candidate, estimatedWidth));
      const chosen = candidates.find(candidate =>
        !placedBoxes.some(box => boxesOverlap(candidate.box, box)) &&
        !markerBoxes.some(box => boxesOverlap(candidate.box, box))
      ) || (active ? candidates.find(candidate => !markerBoxes.some(box => boxesOverlap(candidate.box, box))) : null);

      if (!chosen) return;
      placedBoxes.push(chosen.box);
      placements.push({
        text: labelText,
        x: chosen.x,
        y: chosen.y,
        anchor: chosen.anchor,
        fontSize,
        strokeWidth,
        box: chosen.box,
      });
    });
    return placements;
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
    getDoorId,
    isIgnoredDoorId,
    prepareInteractiveMarker,
    setMarkerCode,
    setMarkerRadius,
    setMarkerPosition,
    markerPosition,
    clearRuntimeMarkerState,
    allMarkers,
    findMarkerByDoorId,
    markerExists,
    createEllipseMarker,
    addChange,
    deleteChange,
    renameChange,
    resizeChange,
    moveChange,
    restoreDeletedMarker,
    revertEditChange,
    revertEditChanges,
    serializeCleanSVG,
    nextAutoCode,
    editableBounds,
    labelBounds,
    labelPlacements,
    clampPosition,
    pointInsideBounds,
    maxRadiusAtPosition,
  };
})(window);
