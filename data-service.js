(function (global) {
  const FD = global.FD = global.FD || {};
  const Repository = FD.Repository;

  function requireRepository() {
    if (!Repository) throw new Error('FD.Repository ontbreekt');
  }

  async function loadCustomers(config) {
    requireRepository();
    return Repository.fetchJSON(config.customersUrl);
  }

  async function loadStatus(config) {
    requireRepository();
    return Repository.fetchJSON(config.statusUrl);
  }

  async function saveStatus(config, statusData, messageCustomer) {
    requireRepository();
    const { meta } = await Repository.fetchJSONWithMeta(config.statusUrl, 'Kon status.json niet ophalen');
    return Repository.putJSON(config.statusUrl, {
      message: 'Status update: ' + (messageCustomer || 'offline queue'),
      data: statusData,
      sha: meta.sha,
    }, 'Kon status niet opslaan');
  }

  async function loadFloorplanSVG(fileUrl, options) {
    requireRepository();
    const meta = await Repository.fetchContentMeta(fileUrl, 'Bestand niet gevonden', options);
    const repo = Repository.repoFromContentsUrl(fileUrl, 'mlivvm/gallery');
    return Repository.fetchBlobText(repo, meta.sha, 'Kon blob niet laden', options);
  }

  async function revalidateFloorplanSVG(fileUrl, cachedSha, options) {
    requireRepository();
    const meta = await Repository.fetchContentMeta(fileUrl, null, options);
    if (meta.sha === cachedSha) return null;
    const repo = Repository.repoFromContentsUrl(fileUrl, 'mlivvm/gallery');
    return Repository.fetchBlobText(repo, meta.sha, null, options);
  }

  async function warmFloorplanSVG(fileUrl, options) {
    requireRepository();
    const meta = await Repository.fetchContentMeta(fileUrl, 'Metadata cache mislukt: {status}', options);
    const repo = Repository.repoFromContentsUrl(fileUrl, 'mlivvm/gallery');
    await Repository.fetchBlobText(repo, meta.sha, 'Blob cache mislukt: {status}', options);
  }

  async function saveFloorplanSVG(fileUrl, svgText, options, legacyErrorMessage) {
    requireRepository();
    const saveOptions = typeof options === 'string'
      ? { message: options, saveErrorMessage: legacyErrorMessage }
      : (options || {});
    const meta = await Repository.fetchContentMeta(fileUrl, saveOptions.fetchErrorMessage || 'Kon bestand niet ophalen');
    return Repository.putTextContent(fileUrl, {
      message: saveOptions.message,
      text: svgText,
      sha: meta.sha,
    }, saveOptions.saveErrorMessage || 'Kon niet opslaan');
  }

  function uploadedFloorplanUrl(config, fileName) {
    return config.svgUploadsUrl + encodeURIComponent(fileName);
  }

  async function addUploadedFloorplan(config, options) {
    requireRepository();
    const {
      customerName,
      floorplanName,
      fileName,
      svgText,
      isNewCustomer,
    } = options;

    const uploadUrl = uploadedFloorplanUrl(config, fileName);
    let uploadedSvgSha = null;

    try {
      const uploadData = await Repository.putTextContent(uploadUrl, {
        message: 'Upload: ' + customerName + ' - ' + floorplanName,
        text: svgText,
      }, 'SVG upload mislukt');
      uploadedSvgSha = uploadData.content?.sha;

      const { meta: customersMeta, data: currentCustomers } = await Repository.fetchJSONWithMeta(config.customersUrl, 'Kon customers.json niet ophalen');
      const newEntry = { name: floorplanName, file: fileName, repo: 'uploads', uploaded: true };

      if (isNewCustomer) {
        currentCustomers.push({ customer: customerName, floorplans: [newEntry] });
      } else {
        const freshCi = currentCustomers.findIndex(c => c.customer === customerName);
        if (freshCi < 0) throw new Error('Klant niet gevonden in customers.json');
        currentCustomers[freshCi].floorplans.push(newEntry);
      }

      await Repository.putJSON(config.customersUrl, {
        message: 'Plattegrond toegevoegd: ' + customerName + ' - ' + floorplanName,
        data: currentCustomers,
        sha: customersMeta.sha,
      }, 'Kon customers.json niet bijwerken');

      return { customers: currentCustomers, entry: newEntry, uploadUrl };
    } catch (err) {
      if (uploadedSvgSha) {
        try {
          await Repository.deleteContent(uploadUrl, { message: 'Rollback: upload mislukt', sha: uploadedSvgSha });
        } catch (e) {}
      }
      throw err;
    }
  }

  async function deleteUploadedFloorplan(config, options) {
    requireRepository();
    const { customerName, floorplan } = options;
    const fp = floorplan;

    const { meta: customersMeta, data: currentCustomers } = await Repository.fetchJSONWithMeta(config.customersUrl, 'Kon customers.json niet ophalen');

    const freshCi = currentCustomers.findIndex(c => c.customer === customerName);
    if (freshCi >= 0) {
      const freshFi = currentCustomers[freshCi].floorplans.findIndex(f => f.file === fp.file);
      if (freshFi >= 0) currentCustomers[freshCi].floorplans.splice(freshFi, 1);
      if (currentCustomers[freshCi].floorplans.length === 0) currentCustomers.splice(freshCi, 1);
    }

    await Repository.putJSON(config.customersUrl, {
      message: 'Plattegrond verwijderd: ' + customerName + ' - ' + fp.name,
      data: currentCustomers,
      sha: customersMeta.sha,
    }, 'Kon customers.json niet bijwerken');

    const fileUrl = uploadedFloorplanUrl(config, fp.file);
    const meta = await Repository.fetchContentMeta(fileUrl, 'Kon bestand niet vinden');
    try {
      await Repository.deleteContent(fileUrl, {
        message: 'Verwijderd: ' + customerName + ' - ' + fp.name,
        sha: meta.sha,
      }, 'Kon bestand niet verwijderen');
    } catch (deleteErr) {
      try {
        const { meta: rollbackMeta, data: rollbackCustomers } = await Repository.fetchJSONWithMeta(config.customersUrl);
        const rollbackCi = rollbackCustomers.findIndex(c => c.customer === customerName);
        const rollbackEntry = { name: fp.name, file: fp.file, repo: 'uploads', uploaded: true };
        if (rollbackCi >= 0) {
          rollbackCustomers[rollbackCi].floorplans.push(rollbackEntry);
        } else {
          rollbackCustomers.push({ customer: customerName, floorplans: [rollbackEntry] });
        }
        await Repository.putJSON(config.customersUrl, {
          message: 'Rollback: verwijderen mislukt',
          data: rollbackCustomers,
          sha: rollbackMeta.sha,
        });
      } catch (e) {}
      throw deleteErr;
    }

    return { customers: currentCustomers };
  }

  async function fetchFloorplanTreeMap(repo, options) {
    requireRepository();
    return Repository.fetchRepoTreeMap(repo, options);
  }

  async function validateTokenForCustomers(config, token) {
    requireRepository();
    return Repository.testTokenAccess(config.customersUrl, token);
  }

  FD.DataService = {
    loadCustomers,
    loadStatus,
    saveStatus,
    loadFloorplanSVG,
    revalidateFloorplanSVG,
    warmFloorplanSVG,
    saveFloorplanSVG,
    addUploadedFloorplan,
    deleteUploadedFloorplan,
    fetchFloorplanTreeMap,
    validateTokenForCustomers,
  };
})(window);
