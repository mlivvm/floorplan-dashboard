(function (global) {
  const FD = global.FD = global.FD || {};

  function getToken() {
    return localStorage.getItem('fd_github_token') || sessionStorage.getItem('fd_github_token') || '';
  }

  function headersForToken(token, accept) {
    return {
      'Authorization': 'token ' + token,
      'Accept': accept || 'application/vnd.github.v3+json',
    };
  }

  function headers(accept) {
    return headersForToken(getToken(), accept);
  }

  function decodeBase64UTF8(base64) {
    const binary = atob(base64.replace(/\n/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder('utf-8').decode(bytes);
  }

  function encodeBase64UTF8(text) {
    return btoa(unescape(encodeURIComponent(text)));
  }

  function blobJSONToText(blob) {
    return decodeBase64UTF8(blob.content);
  }

  function textBlobJSON(text) {
    return { content: encodeBase64UTF8(text) };
  }

  async function fetchJSON(url) {
    const response = await fetch(url, { headers: headers(), cache: 'no-store' });
    if (!response.ok) throw new Error('GitHub fetch failed: ' + response.status);
    const data = await response.json();
    return JSON.parse(decodeBase64UTF8(data.content));
  }

  function errorFor(status, message, fallback) {
    const error = new Error(message ? message.replace('{status}', status) : fallback + ': ' + status);
    error.status = status;
    return error;
  }

  function repoFromContentsUrl(url, fallback) {
    const repoMatch = url.match(/repos\/([^/]+\/[^/]+)\//);
    return repoMatch ? repoMatch[1] : (fallback || 'mlivvm/gallery');
  }

  function blobUrl(repo, sha) {
    return `https://api.github.com/repos/${repo}/git/blobs/${sha}`;
  }

  async function fetchRepoDefaultBranch(repo, options) {
    const response = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: headers(),
      cache: 'no-store',
      signal: options?.signal,
    });
    if (!response.ok) throw errorFor(response.status, null, 'GitHub repo metadata fetch failed');
    const data = await response.json();
    return data.default_branch || 'main';
  }

  async function fetchRepoTreeMap(repo, options) {
    const refs = [];
    let lastError = null;

    try {
      refs.push(await fetchRepoDefaultBranch(repo, options));
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      if (err?.status === 401 || err?.status === 403) throw err;
      lastError = err;
    }
    ['main', 'master'].forEach(ref => {
      if (!refs.includes(ref)) refs.push(ref);
    });

    for (const ref of refs) {
      try {
        const response = await fetch(`https://api.github.com/repos/${repo}/git/trees/${ref}?recursive=1`, {
          headers: headers(),
          cache: 'no-store',
          signal: options?.signal,
        });
        if (!response.ok) {
          const error = errorFor(response.status, null, 'GitHub tree fetch failed');
          if (error.status === 401 || error.status === 403) throw error;
          lastError = error;
          continue;
        }

        const data = await response.json();
        const map = new Map();
        (data.tree || []).forEach(item => {
          if (item.type === 'blob') map.set(item.path, item.sha);
        });
        if (data.truncated) {
          console.warn('GitHub tree is truncated voor repo:', repo);
        }
        return map;
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        if (err?.status === 401 || err?.status === 403) throw err;
        lastError = err;
      }
    }

    throw lastError || new Error('GitHub tree fetch failed');
  }

  async function fetchContentMeta(url, errorMessage, options) {
    const response = await fetch(url, {
      headers: headers(),
      cache: 'no-store',
      signal: options?.signal,
    });
    if (!response.ok) throw errorFor(response.status, errorMessage, 'GitHub content fetch failed');
    return response.json();
  }

  async function testTokenAccess(url, token) {
    const response = await fetch(url, {
      headers: headersForToken(token, 'application/vnd.github.v3+json'),
      cache: 'no-store',
    });
    return { ok: response.ok, status: response.status };
  }

  async function fetchBlobJSON(repo, sha, errorMessage, options) {
    const response = await fetch(blobUrl(repo, sha), {
      headers: headers(),
      cache: 'no-store',
      signal: options?.signal,
    });
    if (!response.ok) throw errorFor(response.status, errorMessage, 'GitHub blob fetch failed');
    return response.json();
  }

  async function fetchBlobText(repo, sha, errorMessage, options) {
    const blob = await fetchBlobJSON(repo, sha, errorMessage, options);
    return blobJSONToText(blob);
  }

  async function putContent(url, body, errorMessage) {
    const response = await fetch(url, {
      method: 'PUT',
      headers: headers(),
      cache: 'no-store',
      body: JSON.stringify(body),
    });
    if (!response.ok) throw errorFor(response.status, errorMessage, 'GitHub content update failed');
    return response.json();
  }

  async function fetchJSONWithMeta(url, errorMessage) {
    const meta = await fetchContentMeta(url, errorMessage);
    return {
      meta,
      data: JSON.parse(decodeBase64UTF8(meta.content)),
    };
  }

  async function putJSON(url, { message, data, sha }, errorMessage) {
    return putContent(url, {
      message,
      content: encodeBase64UTF8(JSON.stringify(data, null, 2)),
      sha,
    }, errorMessage);
  }

  async function putTextContent(url, { message, text, sha }, errorMessage) {
    const body = {
      message,
      content: encodeBase64UTF8(text),
    };
    if (sha) body.sha = sha;
    return putContent(url, body, errorMessage);
  }

  async function deleteContent(url, body, errorMessage) {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: headers(),
      cache: 'no-store',
      body: JSON.stringify(body),
    });
    if (!response.ok) throw errorFor(response.status, errorMessage, 'GitHub content delete failed');
    return response.json();
  }

  FD.Repository = {
    getToken,
    headers,
    headersForToken,
    decodeBase64UTF8,
    encodeBase64UTF8,
    blobJSONToText,
    textBlobJSON,
    fetchJSON,
    repoFromContentsUrl,
    blobUrl,
    fetchRepoDefaultBranch,
    fetchRepoTreeMap,
    fetchContentMeta,
    testTokenAccess,
    fetchBlobJSON,
    fetchBlobText,
    putContent,
    fetchJSONWithMeta,
    putJSON,
    putTextContent,
    deleteContent,
  };
})(window);
