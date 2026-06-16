(function (global) {
  const FD = global.FD = global.FD || {};
  const LABEL_COLLATOR = new Intl.Collator('nl', {
    numeric: true,
    sensitivity: 'base',
  });
  const LOCATION_ALL_VALUE = '';
  const LOCATION_NONE_VALUE = '__fd_no_location__';
  const LOCATION_NONE_LABEL = 'Zonder locatie';
  const GROUP_NONE_VALUE = '__fd_no_group__';
  const GROUP_NONE_LABEL = 'Zonder groep';
  const ORGANIZER_NONE_VALUE = '__fd_no_organizer__';
  const ORGANIZER_NONE_LABEL = 'Zonder groep/locatie';
  const DIRECT_LOCATION_FILTER_LIMIT = 4;
  const COLLAPSIBLE_FLOORPLAN_LIMIT = 8;
  const UNKNOWN_FLOOR_RANK = 9999;
  const FLOOR_WORD_RANKS = new Map([
    ['kelder', -20],
    ['souterrain', -10],
    ['begane grond', 0],
    ['benedenverdieping', 0],
    ['bg', 0],
    ['parterre', 0],
    ['eerste', 1],
    ['tweede', 2],
    ['derde', 3],
    ['vierde', 4],
    ['vijfde', 5],
    ['zesde', 6],
    ['zevende', 7],
    ['achtste', 8],
    ['negende', 9],
    ['tiende', 10],
    ['dak', 90],
  ]);

  function getSelectedOptionText(selectEl, fallback) {
    if (!selectEl?.value) return fallback;
    return selectEl.options[selectEl.selectedIndex]?.textContent || fallback;
  }

  function sortLabelEntries(left, right) {
    const labelCompare = LABEL_COLLATOR.compare(left.label, right.label);
    return labelCompare || left.index - right.index;
  }

  function normalizeSortText(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ');
  }

  function floorRankFromText(value) {
    const text = normalizeSortText(value);
    if (!text) return UNKNOWN_FLOOR_RANK;

    for (const [word, rank] of FLOOR_WORD_RANKS.entries()) {
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
      if (new RegExp(`(^|\\b)${escaped}(\\b|$)`, 'i').test(text)) return rank;
    }

    const numbered = text.match(/(^|\b)(-?\d{1,2})(?:e|de|ste)?(?:\s*(?:verdieping|etage|vloer))?(\b|$)/i);
    if (!numbered) return UNKNOWN_FLOOR_RANK;
    const rank = parseInt(numbered[2], 10);
    return Number.isFinite(rank) ? rank : UNKNOWN_FLOOR_RANK;
  }

  function splitDisplayBaseAndFloor(label) {
    const text = String(label || '').trim();
    if (!text) return { baseLabel: '', floorLabel: '', floorRank: UNKNOWN_FLOOR_RANK };
    const parts = text.split(/\s+[-–—]\s+/).map(part => part.trim()).filter(Boolean);
    if (parts.length > 1) {
      const last = parts[parts.length - 1];
      const rank = floorRankFromText(last);
      if (rank !== UNKNOWN_FLOOR_RANK) {
        return {
          baseLabel: parts.slice(0, -1).join(' - '),
          floorLabel: last,
          floorRank: rank,
        };
      }
    }
    return { baseLabel: text, floorLabel: '', floorRank: UNKNOWN_FLOOR_RANK };
  }

  function floorplanSortKey(floorplan, labelOverride = '') {
    const displayLabel = String(labelOverride || floorplanDisplayName(floorplan)).trim();
    const building = floorplanLocationName(floorplan);
    const explicitFloor = String(floorplan?.floorLabel || '').trim();
    const parsed = splitDisplayBaseAndFloor(displayLabel);
    const floorLabel = explicitFloor || parsed.floorLabel;
    const floorRank = floorRankFromText(floorLabel);
    return {
      baseLabel: building || parsed.baseLabel || displayLabel,
      floorLabel,
      floorRank,
      displayLabel,
    };
  }

  function compareFloorplanSortKeys(left, right) {
    const baseCompare = LABEL_COLLATOR.compare(left.baseLabel, right.baseLabel);
    if (baseCompare) return baseCompare;
    if (left.floorRank !== right.floorRank) return left.floorRank - right.floorRank;
    const floorCompare = LABEL_COLLATOR.compare(left.floorLabel, right.floorLabel);
    if (floorCompare) return floorCompare;
    return LABEL_COLLATOR.compare(left.displayLabel, right.displayLabel);
  }

  function compareFloorplanDisplayOrder(leftFloorplan, rightFloorplan, leftLabel = '', rightLabel = '') {
    return compareFloorplanSortKeys(
      floorplanSortKey(leftFloorplan, leftLabel),
      floorplanSortKey(rightFloorplan, rightLabel)
    );
  }

  function sortedWithOriginalIndex(items, labelForItem) {
    const safeItems = Array.isArray(items) ? items : [];
    const labelFn = typeof labelForItem === 'function'
      ? labelForItem
      : item => item?.name || item?.customer || '';
    return safeItems
      .map((item, index) => ({
        item,
        index,
        label: String(labelFn(item, index) || '').trim(),
      }))
      .sort(sortLabelEntries);
  }

  function floorplanDisplayParts(floorplan) {
    const building = String(floorplan?.building || '').trim();
    const floorLabel = String(floorplan?.floorLabel || '').trim();
    const locationGroup = floorplanGroupName(floorplan);
    return { building, floorLabel, locationGroup };
  }

  function floorplanDisplayName(floorplan) {
    const { building, floorLabel } = floorplanDisplayParts(floorplan);
    if (building && floorLabel) return `${building} - ${floorLabel}`;
    return floorLabel || building || String(floorplan?.name || '').trim();
  }

  function floorplanLocationName(floorplan) {
    return String(floorplan?.building || '').trim();
  }

  function floorplanGroupName(floorplan) {
    return String(floorplan?.locationGroup || floorplan?.group || '').trim();
  }

  function normalizeLocationName(value) {
    return String(value || '').trim().toLowerCase();
  }

  function normalizeGroupName(value) {
    return String(value || '').trim().toLowerCase();
  }

  function floorplanGroupFilterValue(floorplan) {
    return floorplanGroupName(floorplan) || GROUP_NONE_VALUE;
  }

  function floorplanGroupFilterLabel(value) {
    return value === GROUP_NONE_VALUE ? GROUP_NONE_LABEL : String(value || '').trim();
  }

  function floorplanOrganizerValue(floorplan) {
    const group = floorplanGroupName(floorplan);
    if (group) return `group:${group}`;
    const location = floorplanLocationName(floorplan);
    if (location) return `location:${location}`;
    return ORGANIZER_NONE_VALUE;
  }

  function floorplanOrganizerLabel(value, fallback = '') {
    const text = String(value || '').trim();
    if (!text || text === ORGANIZER_NONE_VALUE) return ORGANIZER_NONE_LABEL;
    if (text.startsWith('group:') || text.startsWith('location:')) return text.slice(text.indexOf(':') + 1);
    return fallback || text;
  }

  function floorplanLocationFilterValue(floorplan) {
    return floorplanLocationName(floorplan) || LOCATION_NONE_VALUE;
  }

  function floorplanLocationFilterLabel(value) {
    return value === LOCATION_NONE_VALUE ? LOCATION_NONE_LABEL : String(value || '').trim();
  }

  function compareLocationValues(left, right) {
    const leftNone = left === LOCATION_NONE_VALUE;
    const rightNone = right === LOCATION_NONE_VALUE;
    if (leftNone !== rightNone) return leftNone ? 1 : -1;
    return LABEL_COLLATOR.compare(
      floorplanLocationFilterLabel(left),
      floorplanLocationFilterLabel(right)
    );
  }

  function buildLocationFilterOptions(items, options = {}) {
    const safeItems = Array.isArray(items) ? items : [];
    const counts = new Map();
    let hasRealLocation = false;
    safeItems.forEach(item => {
      const value = floorplanLocationFilterValue(item);
      if (value !== LOCATION_NONE_VALUE) hasRealLocation = true;
      counts.set(value, (counts.get(value) || 0) + 1);
    });
    if (!hasRealLocation) return [];

    const locationOptions = Array.from(counts.entries())
      .sort((left, right) => compareLocationValues(left[0], right[0]))
      .map(([value, count]) => ({
        value,
        label: floorplanLocationFilterLabel(value),
        count,
      }));

    return [
      {
        value: LOCATION_ALL_VALUE,
        label: options.allLabel || 'Alle locaties',
        count: safeItems.length,
      },
      ...locationOptions,
    ];
  }

  function buildGroupFilterOptions(items, options = {}) {
    const safeItems = Array.isArray(items) ? items : [];
    const counts = new Map();
    let hasRealGroup = false;
    safeItems.forEach(item => {
      const value = floorplanGroupFilterValue(item);
      if (value !== GROUP_NONE_VALUE) hasRealGroup = true;
      counts.set(value, (counts.get(value) || 0) + 1);
    });
    if (!hasRealGroup) return [];

    const groupOptions = Array.from(counts.entries())
      .sort((left, right) => {
        const leftNone = left[0] === GROUP_NONE_VALUE;
        const rightNone = right[0] === GROUP_NONE_VALUE;
        if (leftNone !== rightNone) return leftNone ? 1 : -1;
        return LABEL_COLLATOR.compare(
          floorplanGroupFilterLabel(left[0]),
          floorplanGroupFilterLabel(right[0])
        );
      })
      .map(([value, count]) => ({
        value,
        label: floorplanGroupFilterLabel(value),
        count,
      }));

    return [
      {
        value: LOCATION_ALL_VALUE,
        label: options.allLabel || 'Alle groepen',
        count: safeItems.length,
      },
      ...groupOptions,
    ];
  }

  function getCustomerLocationDetails(customer, locationName, locationGroup = '') {
    const normalized = normalizeLocationName(locationName);
    const normalizedGroup = normalizeGroupName(locationGroup);
    if (!normalized || !Array.isArray(customer?.locations)) return null;
    const exactLocation = normalizedGroup
      ? customer.locations.find(item =>
          normalizeLocationName(item?.name) === normalized &&
          normalizeGroupName(item?.locationGroup || item?.group) === normalizedGroup
        )
      : null;
    const location = exactLocation || customer.locations.find(item =>
      normalizeLocationName(item?.name) === normalized &&
      !normalizeGroupName(item?.locationGroup || item?.group)
    ) || customer.locations.find(item => normalizeLocationName(item?.name) === normalized);
    if (!location) return null;
    const address = String(location.address || '').trim();
    const note = String(location.note || '').trim();
    if (!address && !note) return null;
    return {
      name: String(location.name || locationName || '').trim(),
      locationGroup: String(location.locationGroup || location.group || locationGroup || '').trim(),
      address,
      note,
    };
  }

  function getFloorplanLocationDetails(customer, floorplan) {
    const details = getCustomerLocationDetails(
      customer,
      floorplanLocationName(floorplan),
      floorplanGroupName(floorplan)
    );
    if (details) return details;

    const address = String(floorplan?.locationAddress || floorplan?.address || '').trim();
    const note = String(floorplan?.locationNote || floorplan?.note || '').trim();
    if (!address && !note) return null;
    return {
      name: floorplanLocationName(floorplan) || 'Locatie',
      locationGroup: floorplanGroupName(floorplan),
      address,
      note,
    };
  }

  function renderSelectOptions(selectEl, placeholder, items, labelForItem) {
    if (!selectEl) return;
    selectEl.innerHTML = '';
    const placeholderOption = document.createElement('option');
    placeholderOption.value = '';
    placeholderOption.textContent = placeholder;
    selectEl.appendChild(placeholderOption);

    sortedWithOriginalIndex(items, labelForItem).forEach(({ index, label }) => {
      const opt = document.createElement('option');
      opt.value = String(index);
      opt.textContent = label;
      selectEl.appendChild(opt);
    });
  }

  function renderCustomerOptions(selectEl, customers) {
    renderSelectOptions(selectEl, '-- Kies klant --', customers || [], customer => customer.customer);
  }

  function renderFloorplanOptions(selectEl, floorplans, options = {}) {
    const labelForItem = typeof options.labelForItem === 'function'
      ? options.labelForItem
      : floorplan => floorplan.name;
    renderSelectOptions(selectEl, '-- Kies plattegrond --', floorplans || [], labelForItem);
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

  function appendGroupHeader(listEl, text) {
    const header = document.createElement('div');
    header.className = 'select-sheet-group-header';
    header.textContent = text;
    listEl.appendChild(header);
  }

  function appendCollapseButton(listEl, group, expanded, onToggle) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'select-sheet-collapse-button';
    button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    const label = document.createElement('span');
    label.className = 'select-sheet-collapse-label';
    label.textContent = group.label;
    const meta = document.createElement('span');
    meta.className = 'select-sheet-collapse-meta';
    meta.textContent = `${group.items.length} plattegrond${group.items.length === 1 ? '' : 'en'}`;
    button.append(label, meta);
    button.addEventListener('click', onToggle);
    listEl.appendChild(button);
  }

  function setOptionalText(el, text) {
    if (!el) return;
    const value = String(text || '').trim();
    el.textContent = value;
    el.hidden = !value;
  }

  function createController({
    elements,
    getState,
    getItems,
    getFilters,
    getFilterGroups,
    getFilterLabel,
    getFilterValue,
    getPickerMeta,
    onFilterChange,
    onSelect,
  }) {
    let activeType = null;
    let activeFilterKey = '';
    const expandedGroups = new Set();

    function state() {
      return typeof getState === 'function' ? getState() : {};
    }

    function filterValueForType(type) {
      return typeof getFilterValue === 'function' ? String(getFilterValue(type) || '') : '';
    }

    function filterGroupsForType(type) {
      if (typeof getFilterGroups !== 'function') return [];
      return (getFilterGroups(type) || [])
        .map(group => {
          const key = String(group?.key || group?.type || '').trim();
          const options = Array.isArray(group?.options) ? group.options : [];
          if (!key || !options.length) return null;
          const value = group.value !== undefined
            ? String(group.value || '')
            : filterValueForType(key);
          const current = options.find(option => String(option.value || '') === value) || options[0];
          return {
            key,
            label: String(group.label || '').trim() || 'Filter',
            value,
            current,
            options,
          };
        })
        .filter(Boolean);
    }

    function hasFilterGroups(type) {
      return filterGroupsForType(type).length > 0;
    }

    function activeFilterGroup() {
      const groups = filterGroupsForType('floorplan');
      return groups.find(group => group.key === activeFilterKey) || groups[0] || null;
    }

    function updatePickerButtons() {
      const {
        customerSelect,
        floorplanSelect,
        customerPickerBtn,
        floorplanPickerBtn,
        customerPickerValue,
        floorplanPickerValue,
        customerPickerMeta,
        floorplanPickerMeta,
      } = elements;
      const { customersLoading = false } = state();

      customerPickerValue.textContent = customersLoading
        ? 'Klanten laden...'
        : getSelectedOptionText(customerSelect, 'Kies klant');
      floorplanPickerValue.textContent = getSelectedOptionText(floorplanSelect, 'Kies plattegrond');
      setOptionalText(customerPickerMeta, typeof getPickerMeta === 'function' ? getPickerMeta('customer') : '');
      setOptionalText(floorplanPickerMeta, typeof getPickerMeta === 'function' ? getPickerMeta('floorplan') : '');
      customerPickerBtn.disabled = customerSelect.disabled || customersLoading;
      floorplanPickerBtn.disabled = floorplanSelect.disabled || !customerSelect.value;
    }

    function renderFilters() {
      const filterEl = elements.filters;
      if (!filterEl) return;
      filterEl.innerHTML = '';
      if (activeType !== 'floorplan') {
        filterEl.hidden = true;
        filterEl.classList.remove('select-sheet-filters--chips');
        filterEl.classList.remove('select-sheet-filters--buttons');
        return;
      }

      const filterGroups = filterGroupsForType(activeType);
      if (filterGroups.length) {
        filterEl.hidden = false;
        filterEl.classList.remove('select-sheet-filters--chips');
        filterEl.classList.add('select-sheet-filters--buttons');
        filterGroups.forEach(group => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'select-sheet-location-button';
          const label = document.createElement('span');
          label.className = 'select-sheet-location-label';
          label.textContent = group.label;
          const value = document.createElement('span');
          value.className = 'select-sheet-location-value';
          value.textContent = `${group.current?.label || 'Alles'} (${group.current?.count || 0})`;
          button.append(label, value);
          if (group.current?.description) {
            const description = document.createElement('span');
            description.className = 'select-sheet-location-description';
            description.textContent = group.current.description;
            button.appendChild(description);
          }
          button.addEventListener('click', () => {
            activeFilterKey = group.key;
            open('location');
          });
          filterEl.appendChild(button);
        });
        return;
      }

      if (typeof getFilters !== 'function') {
        filterEl.hidden = true;
        filterEl.classList.remove('select-sheet-filters--chips');
        filterEl.classList.remove('select-sheet-filters--buttons');
        return;
      }

      const filters = getFilters(activeType) || [];
      if (!filters.length) {
        filterEl.hidden = true;
        filterEl.classList.remove('select-sheet-filters--chips');
        filterEl.classList.remove('select-sheet-filters--buttons');
        return;
      }

      const currentValue = filterValueForType(activeType);
      const currentFilter = filters.find(filter => String(filter.value || '') === currentValue) || filters[0];
      const filterLabel = typeof getFilterLabel === 'function' ? getFilterLabel(activeType) : 'Locatie';
      filterEl.hidden = false;
      filterEl.classList.toggle('select-sheet-filters--chips', filters.length <= DIRECT_LOCATION_FILTER_LIMIT);
      filterEl.classList.remove('select-sheet-filters--buttons');

      if (filters.length <= DIRECT_LOCATION_FILTER_LIMIT) {
        filters.forEach(filter => {
          const value = String(filter.value || '');
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'select-sheet-filter-chip';
          button.classList.toggle('active', value === currentValue);
          const label = document.createElement('span');
          label.textContent = filter.label;
          const count = document.createElement('span');
          count.className = 'select-sheet-filter-count';
          count.textContent = String(filter.count || 0);
          button.append(label, count);
          button.addEventListener('click', () => {
            if (typeof onFilterChange === 'function') onFilterChange(activeType, value);
            renderFilters();
            renderItems();
          });
          filterEl.appendChild(button);
        });
        return;
      }

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'select-sheet-location-button';
      const label = document.createElement('span');
      label.className = 'select-sheet-location-label';
      label.textContent = filterLabel || 'Locatie';
      const value = document.createElement('span');
      value.className = 'select-sheet-location-value';
      value.textContent = `${currentFilter?.label || 'Alles'} (${currentFilter?.count || 0})`;
      button.append(label, value);
      if (currentFilter?.description) {
        const description = document.createElement('span');
        description.className = 'select-sheet-location-description';
        description.textContent = currentFilter.description;
        button.appendChild(description);
      }
      button.addEventListener('click', () => {
        open('location');
      });
      filterEl.appendChild(button);
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
      const locationFilterGroup = activeType === 'location' ? activeFilterGroup() : null;
      const legacyLocationFilters = activeType === 'location' && !locationFilterGroup && typeof getFilters === 'function'
        ? (getFilters('floorplan') || [])
        : [];
      const rawLocationFilterOptions = locationFilterGroup?.options || legacyLocationFilters;
      const currentValue = activeType === 'customer'
        ? customerSelect.value
        : (activeType === 'floorplan'
          ? floorplanSelect.value
          : (locationFilterGroup?.value ?? filterValueForType('floorplan')));
      const locationFilterOptions = activeType === 'location' && currentValue === ''
        ? rawLocationFilterOptions.filter(option => String(option.value || '') !== '')
        : rawLocationFilterOptions;
      const typeAtRender = activeType;
      const filterGroups = typeAtRender === 'floorplan' ? filterGroupsForType(typeAtRender) : [];
      const hasSpecificFilter = filterGroups.some(group => Boolean(group.value));
      const activeFilter = typeAtRender === 'floorplan' && !filterGroups.length ? filterValueForType(typeAtRender) : '';
      const baseItems = typeAtRender === 'location' && locationFilterOptions.length
        ? locationFilterOptions.map((option, index) => ({
            index,
            value: option.value,
            label: option.label,
            meta: `${option.count || 0} plattegrond${option.count === 1 ? '' : 'en'}`,
            description: option.description || '',
            searchText: [option.label, option.description].filter(Boolean).join(' '),
            filterKey: locationFilterGroup?.key || '',
          }))
        : (typeof getItems === 'function' ? getItems(typeAtRender) : []);
      const items = baseItems
        .filter(item => {
          if (query && item.isRecent) return false;
          if (typeAtRender === 'floorplan' && filterGroups.length) {
            const filterValues = item.filterValues || {};
            const matchesAll = filterGroups.every(group =>
              !group.value || String(filterValues[group.key] || '') === group.value
            );
            if (!matchesAll) return false;
          }
          if (activeFilter && item.filterValue !== activeFilter) return false;
          const searchText = String(item.searchText || `${item.label || ''} ${item.meta || ''}`).toLowerCase();
          return !query || searchText.includes(query);
        });

      if (!items.length) {
        appendEmpty(list, 'Geen resultaten');
        return;
      }

      const renderItemButton = (item) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'select-sheet-item';
        const itemValue = typeAtRender === 'location' ? String(item.value || '') : String(item.index);
        if (itemValue === currentValue) btn.classList.add('selected');
        if (item.readOnly) btn.classList.add('readonly');
        const label = document.createElement('span');
        label.textContent = item.label;
        btn.appendChild(label);
        if (item.description) {
          const description = document.createElement('span');
          description.className = 'select-sheet-item-description';
          description.textContent = item.description;
          btn.appendChild(description);
        }
        if (item.meta) {
          const meta = document.createElement('span');
          meta.className = 'select-sheet-item-meta';
          meta.textContent = item.meta;
          btn.appendChild(meta);
        }
        btn.addEventListener('click', () => {
          if (typeof onSelect === 'function') onSelect(typeAtRender, item);
          if (activeType === typeAtRender) close();
        });
        list.appendChild(btn);
      };

      const collapsibleItemCount = items.filter(item => !item.isRecent && item.collapsibleGroupKey).length;
      const canCollapseGroups = typeAtRender === 'floorplan' &&
        !query &&
        !activeFilter &&
        !hasSpecificFilter &&
        collapsibleItemCount > COLLAPSIBLE_FLOORPLAN_LIMIT &&
        items.some(item => !item.isRecent && item.collapsibleGroupKey);

      if (canCollapseGroups) {
        const recentItems = items.filter(item => item.isRecent);
        const normalItems = items.filter(item => !item.isRecent);
        if (recentItems.length) {
          appendGroupHeader(list, 'Recent');
          recentItems.forEach(renderItemButton);
          appendGroupHeader(list, 'Alle plattegronden');
        }

        const groups = [];
        const groupByKey = new Map();
        normalItems.forEach(item => {
          const key = String(item.collapsibleGroupKey || '');
          const label = String(item.collapsibleGroupLabel || item.groupLabel || '').trim();
          if (!key || !label) {
            renderItemButton(item);
            return;
          }
          if (!groupByKey.has(key)) {
            const group = { key, label, items: [] };
            groupByKey.set(key, group);
            groups.push(group);
          }
          groupByKey.get(key).items.push(item);
        });

        groups.forEach(group => {
          const expanded = expandedGroups.has(group.key);
          appendCollapseButton(list, group, expanded, () => {
            if (expandedGroups.has(group.key)) {
              expandedGroups.delete(group.key);
            } else {
              expandedGroups.add(group.key);
            }
            renderItems();
          });
          if (expanded) group.items.forEach(renderItemButton);
        });
        return;
      }

      let lastGroupLabel = null;
      items.forEach(item => {
        if (typeAtRender === 'floorplan' && !activeFilter && item.groupLabel && item.groupLabel !== lastGroupLabel) {
          lastGroupLabel = item.groupLabel;
          appendGroupHeader(list, item.groupLabel);
        }
        renderItemButton(item);
      });
    }

    function open(type) {
      updatePickerButtons();
      const { customerPickerBtn, floorplanPickerBtn, eyebrow, title, search } = elements;
      const { customersLoading = false } = state();
      if (type === 'customer' && (customersLoading || customerPickerBtn.disabled)) return;
      if (type === 'floorplan' && floorplanPickerBtn.disabled) return;
      if (type === 'location' && !hasFilterGroups('floorplan') &&
        !(typeof getFilters === 'function' && (getFilters('floorplan') || []).length)) return;

      if (activeType !== type) expandedGroups.clear();
      activeType = type;
      const activeGroup = type === 'location' ? activeFilterGroup() : null;
      const filterLabel = activeGroup?.label ||
        (typeof getFilterLabel === 'function' ? getFilterLabel('floorplan') : 'Locatie');
      const normalizedFilterLabel = String(filterLabel || 'locatie').toLowerCase();
      eyebrow.textContent = type === 'customer' ? 'Klant' : (type === 'location' ? filterLabel : 'Plattegrond');
      title.textContent = type === 'customer' ? 'Kies klant' : (type === 'location' ? `Kies ${normalizedFilterLabel}` : 'Kies plattegrond');
      search.value = '';
      search.placeholder = type === 'location' ? `Zoek ${normalizedFilterLabel}...` : 'Zoeken...';
      setSheetDisplay(elements, true);
      renderFilters();
      renderItems();
      setTimeout(() => search.focus(), 0);
    }

    function close() {
      setSheetDisplay(elements, false);
      if (elements.filters) {
        elements.filters.hidden = true;
        elements.filters.innerHTML = '';
        elements.filters.classList.remove('select-sheet-filters--chips');
        elements.filters.classList.remove('select-sheet-filters--buttons');
      }
      activeType = null;
      activeFilterKey = '';
      expandedGroups.clear();
    }

    function isOpen(type) {
      return type ? activeType === type : Boolean(activeType);
    }

    return {
      close,
      getActiveType: () => activeType,
      isOpen,
      open,
      renderFilters,
      renderItems,
      updatePickerButtons,
    };
  }

  function createSelectionController({
    elements,
    getState,
    getItems,
    getFilters,
    getFilterGroups,
    getFilterLabel,
    getFilterValue,
    getPickerMeta,
    onFilterChange,
    onCustomerChange,
    onFloorplanChange,
  }) {
    let bound = false;
    const sheetController = createController({
      elements,
      getState,
      getItems,
      getFilters,
      getFilterGroups,
      getFilterLabel,
      getFilterValue,
      getPickerMeta,
      onFilterChange,
      onSelect: (type, item) => {
        if (type === 'customer') {
          elements.customerSelect.value = String(item.index);
          handleCustomerChange();
        } else if (type === 'floorplan') {
          elements.floorplanSelect.value = String(item.index);
          handleFloorplanChange();
        } else if (type === 'location') {
          const filterType = String(item.filterKey || 'floorplan');
          if (typeof onFilterChange === 'function') onFilterChange(filterType, String(item.value || ''));
          sheetController.open('floorplan');
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
      renderFilters: sheetController.renderFilters,
      renderItems: sheetController.renderItems,
      updatePickerButtons: sheetController.updatePickerButtons,
    };
  }

  FD.SelectSheetService = {
    LOCATION_ALL_VALUE,
    LOCATION_NONE_VALUE,
    LOCATION_NONE_LABEL,
    GROUP_NONE_VALUE,
    GROUP_NONE_LABEL,
    ORGANIZER_NONE_VALUE,
    ORGANIZER_NONE_LABEL,
    DIRECT_LOCATION_FILTER_LIMIT,
    COLLAPSIBLE_FLOORPLAN_LIMIT,
    buildGroupFilterOptions,
    buildLocationFilterOptions,
    compareFloorplanDisplayOrder,
    floorplanOrganizerLabel,
    floorplanOrganizerValue,
    floorplanSortKey,
    createController,
    createSelectionController,
    floorplanLocationFilterLabel,
    floorplanLocationFilterValue,
    floorplanLocationName,
    floorplanGroupFilterLabel,
    floorplanGroupFilterValue,
    floorplanGroupName,
    getCustomerLocationDetails,
    getFloorplanLocationDetails,
    floorplanDisplayName,
    floorplanDisplayParts,
    getSelectedFloorplan,
    getSelectedOptionText,
    renderCustomerOptions,
    renderFloorplanOptions,
    resetFloorplanOptions,
    selectedIndex,
    sortedWithOriginalIndex,
  };
})(window);
