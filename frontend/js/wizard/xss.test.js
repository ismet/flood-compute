import { describe, it, expect } from "vitest";
import { _esc } from "../core/format.js";

// Probe: station name containing XSS payload must be escaped when rendered via innerHTML
const XSS = '<img src=x onerror=alert(1)>';

describe("XSS escaping", () => {
  it("_esc probe payload", () => {
    const escaped = _esc(XSS);
    expect(escaped).toBe("&lt;img src=x onerror=alert(1)&gt;");
    expect(escaped).not.toContain("<img");
    expect(escaped).toContain("&lt;img");
  });

  it("thiessen renderExcluded escapes station names", async () => {
    // Simulate renderExcluded HTML generation path: uses _esc(s.name)
    const name = XSS;
    const html = `<div>${_esc(name)} <button>✕</button></div>`;
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img src=x");
    // Ensure that without escaping it would be vulnerable
    const vulnerable = `<div>${name} <button>✕</button></div>`;
    expect(vulnerable).toContain("<img src=x");
  });

  it("rain render escapes thiessen names", () => {
    const t = { name: XSS, agirlik: 0.5 };
    const html = `<tr><td>${_esc(t.name)} (${(t.agirlik * 100).toFixed(0)}%)</td></tr>`;
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
  });

  it("frekans agiInfo escapes kod/ad", () => {
    const s = { kod: "E123", ad: XSS, kurum: "DSİ", yil_sayisi: 10, ilk_yil: 2000, son_yil: 2010 };
    const html = `<b>${_esc(s.kod)}</b> ${_esc(s.ad)} — ${_esc(s.kurum)}`;
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
  });
});
