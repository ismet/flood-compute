# -*- coding: utf-8 -*-
"""Hazne (rezervuar) taşkın ötelemesi — Storage-Indication / Modified Puls.

Söylemez T28 (Hazne Routing_DSİ) yönteminin birebir karşılığı:

    (2S/Δt + O)_{t+1} = (I_t + I_{t+1}) + (2S/Δt − O)_t
    O_{t+1} = φ⁻¹(2S/Δt+O)          (depolama-gösterge eğrisinden interpolasyon)

Depolama-gösterge eğrisi, kret üstü yük He için:
  kot = kret + He, alan A(kot) hacim-satıh eğrisinden,
  eşiküstü hacim S = ((A_kret + A)/2)·He  (hm³ = 10⁶ m³),
  dolusavak debisi O = rating(He),  φ = 2S·10⁶/Δt_s + O.

Kontrolsüz dolusavak debisi (formül modu): Q = C·L_e·He^1.5,
  L_e = L + 2·He·tan(apron giriş açısı) — apron ile genişleyen efektif genişlik.
"""


def _interp(x, xs, ys):
    if x <= xs[0]:
        return ys[0]
    if x >= xs[-1]:
        return ys[-1]
    for k in range(1, len(xs)):
        if x <= xs[k]:
            t = (x - xs[k - 1]) / (xs[k] - xs[k - 1])
            return ys[k - 1] + t * (ys[k] - ys[k - 1])
    return ys[-1]


# USBR "Design of Small Dams" — ogee (oturtulmuş) kret dolusavak debi
# katsayısı C'nin, yaklaşım derinliği oranı P/He'ye göre değişimi (metrik:
# Q = C·L·He^1.5). P = kret üstü yaklaşım yüksekliği = kret_kotu − yaklaşım
# taban kotu, He = kret üstü yük. Emniyetli (alçak) P/He'de yaklaşım hızı
# düşük olduğundan C küçülür; yüksek dolusavakta (P/He ≳ 3) C ≈ 2.2'ye
# oturur. Değerler ampirik USBR abağının (imperial 3.08→4.03) metrik
# karşılığıdır (× 0.5521).
_CD_PH = [0.0, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0]
_CD_C = [1.700, 1.943, 2.070, 2.137, 2.176, 2.209, 2.220, 2.225]


def coeff_from_ph(P, He):
    """USBR P/He eğrisinden metrik dolusavak debi katsayısı C.

    P: kret üstü yaklaşım yüksekliği (m), He: kret üstü yük (m).
    P/He büyüdükçe (yüksek dolusavak) C ≈ 2.225'e yaklaşır.
    """
    if P is None or He is None or He <= 0:
        return _CD_C[-1]
    return _interp(P / He, _CD_PH, _CD_C)


def rating_from_geometry(kret, apron_deg, L, C=None, he_max=3.0, step=0.1, P=None):
    """Geometriye göre kontrolsüz dolusavak rating tablosu [(He, Q)].

    C sayı verilirse sabit kullanılır. C=None ise her He için USBR P/He
    eğrisinden türetilir (``coeff_from_ph``); bu durumda P (kret üstü
    yaklaşım yüksekliği) verilmelidir.
    """
    import math
    a = math.radians(apron_deg or 0.0)
    out = [[0.0, 0.0]]
    he = step
    while he <= he_max + 1e-9:
        Le = L + 2.0 * he * math.tan(a)
        Cd = coeff_from_ph(P, he) if C is None else C
        Q = Cd * max(Le, 0.0) * he ** 1.5
        out.append([round(he, 3), round(Q, 3)])
        he += step
    return out


GRAV = 9.81


def gate_discharge(level, opening_d, sill, Lef, W1=0.0, n=1):
    """Kapak altı akım debisi (m³/s): Q=(2/3)√(2g)·C·(n·Lef)·(H1^1.5−H2^1.5)+W1.

    H1 = seviye−eşik kotu, H2 = H1−kapak açıklığı d (d/H1 ≤ 0.7 sınırlı).
    C = f(d/H1) (Excel 1512 sayfası). n = kapak adedi (her biri Lef genişlikte).
    W1 = taban/serbest debi (kapak kapalıyken tüm dolusavak için, adetle çarpılmaz).
    """
    import math
    H1 = level - sill
    if H1 <= 0:
        return 0.0
    d = max(0.0, min(opening_d, 0.7 * H1))
    H2 = H1 - d
    r = d / H1
    C = 0.734 - 0.136 * r - 0.34 * r * r if r < 0.2 else 0.72 - 0.104 * r
    return (2.0 / 3.0) * math.sqrt(2 * GRAV) * C * (n * Lef) * (H1 ** 1.5 - H2 ** 1.5) + W1


def gate_max_Q(level, sill, Lef, W1=0.0, n=1):
    H1 = level - sill
    return 0.0 if H1 <= 0 else gate_discharge(level, 0.7 * H1, sill, Lef, W1, n)


def gate_opening_for(level, O_target, sill, Lef, W1=0.0, n=1):
    """Hedef debiyi O_target verecek kapak açıklığı d (m); ikili arama."""
    H1 = level - sill
    if H1 <= 0 or O_target <= W1:
        return 0.0
    hi = 0.7 * H1
    if gate_discharge(level, hi, sill, Lef, W1, n) <= O_target:
        return hi
    lo = 0.0
    for _ in range(60):
        mid = (lo + hi) / 2
        if gate_discharge(level, mid, sill, Lef, W1, n) < O_target:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def _sim_controlled(I, dt_s, kot, vol, sill, Lef, W1, H_init, O_cap, n=1,
                    pik_sonrasi_bosalt=True):
    """Verilen pik-tavan O_cap ile öteleme simülasyonu.

    İşletme kuralı:
      * Giriş **pikine kadar** (yükselen kol): O ≤ I — mansaba doğal akımdan
        fazlası verilmez, fazla su haznede depolanır.
      * Pik **geçtikten sonra** (alçalan kol, ``pik_sonrasi_bosalt``): O > I
        olabilir; hazne, çıkış piki tavanı O_cap'i aşmadan boşaltılır. Çıkış
        zaten O_cap ≤ giriş piki olduğundan mansaptaki pik büyümez, ama
        depolama daha erken geri kazanılır ve maksimum su kotu düşer.
      * Boşaltma, su kotu **başlangıç kotunun altına** inecek kadar sürmez;
        o seviyeye gelince yeniden geçişli (O ≈ I) çalışılır.
    """
    V = _interp(H_init, kot, vol)          # hm³
    V_init = V                             # boşaltmada alt sınır
    outs, levels, openings = [], [], []
    maxlev = _interp(V, vol, kot)          # gerçek başlangıç kotu (tabloya kırpılı)
    nI = len(I)
    t_pik = max(range(nI), key=lambda i: I[i]) if nI else 0
    for t in range(nI):
        lev = _interp(V, vol, kot)
        if lev > maxlev:
            maxlev = lev
        Qmax = gate_max_Q(lev, sill, Lef, W1, n)
        I_next = I[t + 1] if t + 1 < nI else I[t]
        I_ort = (I[t] + I_next) / 2.0      # bu adımdaki ortalama giriş (trapez)
        O = min(I[t], O_cap)               # pik-tavan + O ≤ I
        if pik_sonrasi_bosalt and t > t_pik:
            # Alçalan kolda girenden fazlasını salabiliriz. O_bosalt, bu adım
            # sonunda hacmi tam başlangıç seviyesine indiren debidir; hem alt
            # (boşaltmaya izin ver) hem üst (başlangıç kotunun altına inme)
            # sınır olarak kullanılır — böylece hazne normal işletme kotuna
            # çekilip orada tutulur.
            O_bosalt = max(0.0, (V - V_init) * 1e6 / dt_s + I_ort)
            O = max(O, min(O_cap, O_bosalt))
            O = min(O, O_bosalt)
        O = min(O, Qmax)                   # kapak kapasitesi
        if lev > sill:
            O = max(O, W1)                 # taban debi (kapak kapalıyken bile)
        else:
            O = 0.0
        openings.append(gate_opening_for(lev, O, sill, Lef, W1, n))
        outs.append(O)
        levels.append(lev)
        V += (I_ort - O) * dt_s / 1e6      # hm³
        if V < vol[0]:
            V = vol[0]
    lev = _interp(V, vol, kot)
    if lev > maxlev:
        maxlev = lev
    return outs, levels, openings, maxlev


def route_controlled(inflow, dt_hr, vol_satih, sill, Lef, H_init, H_max, W1=0.0,
                     n_kapak=1, pik_sonrasi_bosalt=True):
    """Kapaklı (kontrollü) dolusavak ötelemesi + kapak optimizasyonu.

    Kapaklar öyle işletilir ki: (a) su kotu H_max'ı geçmez, (b) **giriş pikine
    kadar** çıkış ≤ giriş, (c) çıkış piki minimum olur (pik-tavan/peak-shaving;
    H_init ile H_max arasındaki depolama kullanılır). İkili arama ile minimum
    uygulanabilir O_cap bulunur.

    ``pik_sonrasi_bosalt`` (vars. açık): pik geçtikten sonra çıkış girişi
    aşabilir — hazne, O_cap'i ve başlangıç kotunu aşmadan boşaltılır. Çıkış
    tavanı zaten giriş pikinin altında olduğu için mansaptaki pik büyümez;
    buna karşılık maksimum su kotu düştüğünden optimizasyon **daha küçük**
    bir çıkış piki bulabilir.
    n_kapak: kapak adedi (her biri Lef genişlikte).
    """
    kot = [r[0] for r in vol_satih]
    vol = [r[1] for r in vol_satih]
    n = max(1, int(n_kapak or 1))
    I = [float(v) if isinstance(v, (int, float)) else 0.0 for v in inflow]
    dt_s = dt_hr * 3600.0
    Ipk = max(I) if I else 0.0

    def maxlev_for(oc):
        return _sim_controlled(I, dt_s, kot, vol, sill, Lef, W1, H_init, oc, n,
                               pik_sonrasi_bosalt)[3]

    lo, hi = max(W1, 0.0), max(Ipk, W1 + 1.0)
    asilamaz = maxlev_for(hi) > H_max + 1e-6    # pass-through bile taşırıyorsa
    for _ in range(60):
        mid = (lo + hi) / 2
        if maxlev_for(mid) <= H_max:
            hi = mid
        else:
            lo = mid
    O_cap = hi
    outs, levels, openings, maxlev = _sim_controlled(
        I, dt_s, kot, vol, sill, Lef, W1, H_init, O_cap, n, pik_sonrasi_bosalt)

    # --- girdi tutarlılık kontrolü (sessiz 0 çıkışı yakala) ---
    kmin, kmax = kot[0], kot[-1]
    uyari = None
    if not (kmin - 1e-6 <= sill <= kmax + 1e-6):
        uyari = (f"Eşik (kret) kotu {sill:g} m, hacim tablosu aralığı "
                 f"[{kmin:g}, {kmax:g}] m dışında — çıkış 0 çıkabilir. "
                 f"Eşik/başlangıç kotlarını hacim tablosuyla aynı düşeyde girin.")
    elif not (kmin - 1e-6 <= H_init <= kmax + 1e-6):
        uyari = (f"Başlangıç kotu {H_init:g} m, hacim tablosu aralığı "
                 f"[{kmin:g}, {kmax:g}] m dışında.")
    elif maxlev <= sill + 1e-6:
        uyari = ("Su kotu hiç eşik (kret) kotunu aşmadı; kapaklardan akış yok, "
                 "çıkış yalnız taban debisi W1 kadar. Hazne giriş taşkınını tümüyle "
                 "depoluyor olabilir (hacim tablosu çok büyük).")

    Opk = max(outs) if outs else 0.0
    ozet = {
        "giris_pik": Ipk, "cikis_pik": Opk,
        "pik_sonumleme": (1 - Opk / Ipk) if Ipk else None,
        "min_cikis_pik_hedef": O_cap,
        "maks_su_kotu": maxlev, "H_max": H_max, "H_init": H_init,
        "maks_kapak_acikligi": max(openings) if openings else 0.0,
        "kapak_adedi": n,
        "pik_sonrasi_bosalt": bool(pik_sonrasi_bosalt),
        "giris_pik_indeks": int(max(range(len(I)), key=lambda i: I[i])) if I else None,
        "giris_pik_saat": (I.index(Ipk) * dt_hr) if I else None,
        "cikis_pik_saat": (outs.index(Opk) * dt_hr) if outs else None,
        "asim_uyarisi": bool(asilamaz),
        "girdi_uyarisi": uyari,
    }
    return {
        "t": [i * dt_hr for i in range(len(I))],
        "giris": I, "cikis": outs, "su_kotu": levels, "kapak_acikligi": openings,
        "dt_saat": dt_hr, "esik_kotu": sill, "ozet": ozet,
    }


def route(inflow, dt_hr, kret, vol_satih, rating):
    """Hazne ötelemesi.

    inflow: giriş hidrografı [m³/s] (Δt=dt_hr aralıklı).
    vol_satih: [[kot_m, alan_km2, hacim_hm3], ...] artan kotlu.
    rating: [[He_m, Q_m3s], ...] artan He'li (He = kret üstü yük).
    Döner: {t, giris, cikis, su_kotu, ozet}.
    """
    dt_s = dt_hr * 3600.0
    kot = [r[0] for r in vol_satih]
    alan = [r[1] for r in vol_satih]
    A_kret = _interp(kret, kot, alan)

    He = [r[0] for r in rating]
    Oc = [r[1] for r in rating]
    elevc = [kret + h for h in He]
    # depolama-gösterge eğrisi φ(He)
    phi_c = []
    for j, h in enumerate(He):
        A = _interp(kret + h, kot, alan)
        S_hm3 = ((A_kret + A) / 2.0) * h        # hm³ (=10⁶ m³)
        phi_c.append(S_hm3 * 1e6 * 2.0 / dt_s + Oc[j])

    I = [float(v) if isinstance(v, (int, float)) else 0.0 for v in inflow]
    E = 0.0
    cikis, su_kotu = [], []
    for t in range(len(I)):
        phi = 0.0 if t == 0 else (I[t - 1] + I[t] + E)
        O = _interp(phi, phi_c, Oc)
        lv = _interp(phi, phi_c, elevc)
        E = phi - 2.0 * O
        cikis.append(O)
        su_kotu.append(lv)

    Ipk = max(I) if I else 0.0
    Opk = max(cikis) if cikis else 0.0
    ozet = {
        "giris_pik": Ipk,
        "cikis_pik": Opk,
        "pik_sonumleme": (1 - Opk / Ipk) if Ipk else None,
        "giris_pik_saat": (I.index(Ipk) * dt_hr) if I else None,
        "cikis_pik_saat": (cikis.index(Opk) * dt_hr) if cikis else None,
        "maks_su_kotu": max(su_kotu) if su_kotu else None,
        "maks_He": (max(su_kotu) - kret) if su_kotu else None,
        "gecikme_saat": ((cikis.index(Opk) - I.index(Ipk)) * dt_hr) if I and cikis else None,
    }
    return {
        "t": [i * dt_hr for i in range(len(I))],
        "giris": I, "cikis": cikis, "su_kotu": su_kotu,
        "dt_saat": dt_hr, "kret": kret, "ozet": ozet,
    }
