import { describe, expect, it } from "vitest";
import { kurCrsSecici, seciliCrs } from "./crs.js";

const secici = () => {
  const select = {
    value: "",
    options: [],
    replaceChildren() {
      this.options.length = 0;
    },
    append(option) {
      this.options.push(option);
    },
    onchange: null,
    dispatchEvent() {
      this.onchange?.();
    },
  };
  return select;
};

describe("Türkiye CRS seçenekleri", () => {
  it("kod seçmeden dosyadaki CRS seçeneğini gösterir", () => {
    const select = secici();
    const custom = { style: {}, value: "" };
    kurCrsSecici(select, "auto", custom);
    expect(select.value).toBe("");
    expect(select.options.length).toBeGreaterThan(30);
    expect(seciliCrs(select, custom)).toBe("");
  });


  it("özel EPSG kodunu döndürür", () => {
    const select = secici();
    const custom = { style: {}, value: "" };
    kurCrsSecici(select, "EPSG:5254", custom);
    select.value = "custom";
    select.dispatchEvent(new Event("change"));
    custom.value = "EPSG:23037";
    expect(seciliCrs(select, custom)).toBe("EPSG:23037");
  });
});
