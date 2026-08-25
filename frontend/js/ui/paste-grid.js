import { $ } from "./dom.js";
export function makePasteGrid(gridId, addId, clearId, headers, data, minRows) {
  const el = $(gridId);
  if (!el) return null;
  el.dataset.cols = headers.length;
  function readGrid() {
    const cols = +el.dataset.cols,
      map = {};
    el.querySelectorAll(".resvol-cell").forEach((inp) => {
      const r = +inp.dataset.r,
        c = +inp.dataset.c;
      if (!map[r]) map[r] = new Array(cols).fill("");
      map[r][c] = inp.value.trim();
    });
    return Object.keys(map)
      .sort((a, b) => a - b)
      .map((k) => map[k]);
  }
  function onPaste(e) {
    const text = (e.clipboardData || window.clipboardData).getData("text");
    if (!text || (!text.includes("\t") && !text.includes("\n"))) return;
    e.preventDefault();
    const block = text
      .replace(/\r/g, "")
      .split("\n")
      .filter((x) => x.trim() !== "")
      .map((row) => row.split(/[\t;,]/));
    const r0 = +e.target.dataset.r,
      c0 = +e.target.dataset.c,
      cols = +el.dataset.cols;
    const cur = readGrid();
    while (cur.length < r0 + block.length) cur.push([]);
    block.forEach((vals, dr) =>
      vals.forEach((val, dc) => {
        if (c0 + dc < cols) {
          if (!cur[r0 + dr]) cur[r0 + dr] = [];
          cur[r0 + dr][c0 + dc] = val.trim();
        }
      }),
    );
    render(cur);
  }
  function render(d) {
    const rows = Math.max((d || []).length, minRows || 6);
    let h = `<table class="tbl rain"><tr>` + headers.map((c) => `<th>${c}</th>`).join("") + `</tr>`;
    for (let r = 0; r < rows; r++) {
      h += "<tr>";
      for (let c = 0; c < headers.length; c++) {
        const v = d && d[r] && d[r][c] != null ? d[r][c] : "";
        h += `<td><input class="resvol-cell" data-r="${r}" data-c="${c}" value="${v}"></td>`;
      }
      h += "</tr>";
    }
    el.innerHTML = h + "</table>";
    el.querySelectorAll(".resvol-cell").forEach((inp) => inp.addEventListener("paste", onPaste));
  }
  render(data);
  if ($(addId)) $(addId).onclick = () => render(readGrid().concat([[]]));
  if ($(clearId)) $(clearId).onclick = () => render([]);
  return { render, read: readGrid, cols: headers.length };
}
export function readGridNums(grid, ncol) {
  if (!grid) return [];
  return grid
    .read()
    .filter((r) => r.slice(0, ncol).every((x) => x !== "" && x != null && !isNaN(+x)))
    .map((r) => r.slice(0, ncol).map(Number));
}
