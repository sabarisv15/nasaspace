# SPHEREx survey data properties and limits for moving-star / brown-dwarf detection (ARCNAVE)

Status labels used throughout: **[IN-FLIGHT]** = measured or operational after launch; **[DESIGN]** = pre-launch design or lab value; **[PLANNED]** = scheduled or predicted. Research date: November 2026. Main primary sources: Bock et al. 2025, "The SPHEREx Satellite Mission" (arXiv:2511.02985, ApJ); Akeson et al. 2025/2026, "The SPHEREx Image and Spectrophotometry Processing Pipeline" (arXiv:2511.15823v2, ApJS); IRSA SPHEREx archive documentation. The IRSA Explanatory Supplement PDF (which holds the FLAGS bit table, Table 10 / Sec. 3.2.4) was too large to fetch (>10 MB) and **was not read directly**.

## 1. Image geometry: pixel scale, PSF, LVF wavelength layout, per-pass sampling and timing

### Takeaway
SPHEREx images have coarse ~6.15-6.2" pixels, and the PSF is under-sampled: lab FWHM was under 3" over most of the short-wavelength focal plane, growing to ~5.5" at the longest wavelengths. Each of the 6 detectors carries a linear variable filter, so wavelength changes continuously along one image axis (17 channels per detector, 102 total). One sky spot is stepped through all channels by repeated ~117 s exposures with small slews, all within about 2 weeks per survey. So within one ARCNAVE "pass", images of a spot span days, not months, and differ in wavelength.

### Cited Findings
- Pixel scale 6.2" in the mission paper (Table 1, abstract) [DESIGN/IN-FLIGHT] — [Bock et al. 2025, arXiv:2511.02985](https://arxiv.org/abs/2511.02985). The pipeline paper gives 6.15" [IN-FLIGHT] — [Akeson et al., arXiv:2511.15823](https://arxiv.org/html/2511.15823v2). The UCD pipeline paper gives "about 6.15″", 2048×2048 detectors, 3.5° field — [SPIFF, arXiv:2604.22012](https://arxiv.org/html/2604.22012).
  - Conflict/likely error: the IRSA data-products page (as summarized) gave "0.615 arcsec" per image pixel. This is almost certainly the 10× oversampled PSF-pixel size (6.15"/10) and should not be taken as the image pixel scale — [IRSA SPHEREx data products](https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-products).
- Released Level 2 images are 2040×2040 pixels (the 2048 array minus reference pixels), with HDUs IMAGE (MJy/sr, zodi NOT subtracted), FLAGS (bitmap), VARIANCE, ZODI (model), PSF, WCS-WAVE. Each file (~70 MB) is one detector of one pointing — [IRSA data products](https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-products); [Akeson et al.](https://arxiv.org/html/2511.15823v2).
- PSF (pre-flight, at assembly): FWHM better than 3" over most of the SWIR focal plane, up to 6" in the extreme corners of band 3; the MWIR PSF grows to ~5.5" at long wavelengths from diffraction [DESIGN] — [Bock et al.](https://arxiv.org/html/2511.02985).
- PSF (in-flight): the mission paper gives effective pixel number (Neff) maps, not FWHM. Neff rises with wavelength (diffraction) and at band-3 field corners (aberration). Instrument and spacecraft "exceed preflight requirements for PSF size" [IN-FLIGHT] — [Bock et al.](https://arxiv.org/html/2511.02985). No in-flight FWHM numbers found.
- In-flight PSF product: stacked from >1000 stars per zone per band over several hundred exposures, 10× oversampled, deconvolved by the pixel-grid function, on an 11×11 grid (121 zones). Each PSF HDU is 101×101×121 [IN-FLIGHT] — [Akeson et al.](https://arxiv.org/html/2511.15823v2). QR3 adds effective PSFs (ePSFs): 21×21 zones on detectors 1, 2, 4, 5, 6; 11×41 zones on detector 3 (finer along the dispersion direction); 33×33 pixels, 5× oversampled. IRSA recommends them for all images, including QR2 — [IRSA data products](https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-products).
- Pointing jitter is 0.15" rms after a slew, with 19.7 s settle (requirement 1.27") [IN-FLIGHT] — [Bock et al.](https://arxiv.org/html/2511.02985). The pipeline paper says jitter is thought to be <0.1" — [Akeson et al.](https://arxiv.org/html/2511.15823v2).
- Optics: 6 H2RG detectors, one LVF each, in two focal-plane assemblies split by a dichroic at 2.42 µm. Bands: B1 0.75–1.11, B2 1.11–1.64, B3 1.64–2.42, B4 2.42–3.82, B5 3.82–4.42, B6 4.42–5.00 µm. R = 41, 41, 41, 35, 110, 130. 17 channels per band, 102 total [DESIGN] — [Bock et al.](https://arxiv.org/html/2511.02985).
- LVF layout: wavelength varies logarithmically and continuously along one detector axis, with constant 11.8' spacing between channels. The survey steps along the gradient direction between exposures [DESIGN] — [Bock et al.](https://arxiv.org/html/2511.02985). The pipeline paper says consecutive spectral channels are offset by 17' small slews — [Akeson et al.](https://arxiv.org/html/2511.15823v2). These two spacings are not reconciled in the sources.
- Per-pixel central wavelength and bandwidth come from the WCS-WAVE lookup table (~1 nm accuracy, bilinear, for visualization); science use should take CWAVE/CBAND from the Spectral WCS product — [IRSA data products](https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-products).
- Timing: exposures are 116.9 s while pointing is stable (Table 3 uses 112 s for noise). Exposures come in sets of 1–4, separated by small slews. "A typical object gets all channels within about two weeks per survey," with >102 wavelength observations per object per survey. Each exposure gives 6 images, one per detector, taken simultaneously [DESIGN/operational] — [Bock et al.](https://arxiv.org/html/2511.02985).
- Survey planning runs about twice a week on 3.5-day planning periods [IN-FLIGHT] — [Akeson et al.](https://arxiv.org/html/2511.15823v2).

### Inferences
- In one pass, a given star appears in roughly 17+ exposures (≥102 channel-images ÷ 6 detectors), spread over about ≤2 weeks. At 10"/yr (Barnard's Star class), motion within a pass is ≤0.4", which is negligible next to a 6.15" pixel. So treating each pass as a single epoch is valid, and all images in a pass can be stacked astrometrically.
- Because each image of a pass is at a different wavelength, a star's brightness changes from image to image, strongly so for brown dwarfs (bright at 3.9–5 µm, faint below ~1 µm). Alignment and difference images must normalize per image, or compare same-band (same-detector) images between passes. Comparing band-6 images across passes is best for T/Y dwarfs.
- With FWHM ≈ 3" and 6.15" pixels, a point source puts most of its flux in 1–4 pixels. Centroids show pixel-phase bias unless they are fitted with the provided oversampled PSF/ePSF, so a simple flux-weighted centroid will be biased.

### Gaps
- No in-flight FWHM per band or across the focal plane was found (Bock et al. Sec. V.4 and Korngut et al. 2026, [arXiv:2603.29835](https://arxiv.org/abs/2603.29835), should have it; not read).
- Exact distribution of revisit times within a pass (how many hours or days between successive channel steps for a given spot) was not found. Only the "~2 weeks" summary is sourced.

## 2. Survey cadence and data releases (as of Nov 2026)

### Takeaway
There are four all-sky surveys over about 2 years, each taking about 6 months (science operations began 1 May 2025). So a mid-latitude spot gets one ~2-week visit window every ~6 months. Two ~100 deg² ecliptic-pole deep fields are observed every orbit (>400 observations per channel over 2 years). Public images are the "Quick Release" spectral images (QR2 since Oct 2025, QR3 since Sept 2026). Year-1 all-sky products were planned for about Nov 2026.

### Cited Findings
- Launch was 11 March 2025. Science observations began 1 May 2025 after a 50-day checkout. Year 1 observations end May 2026 and Year 2 May 2027 [IN-FLIGHT] — [Bock et al.](https://arxiv.org/html/2511.02985); imaging began May 2025 — [SPIFF](https://arxiv.org/html/2604.22012).
- Four all-sky surveys over 2 years (prime mission 25 months). Each survey covers the sky in about 6 months with >99.5% voxel completeness — [Bock et al.](https://arxiv.org/html/2511.02985); [Akeson et al.](https://arxiv.org/html/2511.15823v2).
- Deep fields: two ~100 deg² fields near the ecliptic poles, observed every orbit (the southern field is offset to avoid the Magellanic Clouds). They get >400 observations per channel at center after 2 years [PLANNED/predicted, Fig. 9], about 50–100× the all-sky redundancy — [Bock et al.](https://arxiv.org/html/2511.02985).
- Releases: quick-release calibrated spectral images come within ~2 months (60 days) of acquisition, updated weekly at IRSA. Year 1 and Year 2 reprocessed data come within 6 months after each collection year ends. The High Reliability Source Catalog is due 8 months after the end of survey 3 (pipeline paper: July 2027). Deep mosaics, stellar/ice/redshift catalogs and legacy catalogs are due May 2028 [PLANNED] — [Bock et al.](https://arxiv.org/html/2511.02985); [Akeson et al.](https://arxiv.org/html/2511.15823v2). All-sky cubes are planned Nov 2026 (Year 1) and Nov 2027 (Year 2) — [Akeson et al.](https://arxiv.org/html/2511.15823v2).
- QR1 weekly releases began July 2025 and were retired Feb 2026 (no longer available). QR2 distribution began Oct 2025, with all QR1 reprocessed; QR2 headers were updated April 2026 to fix PSF-extension header errors. QR3 release began September 2026 — [IRSA data products](https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-products). QR2 DOI is 10.26131/IRSA652 — [SPIFF](https://arxiv.org/html/2604.22012).
- Cutouts keep the same HDUs. To use the PSF cube, map cutout pixels back to the parent image via CRPIX1A/CRPIX2A, then pick the nearest zone (XCTR_i, YCTR_i). The headers are 1-based — [IRSA data products](https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-products).

### Inferences
- By Nov 2026 the sky has survey 1 (May–~Nov 2025), survey 2 (~Nov 2025–May 2026), and part of survey 3 (from May 2026). Given the ~60-day latency, ARCNAVE fields should have 2 full passes plus possibly a partial third. Up to 4 passes is consistent where a field fell at survey boundaries or was revisited. The maximum all-sky baseline available now is about 1–1.3 years. It will reach ~2 years after survey 4 (May 2027) and longer if the mission is extended (no extension info found).
- Fields near the ecliptic poles (deep fields) have near-continuous coverage. There, motion could be fit as a time series rather than discrete 6-month epochs. A known ecliptic-pole-adjacent target would be the best test bed.
- QR2 and QR3 calibrations differ, so mixing QR versions across epochs may add systematic offsets. Prefer one processing version per field.

### Gaps
- Whether the Year-1 reprocessed release or all-sky cubes actually appeared on IRSA by Nov 2026 was not confirmed.
- The visit pattern versus ecliptic latitude outside the deep fields (e.g. whether high-latitude areas get more overlapping coverage per survey because the scan paths converge) was not quantified. SPIFF reports S/N depends only weakly on ecliptic latitude — [SPIFF](https://arxiv.org/html/2604.22012).

## 3. Depth, saturation, and where brown dwarfs are brightest

### Takeaway
Full-mission (4-survey) 5σ point-source depth per channel is about 19.5–19.9 AB at 0.75–3.8 µm and 17.8–18.8 AB at 3.8–5 µm. The in-flight median is 19.7 AB, beating the 18.4 AB requirement. Per-survey depth is roughly 0.75 mag shallower (inferred from √N). Single-image depth is shallower still and was not found as a number. Saturation sets in around 9.7–11.7 AB, so most nearby stars (including Barnard's Star and other bright high-PM stars) are saturated. T/Y dwarfs are brightest at the ~4 µm window (3.9–5 µm, bands 5–6). The coldest (WISE 0855) is reliably detected only redward of 3.9 µm.

### Cited Findings
- Mission depth (4 all-sky surveys, 2 years): 5σ 19.5–19.9 AB (0.75–3.8 µm, R≈40) and 17.8–18.8 AB (3.8–5.0 µm, R≈120). The in-flight median point-source sensitivity is 19.7 AB (Fig. 6 caption). The requirement is 18.4 AB (5σ) per channel in bands 1–4 [abstract figures are mission-end projections from in-flight performance] — [Bock et al.](https://arxiv.org/html/2511.02985).
- The sensitivity figures assume 4 observations per spectral channel for the all-sky case and 200 for the deep fields — [Bock et al.](https://arxiv.org/html/2511.02985).
- Sensitivity is degraded near 1.08 µm (airglow, metastable He) and near 2.4 µm (dichroic) — [arXiv:2606.19875](https://arxiv.org/pdf/2606.19875). Pixels with ≥50% dichroic attenuation carry the DICHROIC flag — [Akeson et al.](https://arxiv.org/html/2511.15823v2).
- A single-visit 5σ point-source sensitivity versus background is plotted in the SPHEREx Sky Simulator paper (numbers not extracted) [predicted] — [arXiv:2505.24856](https://arxiv.org/pdf/2505.24856).
- Saturation is about 11.7–9.7 AB mag across bands. Bands 5–6 are more lenient. Most nearby M dwarfs partly or fully saturate, and stars earlier than ~M4.5 saturate at least one band — [POKEMON-DLC, arXiv:2604.22983](https://arxiv.org/pdf/2604.22983). Saturation is detected on board (sample-up-the-ramp), and stars predicted to saturate are excluded as astrometric calibrators — [Bock et al.](https://arxiv.org/html/2511.02985); [Akeson et al.](https://arxiv.org/html/2511.15823v2).
- Nominal 1-year all-sky 4–5 µm depth is about 14.5 mag Vega (without confusion; crowded-field quality threshold ~2 mag brighter) — [SMDET-1 paper, arXiv:2608.00046](https://arxiv.org/pdf/2608.00046) (from search snippet; not confirmed in the abstract).
- Brown-dwarf performance (QR2, data to 11 Mar 2026): average S/N ≳10 per channel for ultracool dwarfs with W2 ≲ 14.0 mag (Vega). 6,003 L0–Y1 dwarfs were extracted, 947 of them new SPHEREx identifications. Targets needed flux in ≥50 of 102 channels for visual verification — [SPIFF, arXiv:2604.22012](https://arxiv.org/html/2604.22012).
- Spectral shape: for T/Y dwarfs the ~4 µm opacity window is the emergent-flux peak, shifting redward for late-T/Y. For the ≳Y4 WISE 0855−0714 (2.28 pc), "only flux redward of 3.9 µm is detected reliably." CH4 is undetected in Y dwarfs; a weak 3.3 µm CH4 feature appears in a T7 example. K falls below H at T0, and H below J at T4 — [Beiler-type nearby BD sequence paper, arXiv:2607.00543](https://arxiv.org/html/2607.00543). Y dwarfs emit much of their energy beyond 2.4 µm — [SPIFF](https://arxiv.org/html/2604.22012).

### Inferences
- Per-survey (one pass) depth ≈ mission depth − 2.5·log10(√4) ≈ 0.75 mag shallower: about 18.8–19.2 AB in bands 1–4 and about 17.0–18.0 AB in bands 5–6. A single 117 s image (≈1 of the ~1–4 observations per channel per survey) is shallower again, to first order by up to ~0.75 mag. Stacking all images of a pass on the right detector (e.g. all band-6 channels) recovers several tenths of a magnitude more for broadband detection.
- WISE 0855 (W2 ≈ 13.9 Vega, a general-knowledge value to verify) is ≈17.2 AB at 4.6 µm (W2 AB−Vega ≈ +3.3). That is near the per-pass single-channel limit in band 6, so it should be detectable by stacking band-5/6 images in each pass and invisible at <3.9 µm. Its ~8"/yr proper motion (verify) is ~4" (0.65 px) per 6 months and ~1.3 px per year.
- Barnard's Star (K≈4.5, PM ≈10.4"/yr), Luhman 16AB (W2 ≈7, PM ≈2.8"/yr) and ε Indi B (K≈11, PM ≈4.7"/yr; ε Indi A is very bright and saturated nearby) are general-knowledge values to verify in SIMBAD. Barnard's Star and Luhman 16 are far brighter than the ~10–11.7 AB saturation limit in most bands, so they will be saturated and possibly flagged or bled. ε Indi B is near saturation in bands 5–6 (AB ≈ Vega + 3) and may be measurable there, but it sits close to a saturated primary (ε Indi A, ~7'≈70 px away, which may produce ghosts).
- For ARCNAVE: the best targets are 13–17 AB unsaturated stars and T dwarfs with W2 ≈ 10–14 Vega. Very bright high-PM stars need saturation-tolerant centroiding (PSF-wing fitting) or must be excluded.

### Gaps
- No per-exposure 5σ number per channel was found. The Explanatory Supplement and Korngut et al. (arXiv:2603.29835) likely contain it.
- No per-band saturation table with in-flight numbers was found; only the 9.7–11.7 AB range from a secondary source.

## 4. Astrometric precision and artefacts (flag plane)

### Takeaway
Each Level 2 image has a per-image WCS fitted to Gaia (astrometry.net, then SCAMP). The median alignment precision is 0.1–0.4" for images with FINAST = 0, which means rms < 1", and only FINAST = 0 images are released. Main artefacts are cosmic rays/transients (~1.1% of pixels flagged), persistence (modelled and flagged), optical ghosts (beam-splitter ghosts near 2.4 µm; flagged at L2), nonfunctional/hot pixels, saturation, dichroic attenuation, and low-level electrical artefacts.

### Cited Findings
- Fine astrometry (Level 2b): astrometry.net initial solution, refined iteratively by SCAMP against Gaia. Calibrators need a Gaia astrometric solution, SNR > 10, no predicted saturation in any band, and no neighbour within 2 px brighter than 10% of their flux. Median alignment precision is 0.1–0.4" for FINAST = 0 images (FINAST = 0 ⇔ rms < 1"). Coarse L1 pointing is accurate only to 2'–10' [IN-FLIGHT] — [Akeson et al.](https://arxiv.org/html/2511.15823v2). Release requires FINAST = 0, passing QA, being outside the SAA, and <435,000 transient pixels — [Bock et al.](https://arxiv.org/html/2511.02985). The 0.1–0.4" figure is also cited by [arXiv:2606.19875](https://arxiv.org/pdf/2606.19875).
- Transients: the mission-average flagged transient rate is 1.1% of pixels. About 0.1% more pixels are affected in the first 10 s but go unflagged. Rates rise near the poles and the SAA and with solar activity [IN-FLIGHT] — [Bock et al.](https://arxiv.org/html/2511.02985). The ground pipeline adds sigma-clipping on median-filtered images. The 435k threshold triggers re-observation for ~1% of images. Satellite trails and extended cosmic rays are future work — [Akeson et al.](https://arxiv.org/html/2511.15823v2).
- Persistence: a parameterized model of each pixel's cumulative exposure history, with significantly affected pixels flagged. L2a runs in acquisition order per band — [Akeson et al.](https://arxiv.org/html/2511.15823v2); [Bock et al.](https://arxiv.org/html/2511.02985).
- Ghosts: beam-splitter reflection ghosts are noticeable near the 2.4 µm transition, and optical ghosts are flagged in Level 2 — [Bock et al.](https://arxiv.org/html/2511.02985). The pipeline paper lists frame-edge ghosts, out-of-field ghosts, electrical crosstalk and lunar glow masking as future work — [Akeson et al.](https://arxiv.org/html/2511.15823v2).
- Flag bits named in sources: L1 non-functional/bad pixels (NONFUNC). L2 charge spillover, cosmic rays/transients, saturation, missing data, hot pixel, cold pixel, persistence, outlier, DICHROIC, known-source mask, and ghost flags. The bit numbers are in Explanatory Supplement Table 10 (not read) — [IRSA data products](https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-products); [Akeson et al.](https://arxiv.org/html/2511.15823v2); [low-level electrical artifacts paper, arXiv:2608.09862](https://arxiv.org/pdf/2608.09862).
- Early QR2 under-flagging: about half of the observations were affected, the flagging update was not applied retroactively, and spurious flux points remain. The authors masked points >4σ from a smoothed running median — [arXiv:2607.00543](https://arxiv.org/html/2607.00543).
- The SPIFF authors attribute some IRSA-vs-SPIFF photometry differences to a possible mismatch between the supplied astrometry and the true PSF location. The IRSA Spectrophotometry Tool holds the PSF position fixed and does not apply proper motion, while SPIFF lets the position float and propagates user-supplied PM. Parallax is negligible relative to a pixel — [SPIFF](https://arxiv.org/html/2604.22012).

### Inferences
- Per-epoch positional floor: WCS systematics are ~0.1–0.4" per image, partly averaged down over ~17+ images per pass. For a bright unsaturated star (S/N ≳ 100), the centroid error from an ePSF fit to an undersampled 6.15" pixel is likely ~0.1–0.3", so one pass could give ~0.1–0.2" if errors average. For faint sources (S/N ≈ 5–10 per image), per-image centroid error is ~FWHM_eff/SNR ≈ 0.5–1.5" (taking FWHM_eff ~6–8" after pixel convolution), improving by √N in a stacked pass.
- Masking strategy: before alignment and differencing, reject pixels with the transient, persistence, ghost, saturation, nonfunctional, dichroic and known-source flags. Because persistence follows bright stars observed earlier, a "moving" artefact can mimic a mover, so require consistency across several images within a pass.

### Gaps
- No published per-star astrometric residual versus magnitude for SPHEREx (relative to Gaia) was found.
- No numeric description of bright-star bleed or charge spillover extent was found.

## 5. Minimum detectable proper motion and suitable known targets

### Takeaway
No SPHEREx paper measures proper motions. All published work propagates literature PMs for forced photometry. From the astrometric numbers above, with pass-to-pass position errors of ~0.2–0.5" (bright) and ~1–2" (faint), a 3σ motion detection needs roughly ≥1–3"/yr (bright) and ≥5–10"/yr (faint) over 6 months, falling by about ×3 at a 1.5-year baseline. Simple pixel-difference "blinking" without PSF fitting needs ≳1 pixel (6") of motion: ≥12"/yr at 6 months, ≥6"/yr at 1 year, ≥4"/yr at 1.5 years.

### Cited Findings
- Astrometric precision 0.1–0.4" per image (median) — [Akeson et al.](https://arxiv.org/html/2511.15823v2). Pixel 6.15" — same.
- Published SPHEREx BD work uses proper-motion-corrected input positions (forced photometry), not SPHEREx-derived PMs — [SPIFF](https://arxiv.org/html/2604.22012); [arXiv:2607.00543](https://arxiv.org/html/2607.00543). WiseView was used to check motion-induced contamination — [arXiv:2607.00543](https://arxiv.org/html/2607.00543).
- WISE 0855−0714 is detected by SPHEREx redward of 3.9 µm — [arXiv:2607.00543](https://arxiv.org/html/2607.00543). Y dwarfs WISE J2056+1459 (Y0, 7.10 pc), WISE J1541−2250 (Y1, 5.99 pc) and WISE J1828+2650 (Y2?, 9.97 pc) also have SPHEREx spectra — same source. Luhman 16AB and ε Indi B are not named in that paper (the abstract-level fetch checked only part of it).

### Inferences
- σ_Δpos (between two passes) ≈ √2 · σ_pass, and PM_min(3σ) ≈ 3·σ_Δpos / Δt:
  - Bright, unsaturated (σ_pass ~0.2–0.3"): Δt = 0.5 yr → ~1.7–2.5"/yr; 1 yr → ~0.8–1.3"/yr; 1.5 yr → ~0.6–0.8"/yr.
  - Faint (σ_pass ~1–1.5"): 0.5 yr → ~8–13"/yr; 1 yr → ~4–6"/yr; 1.5 yr → ~3–4"/yr.
  These are order-of-magnitude estimates, not published values. They assume a full ePSF fit plus a relative re-alignment on local Gaia stars, which can beat the 0.1–0.4" absolute WCS.
- Parallax: nearby objects (WISE 0855 at 2.28 pc → π ≈ 0.44"; Luhman 16 π ≈ 0.5"; values to verify) shift by up to ~2π between passes 6 months apart (opposite sides of the Sun). That is ~1", comparable to the bright-star error budget, so for <5 pc objects ARCNAVE should model parallax or compare passes one year apart (same parallax phase).
- Target feasibility (PM values from general knowledge; verify in SIMBAD/Gaia):
  - Barnard's Star (~10.4"/yr): motion is easily seen in pixels (~5" per 6 months, ~16" per 1.5 yr), but the star is heavily saturated, so a core-centroid is unreliable. Wing fitting or flagged-pixel-aware centroiding is needed.
  - WISE 0855−0714 (~8.1"/yr): faint, detected only in bands 5–6. Moves ~4"/6 months; ≳1 px per year. Detectable with stacked band-5/6 images and a 1-year baseline. It is absent from Gaia, so ARCNAVE's Gaia check will show "no match" (expected for Y dwarfs).
  - Luhman 16AB (~2.8"/yr): bright (likely saturated in some channels); ~1.4" per 6 months. Detectable only with careful PSF fitting over ≥1 yr. The A/B separation (~1–1.5") is unresolved at 6.15" pixels. It lies in the crowded southern Galactic plane.
  - ε Indi B (~4.7"/yr): ~2.4" per 6 months, near a saturated primary. Feasible with PSF fitting over ≥1 yr.
  - In general, for T/Y dwarfs (absent or faint in Gaia), use bands 5–6. For M/L dwarfs, bands 1–4 have more S/N but saturate for bright nearby stars.

### Gaps
- No published SPHEREx proper-motion catalogue or SPHEREx-based PM detection was found.
- Exact centroid precision versus S/N for SPHEREx's undersampled PSF was not found.

## 6. Published SPHEREx work on moving objects

### Takeaway
SPHEREx moving-object work so far is solar-system focused: the SSO Catalogue collaboration on asteroid spectra, the SOLO ground light-curve support, and comet 3I/ATLAS spectroscopy. For stars, the brown-dwarf pipelines propagate known PMs. No stellar proper-motion discovery paper using SPHEREx was found.

### Cited Findings
- The SPHEREx Solar System Object Catalogue (SSOC) External Collaboration is extracting and calibrating asteroid spectra from year-1 data, with a public catalogue release timeline (EPSC 2026) — [EPSC2026-797](https://meetingorganizer.copernicus.org/EPSC2026/EPSC2026-797.html).
- SOLO is a wide-field ground system to supply asteroid light curves supporting the SPHEREx SSO catalog — [arXiv:2602.08037](https://ar5iv.labs.arxiv.org/html/2602.08037).
- SPHEREx observed interstellar comet 3I/ATLAS (coma, water gas detection) — [JPL PIA26720](https://www.jpl.nasa.gov/images/pia26720-nasas-spherex-examines-comet-3iatlass-coma/); [arXiv:2512.07318](https://arxiv.org/pdf/2512.07318v3).
- Pre-launch: SPHEREx is expected to detect and spectrally classify hundreds of thousands of SSOs at WISE/NEOWISE sensitivity; moving sources "will require care in stitching together the observations" [predicted] — [Lisse et al., arXiv:2402.08705](https://arxiv.org/abs/2402.08705).
- SPIFF (arXiv:2604.22012) is explicitly built for "fast-moving point sources" (high-PM ultracool dwarfs). It queries IRSA SIA2 in a 5" cone at epoch 2025.5, then takes 20×20-pixel cutouts at each image epoch, shifting the PSF start position by the PM. Header download was the main bottleneck. Products are at mocadb.ca and on Zenodo (doi:10.5281/zenodo.19051216) — [SPIFF](https://arxiv.org/html/2604.22012).
- The SMDET-1 Y-dwarf candidate (PM ≈1.3"/yr, [4.5] ≈14.6 Vega, <7.4 pc) was found in unWISE, not SPHEREx — [arXiv:2608.00046](https://arxiv.org/abs/2608.00046).

### Inferences
- SPIFF's design (SIA2 query, cutouts, PM-shifted PSF fit) is the closest published analogue to ARCNAVE's pipeline and a good reference implementation and validation set: 6,003 UCDs with known PMs.
- SPIFF's note that SIA2 queries at a fixed reference epoch need a cone large enough to hold high-PM objects across epochs applies directly to ARCNAVE's IRSA cutout requests.

### Gaps
- No peer-reviewed SPHEREx stellar proper-motion or moving-star discovery paper was found as of Nov 2026.
- Asteroid detection rates and SSO motion-rate limits in SPHEREx images were not found.
