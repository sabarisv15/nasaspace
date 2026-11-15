# Catalogue-based proper-motion searches and PSF-fit astrometry (for ARCNAVE on SPHEREx)

Scope: how surveys (CatWISE, unTimely, Backyard Worlds, Kirkpatrick/CatWISE brown-dwarf work) find movers from per-epoch measurements and fit linear motion. How to measure positions on undersampled and saturated stars. How to cross-match to Gaia DR3 at the right epoch. What of this works in plain browser JS on ~300x300 px cutouts across ~10-40 SPHEREx images.

Note on sources: several full-text PDFs (CatWISE2020, CatWISE Preliminary) were too large to fetch from arXiv, so I read them through ar5iv HTML renderings. The final ~20% of the CatWISE Preliminary HTML was not read.

---

## 1. CatWISE / CatWISE2020: per-epoch positions, motion fitting, precision, false-motion rejection

### Takeaway
CatWISE does not link separate per-epoch catalogues. It detects sources once on a deep stack, then fits a linear-motion PSF model (alpha, delta, mu_alpha, mu_delta) to all the 6-month "epoch coadds" at once, with ascending and descending scans fitted separately to avoid parallax bias. On 2.75" pixels with a ~6" FWHM, it reaches about 10 mas/yr for bright stars, 20-30 mas/yr at W1~15-15.5, and ~100 mas/yr at W1~17. That is roughly 1/100 to 1/1000 of a pixel per year over a 6-8 year baseline. False motions come mostly from blends, artefacts, smearing of fast movers, and PSF/scan asymmetries. Candidates are always checked by eye.

### Cited Findings
- CatWISE Preliminary: 900,849,014 sources from WISE/NEOWISE W1 (3.4 um) and W2 (4.6 um), 2010-2016. Each epoch is a coadd of a six-month subset: 8 epochs over 6.5 years. SNR=5 depth W1=17.67, W2=16.47 (Vega). — [Eisenhardt et al. 2020, arXiv:1908.08902](https://arxiv.org/abs/1908.08902)
- Preliminary accuracy against Gaia: positions ~50 mas at W1=10 and 275 mas at W1=15.5. Proper motions ~10 mas/yr at W1=10 and 30 mas/yr at W1=15.5. — [Eisenhardt et al. 2020](https://arxiv.org/abs/1908.08902)
- WPHOT runs a "stationary fit" and a "motion fit" that solves for alpha, delta, mu_alpha, mu_delta under linear motion. CatWISE treats each unWISE epoch coadd as one image, because fitting every exposure was too expensive. This is justified because a position's exposures within an epoch span only ~2 days, so motion within an epoch is negligible. — [Eisenhardt et al. 2020, ar5iv §III.4](https://ar5iv.arxiv.org/html/1908.08902)
- Ascending and descending scans are fitted separately for most tiles, then merged. This keeps the motions "close to true proper motions" and avoids parallax effects. Combining the two scan directions can bias motions of fast or nearby objects. Using a single PSF for all scans degraded fast-mover results, especially above ~2.5"/yr: the separate-PSF approach recovered 17 of 19 test ultracool dwarfs, versus 13 of 19 with a single PSF. — [Eisenhardt et al. 2020, ar5iv §III.4, §IV.3.3](https://ar5iv.arxiv.org/html/1908.08902)
- unWISE coadds use 2.75" pixels. The measurement PSFs are 8x oversampled relative to WISE pixels. The fitting radius is "rfit=1.25 FWHM (7.5'' for W1 and W2)", which implies FWHM ~6". The bright-star motion floor is "just under 10 mas/yr", with sigma_mu ~ sigma_pos/6 expected. Sensitivity to 100 mas/yr motion reaches ~W1=17. — [Eisenhardt et al. 2020, ar5iv](https://ar5iv.arxiv.org/html/1908.08902)
- In crowded fields (Galactic bulge, Magellanic Clouds), bright-star motion accuracy degrades to ~30 mas/yr and faint stars to ~200 mas/yr or worse. Artefacts flagged include diffraction spikes, scattered-light halos, optical ghosts, and charge persistence. Two fast movers were missed at detection because they were partly blended with brighter neighbours. — [Eisenhardt et al. 2020, ar5iv §III.5, §IV.3](https://ar5iv.arxiv.org/html/1908.08902)
- Saturated stars: no dedicated saturation treatment. A 5.5" match radius was used for bright stars because of "poorer centroiding accuracy expected for highly saturated sources". — [Eisenhardt et al. 2020, ar5iv §IV.1.1](https://ar5iv.arxiv.org/html/1908.08902)
- The Preliminary Catalog reports a chi-square comparing ascending versus descending proper motions, and the separation between the two apparitions. Its parallax estimate (from the ecliptic-longitude difference between ascending and descending solutions propagated to a common epoch) is described as having negligible significance given its uncertainty. — [IRSA CatWISE docs, summarised via search](https://irsa.ipac.caltech.edu/data/WISE/CatWISE/gator_docs/CatWISE2020README_IRSA.txt)
- CatWISE2020: 1,890,715,640 sources, data from 2010-01-07 to 2018-12-13, 12 epoch coadds. Detection uses *crowdsource* (Schlafly et al. 2019), which roughly doubles the source count. 90% completeness W1=17.7, W2=17.5. Motion precision ~20 mas/yr at W1~15 and ~100 mas/yr at W1~17, a 12x improvement over AllWISE. Bright floor ~6-7 mas/yr. — [Marocco et al. 2021, arXiv:2012.13084](https://arxiv.org/abs/2012.13084); [ar5iv](https://ar5iv.arxiv.org/html/2012.13084)
- CatWISE2020 fits positions, fluxes, and motions jointly in both bands on the epoch coadds, with active deblending turned off. The motion-uncertainty floor was lowered from 10 to 1 mas/yr, which makes motion chi-square values worse. Against 224 nearby ultracool dwarfs, the dispersion is ~29 mas/yr with a ~12 mas/yr median offset. — [Marocco et al. 2021, ar5iv](https://ar5iv.arxiv.org/html/2012.13084)
- Fast movers get "smeared" in full-depth detection coadds. A single fast mover can produce up to seven spurious detections, and later detections get progressively worse measurements. Example: WISE J0855-0714 appears 5 times in the catalogue, and only 3 of those have motions consistent with the literature. — [Marocco et al. 2021, ar5iv](https://ar5iv.arxiv.org/html/2012.13084)
- Catalogue membership requires being primary in its tile and SNR>=5 in W1 or W2 with no artefact flag (ab_flags) in that band. Completeness drops below ~50% near W1~4.3, W2~3.6. Very bright stars (W1<~5) are often lost in PSF fitting, likely because of saturated cores. For bright stars the paper recommends AllWISE. — [Marocco et al. 2021, ar5iv](https://ar5iv.arxiv.org/html/2012.13084)
- Formal CatWISE motion uncertainties are underestimated. One discovery paper multiplied them by ~1.6 to match the observed dispersion at W2~16 (see §2). A search summary reports a factor ~2.1 near W1~17.2 from Marocco et al. I could not confirm that number in the text I read. — [Meisner et al. 2019 CWISEP J1935, ar5iv](https://ar5iv.arxiv.org/html/1906.08913); [search summary of Marocco 2021](https://ar5iv.arxiv.org/html/2012.13084)

### Inferences
- Scale to SPHEREx: CatWISE's bright-star position error (~50 mas on 2.75" pixels) is ~1/55 pixel per epoch coadd. Its motion floor comes from a 6-8 yr baseline with 8-16 epochs. ARCNAVE has 2-4 epochs over ~0.5-1.5 yr on 6.2" pixels. So its motion sensitivity will be orders of magnitude worse, plausibly only stars moving >~1"/yr at good S/N. The current ">=2 arcsec shift" threshold is consistent with that.
- The CatWISE design maps directly onto SPHEREx. Fit one motion model jointly to all frames at once (forward modelling) rather than measuring each frame and linking. Joint fitting uses faint per-frame signal that per-frame detection would miss, which is the "missing faint movers" problem.
- SPHEREx has no ascending/descending scan split. However, each pass is ~6 months apart, so parallax enters as an annual term. For nearby stars (e.g. Epsilon Indi, parallax ~0.27") it is well below one 6.2" pixel but not negligible against a 2" threshold if combined with pm. A 2-parameter mu fit over 6-month-separated passes partially absorbs parallax. This is the same bias CatWISE avoided by separating scans.

### Gaps
- I did not read the exact WPHOT motion-fit equations or the specific motion-quality flags (e.g. per-component PM chi-square cut values) in full text. No explicit recommended "PM significance" cut was found in CatWISE2020.

---

## 2. How movers are confirmed and labelled (Kirkpatrick, unTimely, Backyard Worlds, CatWISE discoveries)

### Takeaway
Every survey treats a catalogue motion as a candidate. The steps are: visual inspection of epoch images (WiseView / flipbooks); cross-checking archival catalogues (SIMBAD, VizieR, 2MASS, Pan-STARRS, Gaia); refitting motion with extra epochs; then follow-up (Spitzer photometry, spectroscopy, parallax) before calling something "discovered" or "confirmed". The common false positives are artefacts, variable stars (partial subtraction producing "dipoles"), and blends.

### Cited Findings
- CWISEP J1935-1546 (CatWISE discovery): candidates were selected by an XGBoost classifier on colour (W2>14, W1-W2>1), not by a PM cut. The top 10,000-25,000 objects per round were visually inspected in DSS, 2MASS, UKIDSS, PanSTARRS, and AllWISE using WiseView. Objects were kept only if real, red, and visibly moving. Common false positives were unflagged artefacts, "variable sources producing spurious motion", and blends. Of 131 candidates, 32 were prioritised for follow-up, which was needed to "confirm/refute" their nature. — [Marocco et al. 2019 (CWISEP J193518.59-154620.3), ar5iv](https://ar5iv.arxiv.org/html/1906.08913)
- In the same paper, the per-epoch astrometry was re-registered to Gaia DR2 using ~700 reference stars per epoch (sigma<0.1", W1>8.1, W2>6.7 to avoid saturation, match radius 2.75"). They used a 6th-order transformation with 3-sigma clipping. The CatWISE motion (400±100, -90±120 mas/yr) was refit with a Spitzer epoch to 337±69, -50±97 mas/yr. A 5-parameter fit gave an unphysical parallax (-100±440 mas), so the linear fit was adopted. The source was undetected in 2 of 9 epochs. — [ar5iv 1906.08913](https://ar5iv.arxiv.org/html/1906.08913)
- unTimely: crowdsource runs independently on each ~16 biannual unWISE epoch coadd (2010-2020), with low thresholds (S/N 4.0 in W1, 2.5 in W2). This gives 23.5 billion W1 and 19.9 billion W2 detections, ~1.3 mag deeper than WISE single exposures near the ecliptic. Intended uses are faint fast movers (Y dwarfs, T/Y subdwarfs) and variability. The abstract does not prescribe a cross-epoch linking algorithm. — [Meisner et al. 2023, arXiv:2209.14327](https://arxiv.org/abs/2209.14327)
- Backyard Worlds: volunteers view flipbooks of 4 difference images from time-resolved unWISE coadds (256x256 px subtiles). A "mover" moves more than one W1/W2 FWHM over the ~4.5-yr baseline. A "dipole" moves less than one FWHM and shows as a negative/positive pair. Volunteers tag #mover/#dipole, and advanced users check SIMBAD/VizieR and submit via a web form. False positives: partially subtracted stars/galaxies (variability or small alignment errors), cosmic rays, ghosts, latents. — [Kuchner et al. 2017, ar5iv 1705.02919](https://ar5iv.arxiv.org/html/1705.02919)
- The first Backyard Worlds object (WISEA 1101+5400) was "identified as a candidate from volunteers". Its motion was fitted from 2MASS-Reject, Pan-STARRS, and AllWISE epochs (-718.7±9.9, 56.2±23.2 mas/yr). It was confirmed only by an IRTF/SpeX spectrum (T5.5±0.5, 34±5 pc). — [Kuchner et al. 2017](https://ar5iv.arxiv.org/html/1705.02919)
- A 2018 Backyard Worlds update reported 42 spectroscopically confirmed brown dwarfs from 879 candidates. This is a secondary source (Wikipedia-derived), so treat the figures with caution. — [Wikipedia: Backyard Worlds](https://en.wikipedia.com/wiki/Backyard_Worlds)
- Kirkpatrick et al. 2021: the 20-pc census of 525 L, T, Y dwarfs used CatWISE motions and was assisted by Backyard Worlds volunteers. — [VizieR J/ApJS/253/7](https://dc.g-vo.org/rr/q/lp/custom/CDS.VizieR/J/ApJS/253/7); [ScienceDaily](https://sciencedaily.com/releases/2021/01/210114130135.htm)

### Inferences
- Recommended labelling for ARCNAVE, mirroring these surveys: "known mover (Gaia/SIMBAD match)", "motion candidate (no catalogue match)", and "rejected (artefact/blend/variable/edge)". Never "discovery". The UI should tell users that confirmation needs independent epochs or catalogues and, for new objects, spectroscopy/parallax.
- The Backyard Worlds "dipole vs mover" split is a useful UI concept. Shifts under ~1 FWHM (under ~1 SPHEREx pixel) are dipole-like and need fitted centroids. Larger ones can be seen by eye.

### Gaps
- I did not read Kirkpatrick 2019/2021 methods in full. The precise candidate-vetting criteria used for the 20-pc census (e.g. motion thresholds, number of epochs) are not extracted. Meisner et al. 2020 (Backyard Worlds discoveries) was not fetched.

---

## 3. Linking per-frame detections into a linear mover with 2-4 epochs and several images per epoch

### Takeaway
None of the sources I read describe a published "link per-frame detections" algorithm for this regime. CatWISE avoids linking by fitting motion jointly to all epoch images. unTimely leaves linking to users. The proven pattern is: register every frame to a reference catalogue (Gaia) with sigma clipping; average within an epoch, since motion is negligible within ~days; fit position = p0 + mu*(t - t0) by weighted least squares across epochs; then test chi-square and require detection in multiple epochs, followed by visual check.

### Cited Findings
- Within an epoch (~2 days for WISE), motion is negligible, so all exposures from one epoch can be treated as one measurement. — [Eisenhardt et al. 2020, §III.4](https://ar5iv.arxiv.org/html/1908.08902)
- Per-epoch registration to Gaia with a polynomial transform plus 3-sigma clipping, then a linear motion fit; a 5-parameter (parallax) fit was rejected when unphysical. — [ar5iv 1906.08913](https://ar5iv.arxiv.org/html/1906.08913)
- Ascending-versus-descending consistency is tested with a per-component chi-square (1 dof each). This is a model for an "epoch A vs epoch B consistency" test. — [IRSA CatWISE docs](https://irsa.ipac.caltech.edu/data/WISE/CatWISE/gator_docs/CatWISE2020README_IRSA.txt)
- Fast movers smeared in a deep stack produce multiple spurious detections. Detection on a deep sum of all epochs misses or splits fast movers. — [Marocco et al. 2021](https://ar5iv.arxiv.org/html/2012.13084)
- A moving target is less robust if it is missing from some epochs; CWISEP J1935 was undetected in 2 of 9 epochs and still fitted. — [ar5iv 1906.08913](https://ar5iv.arxiv.org/html/1906.08913)
- Theory: the Cramér-Rao astrometric bound scales as (S/N)^-1 and is very sensitive to background. Estimators include ML, LS, and WLS. — [Mendez et al. 2014, arXiv:1407.3753](https://arxiv.org/pdf/1407.3753); [Espinosa/Mendez review 2025](https://arxiv.org/html/2512.04326v1)

### Inferences (proposed ARCNAVE algorithm, not a published one)
1. **Per-frame catalogue.** In every image (all wavelengths, all passes), detect peaks down to ~4-5 sigma, as unTimely does at S/N 4. Measure a PSF-fit or windowed centroid with an error estimate.
2. **Per-frame astrometric registration.** Match frame detections to Gaia DR3 stars propagated to that frame's epoch. Fit an affine (or low-order) WCS correction with 3-sigma clipping. Use non-saturated reference stars only, as CWISEP did by excluding bright stars. This removes per-image WCS errors, which otherwise masquerade as motion.
3. **Within-pass grouping.** Images in a pass are taken days apart (to verify against SPHEREx metadata). Cluster detections within a pass with radius ~1-1.5 pixels, then compute a weighted-mean position plus scatter. Scatter between wavelengths also flags blends: chromatic centroid shifts happen when two sources of different colours overlap.
4. **Cross-pass linking.** For 2 passes, every pass-1 source may pair with any pass-2 source within r_max = mu_max * dt. Take r_max ~10-30" for mu_max of a few "/yr. Prefer the nearest unmatched neighbour after removing static matches (sources matched within ~1 sigma). For 3-4 passes, fit p0 + mu*t and require chi-square/dof < ~2-3. A linear track over 3+ epochs is a strong discriminator against chance pairings. Optionally add a parallax term only when the Gaia parallax is known; do not fit it freely with 2-4 epochs (cf. the unphysical result in CWISEP J1935).
5. **Mover criteria (suggested).** Motion significance |mu|/sigma_mu >= 5. Detected in >= 2 passes, and >= 2-3 images per pass. Consistent motion across wavelengths. Not near saturation, edges, or another bright source. Then label it a candidate.
6. **Forced photometry/forced position.** For faint sources, fit the PSF at the predicted track position (p0 + mu*t) in every frame. This is the joint-fit idea from CatWISE and is how to "draw the path through every frame".
7. Practicality in JS: ~40 frames x ~a few hundred to a few thousand detections is trivial for O(N log N) grid-hash neighbour search plus 2x2/4x4 weighted least squares. All of steps 1-6 are feasible in plain JavaScript in well under a second per field.

### Gaps
- No source found giving a published minimum number of detections to call something a mover. CatWISE uses a joint fit, not a detection count. The thresholds above are recommendations.
- SPHEREx time spacing of images within a pass was not verified here.

---

## 4. PSF-fit / centroid methods on undersampled pixels; saturated stars; JS practicality

### Takeaway
On undersampled data, simple centroids and Gaussian fits carry pixel-phase bias. The proven fix is an effective PSF (ePSF: the PSF already integrated over the pixel, Anderson & King 2000), built oversampled from many stars and fitted by least squares on a small window. HST achieved ~0.02 pixel per star per image with it. SPHEREx is severely undersampled: its PSF is narrower than a pixel at short wavelengths and ~5-7" at long wavelengths. Its team built sub-pixel PSFs by stacking point sources. For saturated stars, mask the saturated/blanked pixels and fit the PSF model only to unsaturated wings. Never take the peak or centroid of a blanked core.

### Cited Findings
- Anderson & King 2000: for undersampled images, the ePSF (not the instrumental PSF) holds the information needed for accurate positions. They iterate between the ePSF model and star positions using dithered exposures. Results: 0.02 pixel precision for a single reasonably bright star in one image, systematic accuracy better than 0.002 pixel, and sqrt(N) improvement when combining N observations. — [Anderson & King 2000, arXiv:astro-ph/0006325](https://arxiv.org/abs/astro-ph/0006325)
- photutils: undersampled PSFs are those with FWHM < ~2 pixels. A sampled PSF is sharper than the image, and its flux sum depends on sub-pixel position, so fit pixel data with PRF/ePSF models (pixel-integrated). Build an ePSF from observed stars, which needs "a large number of isolated stars". fit_shape should be small, e.g. (5,5). NaN/inf pixels are masked automatically and a user mask can be passed, which is the mechanism for excluding saturated pixels. IterativePSFPhotometry fits, subtracts, and re-detects (DAOPHOT-like) to recover sources hidden by brighter ones. — [photutils PSF docs](https://docs.astropy.org/projects/photutils/en/stable/user_guide/psf.html)
- SPHEREx: 6.2" pixels from 0.75 to 4.8 um. The optical FWHM is ~2.01" at 0.75 um, roughly 0.3 pixel per FWHM, far below Nyquist. Point-source stacking plus iterative back-projection reconstructs a sub-pixel PSF. — [Symons et al. 2021, arXiv:2102.01094](https://arxiv.org/pdf/2102.01094)
- The earlier SPHEREx forecast paper gives a 5-7" FWHM depending on wavelength (under-sampled; the source alignment with the grid changes the observed shape). — [Doré et al. 2014, arXiv:1412.4872](https://arxiv.org/pdf/1412.4872). There is a conflict with the 2.01" at 0.75 um figure; the PSF likely broadens strongly with wavelength.
- The astrometric Cramér-Rao bound scales as (S/N)^-1 and depends strongly on background and on pixel offset in the undersampled regime. Tables cover pixel offsets of 0.125-0.25 px at S/N 5, 30, 100. — [Mendez et al. 2014](https://arxiv.org/pdf/1407.3753)
- Even professional pipelines degrade on saturated stars: CatWISE loses many W1<~5 stars in PSF fitting because of saturated cores, and uses wider match radii for them. CWISEP astrometric re-registration excluded bright stars (W1<8.1). — [Marocco et al. 2021](https://ar5iv.arxiv.org/html/2012.13084); [Eisenhardt 2020](https://ar5iv.arxiv.org/html/1908.08902); [ar5iv 1906.08913](https://ar5iv.arxiv.org/html/1906.08913)

### Inferences
- **Rule-of-thumb precision (not from a source read here; standard result):** sigma_pos ~ FWHM / (2.35 * S/N) for a well-sampled Gaussian. For undersampled SPHEREx at short wavelengths (FWHM < pixel), the effective width is ~ pixel/sqrt(12) convolved with the PSF, so expect sigma ~ 0.3-0.5 pixel / (S/N) in pixels. Example: S/N 50 gives ~0.01 pix, ~60 mas. Add a pixel-phase systematic of up to several 0.01 pix unless an ePSF is used. Anderson & King's 0.02 px is a good target for bright, unsaturated stars.
- **Methods ranked for JS on cutouts:**
  1. *Windowed / iterative weighted centroid* (Gaussian-weighted, SExtractor-style XWIN) on a 5x5 window. Trivial in JS, but pixel-phase biased when undersampled. Good as a first guess.
  2. *2D Gaussian (or Moffat) least-squares fit* (6-7 params, Levenberg-Marquardt) on 5x5-7x7 px. ~50 lines of JS, microseconds per star. Fit the pixel-integrated Gaussian (erf differences), not point-sampled values, to reduce undersampling bias. This is the cheapest "ePSF-like" fix.
  3. *Empirical ePSF per wavelength band*: stack ~50-200 isolated Gaia stars per image at known sub-pixel phases (Gaia positions give the phase). Build a 4x-oversampled grid, then fit only flux, x, y, and background by bilinear/bicubic interpolation. This is feasible in JS for 300x300 cutouts. Gaia provides precise sub-pixel positions, which removes Anderson & King's iteration step.
- **Saturated stars (Epsilon Indi A case):** build a mask from blanked/NaN/flagged pixels plus a 1-pixel dilation. Fit the PSF/ePSF (or a wide Moffat with fixed shape from unsaturated stars) to the unmasked wings only, solving for x, y, and flux. If the PSF has diffraction spikes at the bright end, their intersection gives the centre independently (cross-correlate spike pattern). Fallback: a symmetric-ring fit (centre of a circle fitted to the saturation-boundary pixels). Always set a flag ("saturated: wing-fit") and widen the reported uncertainty, as CatWISE widened match radii. A 24" error (≈4 pixels) means the peak-on-rim failure should be eliminated entirely by masking.
- Use per-wavelength PSFs because SPHEREx PSF width changes with wavelength.

### Gaps
- No source here gives the measured SPHEREx in-flight PSF FWHM per band or its diffraction-spike structure. Check the SPHEREx Explanatory Supplement/IRSA docs.
- No published precision for wing-only fits to saturated undersampled stars was found.

---

## 5. Cross-matching to Gaia DR3 at the right epoch; fallbacks for faint/red sources

### Takeaway
Gaia DR3 positions are at epoch J2016.0 (TCB). Propagate each Gaia star to every SPHEREx frame's epoch (at least linearly: ra/dec + pm*dt, including parallax for nearby stars) before matching. Use a match radius set by the SPHEREx position error plus Gaia propagation error. Sources with only 2-parameter Gaia solutions have no motion. Red/faint brown dwarfs may be absent from Gaia (G limit ~21), so fall back to CatWISE2020 (W1/W2, motions to ~W1 17) and 2MASS (epoch ~1998-2001, long baseline).

### Cited Findings
- Gaia DR3: ref_epoch 2016.0, data from 2014-07-25 to 2017-05-28. 585.4M 5-parameter, 882.3M 6-parameter, and 344.0M 2-parameter (position-only) solutions. Limits G~3 to G~21. PM precision ~0.02-0.03 mas/yr (G<15), 0.07 (G=17), 0.5 mas/yr (G=20). — [ESA Gaia DR3 page](https://www.cosmos.esa.int/web/gaia/dr3)
- gaia_source: ref_epoch is "Reference epoch to which the astrometric source parameters are referred, expressed as a Julian Year in TCB". astrometric_params_solved = 3 (2-param), 31 (5-param), 95 (6-param). Columns pmra, pmdec (mas/yr), parallax, with errors and correlations. — [Gaia DR3 datamodel](https://gea.esac.esa.int/archive/documentation/GDR3/Gaia_archive/chap_datamodel/sec_dm_main_source_catalogue/ssec_dm_gaia_source.html)
- CatWISE2020 coordinates are ICRS at MJD 57170 (~2015.4); the Preliminary catalogue used MJD 56700. Small tile-dependent astrometric offsets exist because the unWISE coadds were not adjusted to AllWISE epochs. — [search summary of CatWISE2020 docs](https://irsa.ipac.caltech.edu/data/WISE/CatWISE/gator_docs/CatWISE2020README_IRSA.txt)
- CatWISE2020 motions reach ~100 mas/yr precision at W1~17, which suits red/cold brown dwarfs too faint for Gaia. Brown dwarf searches (CWISEP J1935) used 2MASS, PanSTARRS, and UKIDSS images to inspect, and 2MASS-Reject/PanSTARRS epochs to extend baselines. — [Marocco 2021](https://ar5iv.arxiv.org/html/2012.13084); [ar5iv 1906.08913](https://ar5iv.arxiv.org/html/1906.08913); [Kuchner 2017](https://ar5iv.arxiv.org/html/1705.02919)

### Inferences
- JS implementation: query Gaia DR3 (TAP, a cone around the field) once per field. For each frame epoch t (decimal year from the SPHEREx MJD), compute dt = t - 2016.0, then dDec = pmdec*dt and dRA = pmra*dt / cos(dec) (pmra already includes cos dec), plus the parallax factor if parallax > ~20 mas. Over ~10 yr, a 1"/yr star shifts 10", well over a SPHEREx pixel. Matching unpropagated Gaia positions is a known cause of "off by many arcsec" errors.
- Match radius: max(3 sigma_SPHEREx, ~1 pixel) for normal stars, and a wider radius for saturated stars (cf. CatWISE's 5.5"). Prefer a match in the predicted motion direction for high-PM stars.
- Movers with no Gaia match: query CatWISE2020 (it gives its own PM at MJD 57170) and 2MASS (epoch per source). If neither exists, label the source "unmatched motion candidate".
- A SPHEREx mover consistent with the Gaia PM vector (direction and magnitude within errors) confirms the pipeline. A mismatch indicates a measurement problem (blend, saturation), not a discovery.

### Gaps
- The exact CatWISE2020 PM-uncertainty inflation factor near W1 17 (~2.1 reported in a search summary) was not verified in primary text.
- I did not find SPHEREx-specific astrometric (WCS) accuracy figures. The size of the per-frame registration correction needed is therefore unknown.
