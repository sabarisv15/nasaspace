# Difference Imaging and Residual-Dipole Detection for Moving Point Sources (applied to SPHEREx in a browser)

## Q1. How do Alard-Lupton, HOTPANTS and ZOGY PSF-match and subtract? Which is simplest in JS on a ~300x300 px cutout?

### Takeaway
All three methods match the two images' PSFs and subtract them. Alard-Lupton and HOTPANTS fit a convolution kernel by linear least squares and blur the sharper image to match the other. ZOGY and its motion-specific relative "translient" are closed-form FFT statistics that need a known PSF for each image. For a 300x300 cutout, ZOGY with the SPHEREx ePSF is the most compact to code. It needs only an FFT and PSFs, which SPHEREx supplies. A small delta-function (Bramich) kernel is the most robust least-squares option when the PSF model is uncertain.

### Cited Findings
- Alard & Lupton (1998, ApJ 503, 325) is designed to subtract two images taken in different seeing. Writing the convolution kernel as a sum of basis functions turns kernel fitting into a standard linear least-squares problem. — [arXiv astro-ph/9712287](https://arxiv.org/abs/astro-ph/9712287)
- The AL98 basis functions are Gaussians multiplied by polynomials, which can represent complicated kernel shapes. In practice, about 3 Gaussians with polynomial degrees 2-6 leave residuals comparable to photon noise. Alard (2000) added a spatially varying kernel, which became the standard in difference image analysis (DIA). — [search summary of AL98 and later papers](https://optimal-image-subtraction.readthedocs.io/en/stable/methods.html); [Bramich 2008](https://ar5iv.labs.arxiv.org/html/0802.1273)
- ISIS2.2 (Alard's code) defaults to Gaussian sigmas of 0.7, 2.0 and 4.0 px with polynomial degrees 6, 4 and 3. The user must choose these values. — [Bramich 2008](https://ar5iv.labs.arxiv.org/html/0802.1273)
- HOTPANTS ("High Order Transform of PSF ANd Template Subtraction"; Becker 2015, ascl:1504.004) implements the Alard-Lupton approach. It fits a spatially varying kernel and is used by the iPTF and DES pipelines. The ASCL entry cites Alard 1999/2000, while pipeline papers cite AL98. — [ASCL 1504.004](https://ascl.net/1504.004); [iPTF pipeline, arXiv 1608.01006](https://arxiv.org/pdf/1608.01006); [DES diffimg, arXiv 1507.05137](https://arxiv.org/pdf/1507.05137)
- Bramich (2008) uses a "delta-function" kernel: every kernel pixel is a free parameter, solved together with a constant differential background (N_K+1 unknowns). The solution is iterated with 3-sigma pixel rejection, and the kernel is circular to keep it symmetric. In the tests, kernels had 317 pixels on a 10x10 grid of sub-regions. — [Bramich 2008](https://ar5iv.labs.arxiv.org/html/0802.1273)
- Bramich's kernel corrects sub-pixel misalignment. In a half-pixel-shift test ISIS2.2 failed to reproduce the kernel, while the delta-function kernel did "a nearly perfect job". Kernels built from basis functions centred on the origin "may only partly compensate for sub-pixel translations". The paper recommends against excessively large kernels and gives no runtime figures. — [Bramich 2008](https://ar5iv.labs.arxiv.org/html/0802.1273)
- ZOGY (Zackay, Ofek & Gal-Yam 2016, ApJ 830, 27) is a closed-form proper-subtraction statistic. The authors claim it is optimal for detection when background noise dominates and that it is numerically stable. They also claim it leaves no subtraction artifacts for well-registered, adequately sampled images, has white noise, is symmetric between new and reference images, and is at least 10x faster than some popular methods. The paper includes extensions for registration errors and colour refraction. — [arXiv 1601.02655](https://arxiv.org/abs/1601.02655v2)
- Public ZOGY code exists in Python (Vreeswijk et al.) and in Ofek's MATLAB `subtract_proper`. — [GitHub ZOGY](https://github.com/KerryPaterson/ZOGY); [Ofek MATLAB doc](https://webhome.weizmann.ac.il/home/eofek/matlab/doc/subtract_proper_Content.html)
- ZOGY handles astrometric error by adding the measured global or regional astrometric noise to the variance. This "ignores flux residuals" and does not measure motion. A source displaced by more than the assumed astrometric noise will probably still be detected. — [Springer, Ofek et al. 2024 (translient), arXiv 2403.09771](https://arxiv.org/html/2403.09771v1)

### Inferences
- **Cost on a 300x300 cutout.** ZOGY needs a few 2-D FFTs (pad to 512x512) plus pointwise complex arithmetic. In plain JS with a radix-2 FFT, this is roughly tens of milliseconds per frame pair. AL or Bramich need a normal-equations matrix: with a 7x7 delta kernel (about 37 unknowns in circular form) on 90k pixels, the build costs about 90k x 37² ≈ 1.2e8 multiply-adds, then a tiny solve. That is also well under a second. Both are feasible in a browser. These are my estimates, not published benchmarks.
- **Choosing a method.**
  - ZOGY relies on accurate PSFs for both images. SPHEREx ships an ePSF per detector zone (see Q4), so this suits ZOGY well. However, ZOGY's "no artifacts" guarantee assumes adequate sampling, and SPHEREx is undersampled.
  - AL or Bramich fit the kernel empirically from the stars in the cutout, so they need no PSF model. A 300x300 SPHEREx cutout (about 0.5° across) contains enough stars to fit a single constant kernel.
  - Suggested order: (a) small constant Bramich delta kernel plus constant background, which is easiest to debug. (b) ZOGY or translient using the ePSF.
- Translient (Q2) is the statistic built specifically for "point source moved slightly". It costs the same as ZOGY: the same FFT terms, plus a gradient (k-vector) factor.

### Gaps
- I found no published runtime benchmarks for HOTPANTS or ZOGY on small cutouts, and no JS implementations.
- I did not obtain the full ZOGY equations from the PDF here. Use arXiv 1601.02655 Sec. 3 and the Python repo for the formulas.
- I could not verify the default HOTPANTS kernel configuration, because the original Becker documentation was not fetched.

## Q2. How does a moving star appear in a difference image, and how do surveys detect and measure dipoles? What motion (relative to the PSF FWHM) is needed?

### Takeaway
- **Motion below about one FWHM:** the difference is a positive/negative pair, a "dipole".
- **Motion above about one FWHM:** two separated, opposite-sign PSFs, called a "mover" in Backyard Worlds.
- **Sub-PSF motion:** dipole fits are degenerate between flux and separation below about 1 PSF sigma unless the pre-subtraction images are fitted too. The translient statistic is the published optimal test for small shifts, and it beats ZOGY's S statistic up to about 2 FWHM of separation.

### Cited Findings
- **Backyard Worlds definitions.**
  - "Movers" travel more than one W1/W2 FWHM over the ~4.5-yr baseline.
  - "Dipoles" move less than one FWHM in total and appear as a negative image next to a positive one.
  - Volunteers tag them in Zooniverse Talk with #dipole and #mover. The first discovery (WISEA 1101+5400, ~0.7"/yr) was flagged as a "small dipole".
  — [Kuchner et al. 2017, arXiv 1705.02919](https://ar5iv.arxiv.org/html/1705.02919)
- **Backyard Worlds flipbook recipe.**
  - Inputs: four time-resolved unWISE epochs, cut into 256x256 px subtiles.
  - Each epoch minus the median of the opposite-pair epochs (1 and 2 vs median of 3 and 4, and the reverse).
  - Clip to −0.5σ..9.5σ, subtract a 12x12 tophat-smoothed copy to remove background, then apply an arcsinh(10x) stretch.
  - Colours: W1 is blue, W2 is red, and their mean is green.
  - Noise comes within about √2 of the Poisson floor.
  — [Kuchner et al. 2017](https://ar5iv.arxiv.org/html/1705.02919)
- **LSST/Rubin DP1:** dipoles are sources that moved only slightly, less than the PSF, between template and visit. The pipeline uses Alard & Lupton subtraction plus a plugin that classifies diaSources as dipoles. — [Rubin DP1 DIA docs](https://dp1.lsst.io/processing/dia/index.html); [lsst.ip.diffim](https://pipelines.lsst.io/modules/lsst.ip.diffim/)
- **LSST DipoleFitTask:**
  - Fits a positive and a negative PSF to the difference image, optionally using the separate pre-subtraction images.
  - If posExp is missing, it reconstructs it as diff + negExp.
  - Falls back to SdssCentroid when a source lacks both positive and negative peaks.
  — [DipoleFitTask API](https://pipelines.lsst.io/py-api/lsst.ip.diffim.DipoleFitTask.html)
- **DMTN-007 (Reiss 2016), dipole fit setup:**
  - Detection runs on the difference image in both positive and negative modes.
  - The model has two PSF lobes (centroids and fluxes, with an option to force equal fluxes) plus a polynomial background, 1st order by default.
  - Fits start at the footprint peaks, centroids are bounded to ±5 σ_PSF, and fluxes must be positive.
  — [DMTN-007](https://dmtn-007.lsst.io/)
- **DMTN-007, accuracy and cost:**
  - Unconstrained fits cannot measure flux or separation accurately below about 1 σ_PSF, because separation and flux are highly covariant. A bright, close dipole looks like a faint, wide one.
  - Adding the two pre-subtraction images to the fit, down-weighted to 5%, substantially improves accuracy. It can cost up to 3x in runtime and may fail on steep backgrounds.
  - Each fit takes about 10 ms per dipole in Python.
  — [DMTN-007](https://dmtn-007.lsst.io/)
- **Translient statistic:**
  - Z² = ‖Im[z]‖², where z is the inverse FFT of (4πk/m)·conj(P̂n)·conj(P̂r)·(P̂n·R̂ − P̂r·N̂)/(|P̂r|²σn² + |P̂n|²σr²).
  - It is the most powerful test for a small translation in any direction. It is χ² distributed with 2 degrees of freedom and anti-symmetric when the two images are swapped.
  - In noise-only tests the maximum Z² was about 11, a per-pixel false-alarm probability of about 0.004.
  — [Springer et al. 2024, arXiv 2403.09771](https://arxiv.org/html/2403.09771v1)
- **Translient vs ZOGY:**
  - For shifts of 0.8–1.4 px (small compared with the PSF), translient had a higher true-positive rate than ZOGY at every false-positive rate.
  - On real data, Zσ exceeded |S| while the shift was within about 2 FWHM. Beyond that, |S| took over.
  - A stationary variable gives |S| > Zσ. The authors recommend computing both and using the ratio to tell motion from variability.
  — [Springer et al. 2024](https://arxiv.org/html/2403.09771v1)
- **unTimely:**
  - Builds a separate catalogue for each roughly 6-month WISE epoch rather than differencing, to avoid smearing fast movers in static coadds.
  - A 10"/yr mover smears only about 27 mas (about 4x10⁻³ FWHM) within a single ~1-day epoch coadd.
  - WISE has 2.75" pixels and a ~6.5" PSF FWHM, with about 16 epochs per band.
  - The paper does not discuss dipoles.
  — [Meisner et al. 2023, arXiv 2209.14327](https://ar5iv.labs.arxiv.org/html/2209.14327)

### Inferences
- **Approximate dipole S/N (my derivation; Gaussian PSF, background-limited, equal noise in both epochs, not from a cited source).**
  - The difference of a PSF shifted by d is about d·∇PSF.
  - Single-image centroid error is σ_x ≈ √2·σ_PSF/ν, where ν is the source's flux S/N. Differencing raises this by √2.
  - Hence dipole S/N ≈ ν·d/(2σ_PSF) ≈ 1.2·ν·d/FWHM.
  - A 5σ dipole therefore needs ν ≈ 4.2/(d/FWHM): ν ≈ 42 at d = 0.1 FWHM, ≈ 17 at 0.25 FWHM, and ≈ 8 at 0.5 FWHM.
  - Undersampling and imperfect registration make the real requirement worse. Treat these figures as optimistic lower bounds.
- **What this means for SPHEREx** (6.15" pixels; PSF of order one pixel or more; see Q4):
  - A star with μ = 1"/yr moves only 0.5" (0.08 px) between passes 6 months apart, and about 1.5" over 3 such intervals.
  - Almost every real mover except the fastest (more than about 4–6"/yr) will be a sub-pixel dipole, not a separated mover.
  - The current ≥2" cross-correlation threshold therefore restricts detection to high-μ objects. Finding fainter or slower ones requires dipole or translient statistics, plus stacking across the several images in each pass.
- **Parallax adds to the shift.** Passes 6 months apart are taken from roughly opposite sides of Earth's orbit, so the shift includes about 2x the parallax. For a brown dwarf at 10 pc that is about 0.2", comparable to its 6-month proper motion. The direction of the shift is therefore not purely along μ. This is general astrometry and not taken from a cited survey paper.
- **Measuring a dipole.** Use the DMTN-007 recipe: fit the two lobes jointly with the pre-subtraction cutouts and constrain the fluxes to be equal. This is cheap in JS with a few-parameter Levenberg-Marquardt fit on a ~15x15 px stamp.

### Gaps
- I found no NEOWISE moving-object (WMOPS) paper in this pass, so asteroid-style tracklet linking is not covered.
- I found no published SPHEREx-specific study of proper-motion detection limits.
- DMTN-007 gives no S/N threshold for classifying a source as a dipole.

## Q3. False positives in difference images, and the tests that reject them

### Takeaway
The published artifact list is consistent across surveys:
- partial subtractions caused by misalignment or variability (the most common)
- cosmic rays and hot pixels
- ghosts and latents/persistence
- bright-star residuals
- deblending changes between epochs

Proven rejection tests:
- the source must repeat in independent frames and epochs
- motion must be consistent and linear across epochs
- flux must be conserved (positive lobe ≈ negative lobe)
- the source must not sit on flagged pixels
- a statistic ratio separates motion from variability (translient Z vs ZOGY S)
- a final human or catalogue check

None of these turns a candidate into a discovery. Discovery requires independent astrometric confirmation and usually spectroscopy.

### Cited Findings
- **Backyard Worlds artifact types:**
  - The most common are partially subtracted stars and galaxies, caused by variability or small alignment errors.
  - Cosmic rays, optical ghosts and latent images are also common.
  - Poisson noise, electronic striping and subtraction residuals also produce false signals.
  — [Kuchner et al. 2017](https://ar5iv.arxiv.org/html/1705.02919)
- **Backyard Worlds path from candidate to discovery:**
  - The first object was flagged by one volunteer and submitted by another through a web form, and three more users noted it.
  - It was checked in VizieR and SIMBAD and confirmed as moving across three independent epochs (2MASS-reject, Pan-STARRS, AllWISE) with a Monte Carlo proper-motion fit.
  - It was checked for moving-group membership (BANYAN II).
  - Only then did IRTF/SpeX spectroscopy classify it as T5.5±0.5 at 34±5 pc.
  — [Kuchner et al. 2017](https://ar5iv.arxiv.org/html/1705.02919)
- **unTimely caveats:**
  - Cosmic-ray residuals survive coadding. For S/N > 10 sources, SPREAD_MODEL < −0.021 identifies them.
  - Deblending can differ between epochs, creating spurious variability.
  - Near-threshold detections are biased.
  — [Meisner et al. 2023](https://ar5iv.labs.arxiv.org/html/2209.14327); [unTimely variables catalogue, arXiv 2511.22071](https://arxiv.org/pdf/2511.22071)
- **Registration errors:** astrometric errors shift stars between images and cause subtraction artifacts and false alarms. Translient is designed to flag such artifacts as motion. Variability (|S| > Zσ) can be told apart from motion (Zσ > |S|). — [Springer et al. 2024](https://arxiv.org/html/2403.09771v1)
- **ZOGY:** its statistic is claimed to be sufficient for further hypothesis tests, including separating particle hits and other artifacts from real transients. Registration-error and colour-refraction extensions are included. — [Zackay et al. 2016](https://arxiv.org/abs/1601.02655v2)
- **DMTN-007:** fits are more reliable when constrained by the pre-subtraction images. Unmodelled background gradients degrade fluxes and separations, and adding linear background terms restores accuracy. — [DMTN-007](https://dmtn-007.lsst.io/)
- **SPHEREx flags and astrometry:**
  - Transients (cosmic rays) are flagged onboard and by sigma-clipping outlier detection.
  - Other flag categories: persistence, outlier pixels, source mask, NONFUNC, and DICHROIC (≥50% attenuation).
  - Full bit definitions are in Table 10 of the Explanatory Supplement.
  - Fine astrometry runs Astrometry.net then scamp. Images with rms < 1" get FINAST = 0, and their median alignment precision is 0.1–0.4".
  — [SPHEREx pipeline paper, arXiv 2511.15823](https://arxiv.org/html/2511.15823v2); [SPHEREx data products](https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-products)
- **Candidate labelling conventions:**
  - Backyard Worlds tags objects as #dipole or #mover candidates, and they become discoveries only after multi-epoch astrometric confirmation and spectroscopy. — [Kuchner et al. 2017](https://ar5iv.arxiv.org/html/1705.02919)
  - Rubin calls difference-image detections "diaSources", and dipole classification is only a flag on them. — [lsst.ip.diffim](https://pipelines.lsst.io/modules/lsst.ip.diffim/)

### Inferences
**Rejection tests to apply in ARCNAVE, in priority order (my synthesis of the sources above):**
1. **Mask flagged pixels.** Drop any candidate whose PSF core touches FLAGS bits for transient/cosmic ray, persistence, nonfunctional or outlier pixels, or saturation if such a bit exists.
2. **Registration residual floor.** The 0.1–0.4" alignment precision is 0.02–0.07 px. Every bright star then leaves a dipole of about ν·(0.1–0.4")/FWHM sigma.
   - Fit and remove a global affine shift from the matched field stars first.
   - Estimate the residual-dipole distribution from all stars, and require a candidate to be an outlier relative to stars of similar brightness, not just above a fixed threshold.
   - This is the main way to keep false positives out.
3. **Repeat within a pass.** A pass contains several images at different wavelengths. A real proper-motion dipole must point the same way, with consistent separation, in every image of the pair of passes. Cosmic rays, persistence and ghosts will not repeat.
4. **Direction consistency across passes.** With 3–4 passes, the shift between passes 1→2, 1→3 and 1→4 should grow roughly linearly in time, plus a parallax term. Misregistration produces random directions.
5. **Flux conservation and symmetry.**
   - The positive and negative lobes should have equal flux within errors.
   - Unequal lobes, or |S| > Zσ in ZOGY vs translient terms, indicate variability.
6. **Bright and saturated stars.** Exclude or downweight a radius scaling with brightness. Wings and nonlinear cores give residuals that are not shift-like. Rely on cross-correlation or PSF-wing fitting there instead of differencing.
7. **Blends.** Compare against Gaia DR3 at the epoch of each pass, propagating Gaia proper motions. A Gaia star with known μ explains the dipole. A dipole without a Gaia counterpart, or with a mismatched μ, remains a "candidate mover" only.
8. **Labels.** Use "candidate", "known high-PM star (Gaia)" or "artifact". Never use "discovery".

### Gaps
- I did not retrieve the SPHEREx flag bit list (Explanatory Supplement Table 10). The PDF was too large to fetch, so it is unconfirmed whether a SATURATED bit exists.
- I did not fetch the DES machine-learning artifact classifier (autoScan) details. The PDF was not parseable in this pass.

## Q4. Can differences be made across wavelengths, or must images be colour-matched? What do SPHEREx docs say about PSF variation?

### Takeaway
SPHEREx's PSF changes with wavelength and across each detector because of the linear variable filters (LVFs) and the optics. Its effective area grows toward the red. Each pixel samples a different wavelength, so the same star sits at a different wavelength, and therefore a different flux and PSF, in each pass unless the pointing repeats. Differencing should pair images of the same detector/band at closely matched wavelength, using the per-zone ePSF for each, and fit a free flux scale. Cross-wavelength differences need kernel or ZOGY PSF matching plus a free flux ratio, and are less trustworthy.

### Cited Findings
- **Scale and sampling.** The SPHEREx pixel scale is 6.15". The PSF is "significantly undersampled", so the pipeline stacks on a 10x oversampled grid. The data-products page says "0.615 arcsec", which appears to be a typo. — [SPHEREx pipeline paper](https://arxiv.org/html/2511.15823v2); [SPHEREx data products](https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-products)
- **Detectors and bands:**
  - Each detector covers 3.5°x3.5° with 2040x2040 pixels.
  - The LVF band centre varies along one axis of the array, and each pixel samples a single wavelength.
  - Bands 1/4, 2/5 and 3/6 view the same sky.
  - Bands and resolving power: 1: 0.75–1.09 µm (R 39), 2: 1.10–1.62 (41), 3: 1.63–2.41 (41), 4: 2.42–3.82 (35), 5: 3.83–4.41 (112), 6: 4.42–5.00 (128).
  - The WCS-WAVE extension gives per-pixel wavelength to about 1 nm.
  — [SPHEREx data products](https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-products); [pipeline paper](https://arxiv.org/html/2511.15823v2)
- The PSF varies across the focal plane for two reasons: the LVF wavelength gradient, and the optics, which give different PSFs even along lines of equal wavelength. The Sky Simulator used 3x3 PSF grids for most bands but 20x20 for the cores of bands 1 and 3, where greater variation was expected. — [SPHEREx Sky Simulator, arXiv 2505.24856](https://arxiv.org/pdf/2505.24856)
- **PSF products:**
  - The pipeline PSF is an exposure-averaged 11x11 zone grid per band from more than 1000 stars per zone. It is deconvolved by the pixel function, and spacecraft jitter is σ < 0.1".
  - QR1/QR2 shipped a 101x101x121 PSF cube oversampled 10x.
  - QR3/DR1 (pipeline v7.0+) ship an EPSF table extension: 33x33 arrays oversampled 5x, in 21x21 zones (detector 3: 11x41), with NEFF_MEAN, CWAVE and CBAND per zone. IRSA recommends the ePSF for science.
  — [pipeline paper](https://arxiv.org/html/2511.15823v2); [IRSA SPHEREx PSF tutorial](https://caltech-ipac.github.io/irsa-tutorials/spherex-psf/); [data products](https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-products)
- **PSF size by wavelength.** PSF effective area grows toward redder wavelengths. NEFF_MEAN is about 4.38 px at 2.433 µm in the example zone. — [IRSA SPHEREx PSF tutorial](https://caltech-ipac.github.io/irsa-tutorials/spherex-psf/)
- **Selecting the ePSF for a cutout pixel:**
  1. Convert cutout pixels to parent pixels: x = 1 + x_cutout − CRPIX1A, and likewise for y with CRPIX2A.
  2. Pick the zone with the nearest XCENTER/YCENTER.
  3. Shift that PSF to the source's sub-pixel phase and integrate it onto the native pixel grid.
  — [IRSA SPHEREx PSF tutorial](https://caltech-ipac.github.io/irsa-tutorials/spherex-psf/)
- **Known header bug in QR1/QR2 PSF products.** The cube actually uses an 11x11 zone grid, but software that selects the PSF plane from the header can pick the wrong plane. This causes up to ±5% photometry error in the worst corners. — [IRSA PSF header error notice](https://irsa.ipac.caltech.edu/data/SPHEREx/docs/psfhdrerr.html)
- ZOGY includes an extension for colour-refraction (chromatic) astrometric errors. This is a precedent for modelling colour-dependent shifts in subtraction. — [Zackay et al. 2016](https://arxiv.org/abs/1601.02655v2)

### Inferences
- **Pairing rule:** difference each pass-2 image against the pass-1 image of the same band whose WCS-WAVE value at the star is closest. Fit a free flux-scale factor, because stellar SEDs differ by wavelength and brown dwarfs have strong CH₄/H₂O features, so the flux ratio is not 1.
- **Kernel or PSF for each image:** use the ePSF zone nearest the star in each image (the zones differ, because the star lands on different detector pixels). ZOGY or translient take both PSFs directly. With AL/Bramich, fit the kernel only from stars near the target so it captures local PSF differences.
- **Undersampling caveat:** with a FWHM of about 1–1.5 px, sub-pixel phase changes alter the pixelated PSF shape. This produces residuals even with zero motion. Build each PSF at the measured sub-pixel position before subtracting, or forward-model both epochs (DMTN-007-style joint fit). Do not rely on kernel matching alone.
- **Cross-wavelength subtraction** (e.g. band 1 vs band 3) mismatches PSF width and SED. It should be avoided, or used only as one more vote in the "repeat across images" test.

### Gaps
- I found no published table of SPHEREx PSF FWHM versus wavelength. The Explanatory Supplement (v1.6, 2026-05-06) PDF could not be fetched because of its size. Its PSF section and Table 10 (flags) should be read directly.
- I found no SPHEREx documentation on the saturation limit or saturation flag, nor on whether pointings repeat precisely between surveys.
- No published survey was found that runs dipole-based proper-motion searches on SPHEREx data.
