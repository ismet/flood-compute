export const api = async (url, body, isForm) => {
  const opt =
    body === undefined
      ? {}
      : isForm
        ? { method: "POST", body }
        : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const r = await fetch(url, opt);
  const j = await r.json();
  if (!r.ok || j.hata) throw new Error(j.hata || r.statusText);
  return j;
};
