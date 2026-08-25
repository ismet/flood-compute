export const $ = (id) => document.getElementById(id);
export const setStatus = (id, msg, cls = "") => {
  const e = $(id);
  if (!e) return;
  e.textContent = msg;
  e.className = "status " + cls;
  const loader = $("loader");
  if (loader) loader.classList.toggle("hidden", cls !== "loading");
};
export function download(name, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  a.download = name;
  a.click();
}
export async function dosyaIndir(resp, varsayilanAd) {
  if (!resp.ok) {
    let msg = resp.statusText;
    try {
      msg = (await resp.json()).hata || msg;
    } catch (e) {}
    throw new Error(msg);
  }
  const blob = await resp.blob();
  const cd = resp.headers.get("content-disposition") || "";
  let name = varsayilanAd;
  const idx = cd.indexOf("filename=");
  if (idx >= 0)
    name =
      cd
        .slice(idx + 9)
        .replace(/["';]/g, "")
        .trim() || name;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return name;
}
