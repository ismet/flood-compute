export const S = {
  outlet: null,
  havza: null,
  kotlar: Array(11).fill(""),
  istasyonlar: [],
  thiessen: [],
  yagis: [],
  dplvList: null,
  sonuc: null,
  dplvManual: false,
  dplvAuto: null,
};

const _havzaListeners = [];
export function onHavzaChanged(fn) {
  _havzaListeners.push(fn);
}
export function _notifyHavzaChanged() {
  _havzaListeners.forEach((fn) => fn());
}
