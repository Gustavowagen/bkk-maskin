/*
 * dash-shim.js — a minimal stand-in for the claude.ai Dashboard runtime.
 *
 * The page (index.html) was written against a small `dash` API. This file
 * implements just the parts the page uses, so the page runs as plain HTML:
 *
 *   dash.data(id)        -> { status, data, columns, meta, refreshing }
 *   dash.calc(id, {...}) -> registers a derived dataset (fn gets input rows)
 *   dash.onData(fn)      -> fn runs now-ish and on every param/size change
 *   dash.params() / dash.setParams({...}) / dash.resetParams()
 *   dash.setLink(name)   -> updates location.hash
 *   dash.colors          -> series colours
 *
 * Data comes from window.CK_DATA (see data/data.js), keyed by dataset id:
 *   sessions, player_sessions, members, mtt, mtt_results
 *
 * To plug in a real backend, replace `rawData` lookups with fetch() calls
 * and set status to 'loading' until they resolve, then call notify().
 */
(function () {
  const DEFAULT_PARAMS = { tz: 'oslo' };
  const rawData = window.CK_DATA || {};
  const calcs = {};
  const cache = {};
  const listeners = [];
  let params = { ...DEFAULT_PARAMS };

  function resolve(id) {
    if (cache[id]) return cache[id];
    if (Object.prototype.hasOwnProperty.call(rawData, id)) {
      const rows = rawData[id];
      return (cache[id] = { status: 'ok', data: rows, columns: Object.keys(rows[0] || {}), meta: [], refreshing: false });
    }
    const c = calcs[id];
    if (c) {
      const inputs = c.inputs.map((i) => resolve(i));
      if (inputs.some((r) => r.status !== 'ok')) return { status: 'loading', data: [], columns: [], meta: [], refreshing: false };
      try {
        const rows = c.fn(...inputs.map((r) => r.data));
        return (cache[id] = { status: 'ok', data: rows, columns: Object.keys((rows && rows[0]) || {}), meta: [], refreshing: false });
      } catch (err) {
        console.error(`calc "${id}" failed`, err);
        return (cache[id] = { status: 'error', data: [], columns: [], meta: [], message: String(err), refreshing: false });
      }
    }
    return { status: 'missing', data: [], columns: [], meta: [], refreshing: false };
  }

  let queued = false;
  function notify() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      for (const fn of listeners) {
        try { fn(); } catch (err) { console.error('onData callback failed', err); }
      }
    });
  }

  let lastWidth = window.innerWidth;
  window.addEventListener('resize', () => {
    if (window.innerWidth !== lastWidth) { lastWidth = window.innerWidth; notify(); }
  });

  window.dash = {
    colors: ['#3a6ea5', '#d08c2f', '#5b9a68', '#b05a7a', '#7a68b0', '#4a9aa5', '#a5873a', '#8a8a8a'],
    data: resolve,
    calc(id, def) { calcs[id] = def; },
    loader() { /* not needed for local JSON */ },
    onData(fn) { listeners.push(fn); notify(); },
    params() { return { ...params }; },
    setParams(p) { params = { ...params, ...p }; notify(); },
    resetParams() { params = { ...DEFAULT_PARAMS }; notify(); },
    setLink(name) { try { history.replaceState(null, '', '#' + name); } catch (e) { /* file:// in some browsers */ } },
    refresh() { notify(); },
  };
})();
