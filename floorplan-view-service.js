(function (global) {
  const FD = global.FD = global.FD || {};

  function nextFrame() {
    return new Promise(resolve => {
      const raf = global.requestAnimationFrame || (cb => global.setTimeout(cb, 0));
      raf(resolve);
    });
  }

  function getConfiguredSvgSize(svgEl) {
    if (!svgEl) throw new Error('Geen geldig SVG bestand.');
    const vb = svgEl.viewBox?.baseVal;
    if (!vb?.width || !vb?.height) throw new Error('SVG heeft geen geldige viewBox.');

    svgEl.setAttribute('width', vb.width);
    svgEl.setAttribute('height', vb.height);
    svgEl.style.width = vb.width + 'px';
    svgEl.style.height = vb.height + 'px';
    return { width: vb.width, height: vb.height };
  }

  function createLoadController({
    elements,
    getSelection,
    fetchSvg,
    setLoadingState,
    onBeforeLoad,
    onSvgReady,
    onBeforeReveal,
    onRevalidated,
    onError,
    loadingDelayMs = 150,
  }) {
    let generation = 0;
    let loadingTimer = null;
    let activeController = null;

    function currentSelectionMatches(selection) {
      const current = typeof getSelection === 'function' ? getSelection() : {};
      return current.customerIndex === selection.customerIndex &&
        current.floorplanIndex === selection.floorplanIndex;
    }

    function isCurrent(runGeneration, selection) {
      return runGeneration === generation && currentSelectionMatches(selection);
    }

    function clearLoadingTimer() {
      if (loadingTimer) {
        global.clearTimeout(loadingTimer);
        loadingTimer = null;
      }
    }

    function clearContent() {
      const { svgContainer } = elements;
      svgContainer.style.display = 'none';
      svgContainer.style.visibility = '';
      svgContainer.innerHTML = '';
    }

    function abortActiveRequest() {
      if (activeController) {
        activeController.abort();
        activeController = null;
      }
    }

    function cancel() {
      generation++;
      clearLoadingTimer();
      abortActiveRequest();
    }

    async function renderSvg(svgText, context, runGeneration, selection, { revalidated = false } = {}) {
      const { svgContainer, loadingEl } = elements;
      if (!isCurrent(runGeneration, selection)) return false;

      if (revalidated) {
        svgContainer.style.visibility = 'hidden';
      } else {
        svgContainer.style.display = 'none';
      }

      svgContainer.innerHTML = svgText;
      const svgEl = svgContainer.querySelector('svg');
      if (!svgEl) throw new Error('Geen geldig SVG bestand.');

      loadingEl.classList.add('hidden');
      svgContainer.style.visibility = 'hidden';
      svgContainer.style.display = 'block';

      if (!revalidated) await nextFrame();
      if (!isCurrent(runGeneration, selection)) return false;

      const size = getConfiguredSvgSize(svgEl);
      if (typeof onSvgReady === 'function') {
        await onSvgReady({ svgEl, size, context, revalidated });
      }

      if (!revalidated) await nextFrame();
      if (!isCurrent(runGeneration, selection)) return false;

      if (typeof onBeforeReveal === 'function') {
        await onBeforeReveal({ svgEl, size, context, revalidated });
      }
      svgContainer.style.visibility = '';
      return true;
    }

    function showDelayedLoading(runGeneration, selection) {
      clearLoadingTimer();
      loadingTimer = global.setTimeout(() => {
        if (!isCurrent(runGeneration, selection)) return;
        clearContent();
        if (typeof setLoadingState === 'function') setLoadingState();
        elements.loadingEl.classList.remove('hidden');
      }, loadingDelayMs);
    }

    function showError(err, runGeneration, selection) {
      clearLoadingTimer();
      elements.svgContainer.style.visibility = '';
      if (!isCurrent(runGeneration, selection)) return;
      clearContent();
      elements.loadingEl.classList.remove('hidden');
      if (typeof onError === 'function') {
        onError(err);
      } else {
        elements.loadingEl.textContent = 'Fout: ' + err.message;
      }
    }

    async function load(context) {
      const selection = {
        customerIndex: String(context.customerIndex),
        floorplanIndex: String(context.floorplanIndex),
      };
      abortActiveRequest();
      activeController = new global.AbortController();
      const requestController = activeController;
      const runGeneration = ++generation;

      if (typeof onBeforeLoad === 'function') onBeforeLoad(context);
      showDelayedLoading(runGeneration, selection);

      try {
        const { svgText, revalidate } = await fetchSvg(context, { signal: requestController.signal });
        clearLoadingTimer();
        if (!isCurrent(runGeneration, selection)) return;

        await renderSvg(svgText, context, runGeneration, selection);

        if (revalidate) {
          revalidate.then(async newSvgText => {
            if (!newSvgText || !isCurrent(runGeneration, selection)) return;
            try {
              const rendered = await renderSvg(newSvgText, context, runGeneration, selection, { revalidated: true });
              if (rendered && typeof onRevalidated === 'function') onRevalidated(context);
            } catch {
              elements.svgContainer.style.visibility = '';
            }
          }).catch(() => {}).finally(() => {
            if (activeController === requestController) activeController = null;
          });
        } else if (activeController === requestController) {
          activeController = null;
        }
      } catch (err) {
        if (err?.name === 'AbortError') return;
        if (activeController === requestController) activeController = null;
        showError(err, runGeneration, selection);
      } finally {
        if (activeController === requestController && requestController.signal.aborted) {
          activeController = null;
        }
      }
    }

    return {
      cancel,
      clearContent,
      getGeneration: () => generation,
      load,
    };
  }

  FD.FloorplanViewService = {
    createLoadController,
    getConfiguredSvgSize,
  };
})(window);
