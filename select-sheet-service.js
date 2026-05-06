(function (global) {
  const FD = global.FD = global.FD || {};

  function getSelectedOptionText(selectEl, fallback) {
    if (!selectEl?.value) return fallback;
    return selectEl.options[selectEl.selectedIndex]?.textContent || fallback;
  }

  function renderSelectOptions(selectEl, placeholder, items, labelForItem) {
    if (!selectEl) return;
    selectEl.innerHTML = '';
    const placeholderOption = document.createElement('option');
    placeholderOption.value = '';
    placeholderOption.textContent = placeholder;
    selectEl.appendChild(placeholderOption);

    items.forEach((item, index) => {
      const opt = document.createElement('option');
      opt.value = index;
      opt.textContent = labelForItem(item);
      selectEl.appendChild(opt);
    });
  }

  function renderCustomerOptions(selectEl, customers) {
    renderSelectOptions(selectEl, '-- Kies klant --', customers || [], customer => customer.customer);
  }

  function renderFloorplanOptions(selectEl, floorplans) {
    renderSelectOptions(selectEl, '-- Kies plattegrond --', floorplans || [], floorplan => floorplan.name);
    if (selectEl) selectEl.disabled = false;
  }

  function resetFloorplanOptions(selectEl, { disabled = true } = {}) {
    renderSelectOptions(selectEl, '-- Kies plattegrond --', [], () => '');
    if (selectEl) selectEl.disabled = disabled;
  }

  function selectedIndex(selectEl) {
    const index = parseInt(selectEl?.value, 10);
    return Number.isNaN(index) ? null : index;
  }

  function getSelectedFloorplan(customers, customerSelect, floorplanSelect) {
    const customerIndex = selectedIndex(customerSelect);
    const floorplanIndex = selectedIndex(floorplanSelect);
    if (customerIndex === null || floorplanIndex === null || !customers?.[customerIndex]) {
      return { customerIndex, floorplanIndex, customer: null, floorplan: null };
    }
    return {
      customerIndex,
      floorplanIndex,
      customer: customers[customerIndex],
      floorplan: customers[customerIndex].floorplans?.[floorplanIndex] || null,
    };
  }

  function setSheetDisplay(elements, visible) {
    elements.overlay.style.display = visible ? 'block' : 'none';
    elements.sheet.style.display = visible ? 'flex' : 'none';
  }

  function appendEmpty(listEl, text) {
    const empty = document.createElement('div');
    empty.className = 'select-sheet-empty';
    empty.textContent = text;
    listEl.appendChild(empty);
  }

  function createController({
    elements,
    getState,
    getItems,
    onSelect,
  }) {
    let activeType = null;

    function state() {
      return typeof getState === 'function' ? getState() : {};
    }

    function updatePickerButtons() {
      const { customerSelect, floorplanSelect, customerPickerBtn, floorplanPickerBtn, customerPickerValue, floorplanPickerValue } = elements;
      const { customersLoading = false } = state();

      customerPickerValue.textContent = customersLoading
        ? 'Klanten laden...'
        : getSelectedOptionText(customerSelect, 'Kies klant');
      floorplanPickerValue.textContent = getSelectedOptionText(floorplanSelect, 'Kies plattegrond');
      customerPickerBtn.disabled = customerSelect.disabled || customersLoading;
      floorplanPickerBtn.disabled = floorplanSelect.disabled || !customerSelect.value;
    }

    function renderItems() {
      const { customerSelect, floorplanSelect, search, list } = elements;
      list.innerHTML = '';
      if (!activeType) return;

      const { customersLoading = false } = state();
      if (activeType === 'customer' && customersLoading) {
        appendEmpty(list, 'Klanten laden...');
        return;
      }

      const query = search.value.trim().toLowerCase();
      const currentValue = activeType === 'customer' ? customerSelect.value : floorplanSelect.value;
      const typeAtRender = activeType;
      const items = (typeof getItems === 'function' ? getItems(typeAtRender) : [])
        .filter(item => item.label.toLowerCase().includes(query));

      if (!items.length) {
        appendEmpty(list, 'Geen resultaten');
        return;
      }

      items.forEach(item => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'select-sheet-item';
        if (String(item.index) === currentValue) btn.classList.add('selected');
        btn.textContent = item.label;
        btn.addEventListener('click', () => {
          if (typeof onSelect === 'function') onSelect(typeAtRender, item);
          close();
        });
        list.appendChild(btn);
      });
    }

    function open(type) {
      updatePickerButtons();
      const { customerPickerBtn, floorplanPickerBtn, eyebrow, title, search } = elements;
      const { customersLoading = false } = state();
      if (type === 'customer' && (customersLoading || customerPickerBtn.disabled)) return;
      if (type === 'floorplan' && floorplanPickerBtn.disabled) return;

      activeType = type;
      eyebrow.textContent = type === 'customer' ? 'Klant' : 'Plattegrond';
      title.textContent = type === 'customer' ? 'Kies klant' : 'Kies plattegrond';
      search.value = '';
      setSheetDisplay(elements, true);
      renderItems();
      setTimeout(() => search.focus(), 0);
    }

    function close() {
      setSheetDisplay(elements, false);
      activeType = null;
    }

    function isOpen(type) {
      return type ? activeType === type : Boolean(activeType);
    }

    return {
      close,
      getActiveType: () => activeType,
      isOpen,
      open,
      renderItems,
      updatePickerButtons,
    };
  }

  function createSelectionController({
    elements,
    getState,
    getItems,
    onCustomerChange,
    onFloorplanChange,
  }) {
    let bound = false;
    const sheetController = createController({
      elements,
      getState,
      getItems,
      onSelect: (type, item) => {
        if (type === 'customer') {
          elements.customerSelect.value = String(item.index);
          handleCustomerChange();
        } else {
          elements.floorplanSelect.value = String(item.index);
          handleFloorplanChange();
        }
      },
    });

    function handleCustomerChange() {
      sheetController.updatePickerButtons();
      if (typeof onCustomerChange === 'function') {
        onCustomerChange({
          value: elements.customerSelect.value,
          customerIndex: selectedIndex(elements.customerSelect),
        });
      }
    }

    function handleFloorplanChange() {
      sheetController.updatePickerButtons();
      if (typeof onFloorplanChange === 'function') {
        onFloorplanChange({
          value: elements.floorplanSelect.value,
          customerIndex: selectedIndex(elements.customerSelect),
          floorplanIndex: selectedIndex(elements.floorplanSelect),
        });
      }
    }

    function bind() {
      if (bound) return;
      bound = true;
      elements.customerPickerBtn.addEventListener('click', () => sheetController.open('customer'));
      elements.floorplanPickerBtn.addEventListener('click', () => sheetController.open('floorplan'));
      elements.search.addEventListener('input', sheetController.renderItems);
      elements.closeButton.addEventListener('click', sheetController.close);
      elements.overlay.addEventListener('click', sheetController.close);
      elements.customerSelect.addEventListener('change', handleCustomerChange);
      elements.floorplanSelect.addEventListener('change', handleFloorplanChange);
    }

    return {
      bind,
      close: sheetController.close,
      getActiveType: sheetController.getActiveType,
      isOpen: sheetController.isOpen,
      open: sheetController.open,
      renderItems: sheetController.renderItems,
      updatePickerButtons: sheetController.updatePickerButtons,
    };
  }

  FD.SelectSheetService = {
    createController,
    createSelectionController,
    getSelectedFloorplan,
    getSelectedOptionText,
    renderCustomerOptions,
    renderFloorplanOptions,
    resetFloorplanOptions,
    selectedIndex,
  };
})(window);
