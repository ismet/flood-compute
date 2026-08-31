// Vitest global mocks for browser-only frontend modules (node env).
// Provides minimal DOM/Leaflet/Chart stubs so that pure-function imports
// don't throw at evaluation time. Real browser behavior unchanged.

if (typeof globalThis.window === "undefined") globalThis.window = globalThis;

if (typeof globalThis.document === "undefined") {
  const stubEl = () => ({
    style: {},
    dataset: {},
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() {
        return false;
      },
    },
    appendChild() {},
    setAttribute() {},
    getAttribute() {
      return null;
    },
    addEventListener() {},
    removeEventListener() {},
    click() {},
    contains() {
      return false;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    getBounds() {
      return { isValid: () => false };
    },
    innerHTML: "",
    textContent: "",
    value: "",
    placeholder: "",
    checked: false,
    open: false,
    hidden: false,
    files: [],
    selectedIndex: 0,
    tagName: "DIV",
  });
  const anyEl = stubEl();
  // Always return a stub element — avoids null derefs in top-level render*() calls.
  // Modules that explicitly check `if (!el) return` still work because stub is truthy,
  // but their DOM writes become no-ops, which is fine for pure-function unit tests.
  globalThis.document = {
    getElementById: () => stubEl(),
    querySelector: () => stubEl(),
    querySelectorAll: () => [],
    createElement: () => stubEl(),
    createElementNS: () => stubEl(),
    body: { appendChild() {}, innerHTML: "" },
    addEventListener() {},
    removeEventListener() {},
    // For code that does `if (document.getElementById(...))` expecting null when missing,
    // the stub truthiness changes semantics but is acceptable for tests: top-level
    // renderKotlar() will now just write to a dummy node instead of throwing.
    // If a test needs null, it can stub document.getElementById per-test.
    getElementsByTagName: () => [],
  };
  // Provide a minimal element for $("mapSearch") etc. when querySelector is used
  globalThis.document.documentElement = anyEl;
}

if (typeof globalThis.navigator === "undefined") globalThis.navigator = {};
if (typeof globalThis.location === "undefined") globalThis.location = { search: "" };
if (typeof globalThis.history === "undefined") globalThis.history = {};

if (typeof globalThis.alert === "undefined") globalThis.alert = () => {};
if (typeof globalThis.confirm === "undefined") globalThis.confirm = () => false;

if (typeof globalThis.fetch === "undefined") {
  globalThis.fetch = async () => {
    throw new Error("fetch mock: no server in unit test");
  };
}

// Minimal Leaflet stub — enough for map/init.js and rain.js/duzenle.js top-level
if (typeof globalThis.L === "undefined") {
  const geoJsonStub = () => ({
    addTo() {
      return this;
    },
    clearLayers() {},
    eachLayer() {},
    addData() {},
    toGeoJSON() {
      return null;
    },
    getLayers() {
      return [];
    },
    setStyle() {},
    remove() {},
    removeLayer() {},
    addLayer() {},
    getLatLngs() {
      return [];
    },
    setLatLngs() {},
  });
  globalThis.L = {
    map: () => {
      // 898ffaf pane'leri: init.js modül seviyesinde getPane/createPane çağırır
      const panes = {};
      return {
        setView() {
          return this;
        },
        on() {},
        off() {},
        getPane(name) {
          return panes[name] || null;
        },
        createPane(name) {
          panes[name] = { style: {} };
          return panes[name];
        },
        getCenter() {
          return { lat: 39, lng: 35 };
        },
        getContainer() {
          return { style: {} };
        },
        removeLayer() {},
        addLayer() {},
        pm: {
          enableDraw() {},
          disableDraw() {},
        },
      };
    },
    tileLayer: () => ({
      addTo() {
        return {};
      },
    }),
    control: {
      layers: () => ({
        addTo() {
          return {};
        },
      }),
    },
    geoJSON: geoJsonStub,
    layerGroup: () => ({
      addTo() {
        return { clearLayers() {}, addLayer() {}, removeLayer() {} };
      },
    }),
    polyline: () => ({
      setStyle() {},
      pm: {
        enable() {},
        disable() {},
        enabled() {
          return false;
        },
      },
      on() {},
      off() {},
      getLatLngs() {
        return [];
      },
      setLatLngs() {},
    }),
    polygon: () => ({
      setStyle() {},
      pm: {
        enable() {},
        disable() {},
        enabled() {
          return false;
        },
      },
      getLatLngs() {
        return [];
      },
      setLatLngs() {},
    }),
    marker: () => ({
      addTo() {
        return this;
      },
      remove() {},
      setLatLng() {},
      bindTooltip() {
        return this;
      },
      openTooltip() {
        return this;
      },
      bindPopup() {
        return this;
      },
    }),
    circleMarker: () => ({
      addTo() {
        return this;
      },
      remove() {},
      bindTooltip() {
        return this;
      },
    }),
    DomEvent: { stop() {} },
    PM: {},
  };
}

if (typeof globalThis.Chart === "undefined") {
  globalThis.Chart = class {
    // eslint-disable-next-line no-unused-vars -- stub signature
    constructor(_el, _cfg) {}
    destroy() {}
    update() {}
    static register() {}
  };
}
