# Shift-and-stack (synthetic / digital tracking) and tracklet linking for faint movers, judged for a 2-4 epoch SPHEREx browser tool

Context assumed in the inferences: ARCNAVE (plain browser JS) on SPHEREx images, 6.15"/px, 2-4 passes about 6 months apart, several images per pass at different wavelengths. Targets are proper-motion stars and brown dwarfs moving 0.5-10"/yr, which is 0.04-0.8 px per 6-month gap and at most about 2.4 px over 1.5 yr. Asteroids are out of scope (catalogue lookup).

## Q1. How KBMOD, synthetic tracking, digital tracking and the WISE Planet Nine searches work: S/N gain, number of trial velocities, false-positive controls

### Takeaway
All of these methods sum flux along many trial linear (or orbit-linearised) motions, so S/N grows as about sqrt(N_images). They test millions to 10^11 trajectories, so false positives have to be controlled hard: high thresholds (7-10 sigma), robust per-image outlier filters, stamp-shape or CNN filters, masking or differencing of static sources, and a final review by eye. The WISE Planet Nine searches were not trajectory stacks. They built per-epoch coadds, ran difference imaging, and linked the transients with chi-square orbit fits, then vetted every surviving linkage by eye. They found zero candidates.

### Cited Findings
**Synthetic tracking (Shao et al. 2014; Zhai et al. 2014)**
- The method takes many short exposures that freeze a fast mover, shifts them to match a trial velocity, and co-adds them. This synthesises the long exposure a tracking telescope would have taken, without trailing loss. — [Shao et al. 2014, ApJ 782, 1 (arXiv:1309.3248)](https://ar5iv.arxiv.org/html/1309.3248)
- SNR scales as sqrt(number of frames). In their 1 m example, a conventional exposure gives SNR about 1.5 and synthetic tracking gives SNR about 24.6. — [Shao et al. 2014](https://ar5iv.arxiv.org/html/1309.3248)
- Trial velocities are steps of 1 pixel per frame in each component. The example uses 1,000 velocity vectors and 120 frames, which is more than 10^11 arithmetic operations, and GPUs process 30 s of data in under 10 s. — [Shao et al. 2014](https://ar5iv.arxiv.org/html/1309.3248)
- False-alarm control: an SNR threshold of 7 gives a per-trial false-positive probability of about 10^-12 in Gaussian noise. A 2K×2K image times 1,000 velocities is 4×10^9 trials, so the overall false-alarm probability is about 0.4%. An SNR-7 object is detected 50% of the time at threshold 7, 16% at threshold 8 and 84% at threshold 6. — [Shao et al. 2014](https://ar5iv.arxiv.org/html/1309.3248)
- Stationary stars turn into streaks in a velocity-shifted stack. The paper does not describe template subtraction. Astrometry uses reference stars that are bright enough to see in single frames. — [Shao et al. 2014](https://ar5iv.arxiv.org/html/1309.3248)
- Zhai et al. 2014 (arXiv:1403.4353) reported detecting a faint, fast near-Earth asteroid with the technique on the Palomar 200-inch. — [search summary of Shao/Zhai](https://asaip.psu.edu/?p=3468) (secondary; full text not read)

**KBMOD (Whidden et al. 2019)**
- Likelihood formulation: Psi is the inverse-variance-weighted cross-correlation of the PSF with each image, and Phi is the inverse-variance-weighted PSF energy. Both are computed once per image. For a trajectory, the code samples Psi and Phi at each image's predicted pixel and sums them. The detection S/N is nu = sum Psi / sqrt(sum Phi), and the flux estimate is alpha = sum Psi / sum Phi. Images are never physically shifted. — [Whidden et al. 2019, arXiv:1901.02492](https://ar5iv.arxiv.org/html/1901.02492)
- Depth gain is about sqrt(N). They quote Delta m = 1.26 log10(N), which is about 1 mag deeper for 6 images and 2 mag for 40. On HiTS data the single-image limit was g about 23.1 and the 50%-efficiency point was g about 24.1. — [Whidden et al. 2019](https://ar5iv.arxiv.org/html/1901.02492)
- Velocity grid: 128 angles within ±12° of the ecliptic × 250 speeds from 1 to 5.7"/hr gives 32,000 trajectories per starting pixel. The wide benchmark searched 240 billion trajectories on 30 4K×4K images. — [Whidden et al. 2019](https://ar5iv.arxiv.org/html/1901.02492)
- Cost: runtime is about N_images × N_trajectories × 2.4×10^-11 s on a GPU. 240 billion trajectories over 30 images took about 180 s, and more than 10^10 trajectories take under a minute on a consumer GPU. — [Whidden et al. 2019](https://ar5iv.arxiv.org/html/1901.02492)
- False-positive controls:
  - The detection threshold is nu = 10. At 5 sigma, precision fell below 50% at g about 24.1. At 10 sigma it stayed above 90%.
  - A Kalman-filter flux outlier rejection removes points more than 5 sigma from the fit, then recomputes the likelihood.
  - Coadded postage stamps are tested with central moments against a centred Gaussian. This was the single most effective filter.
  - DBSCAN merges duplicate trajectories.
  - Each filtering stage cut false positives by 1-3 orders of magnitude. — [Whidden et al. 2019](https://ar5iv.arxiv.org/html/1901.02492)
- Static sources: no difference imaging was used. Sources above 5 sigma were masked (grown by 2 px) if they appeared at that position in 2 or more images. A bright-pixel mask (>120 counts, about g 21) removed about 4×10^8 false positives in one field. — [Whidden et al. 2019](https://ar5iv.arxiv.org/html/1901.02492)

**KBMOD on difference images (Smotherman et al. 2021)**
- Each pointing is differenced against a template coadded from the other half of the pointing group, at least 12 h apart. The template is Alard-Lupton kernel-matched in 128×128 px cells and decorrelated. Differencing cut static detections about 18× (median 3,396 per science CCD versus 180 per difference image). — [Smotherman et al. 2021, AJ 162, 245 (arXiv:2109.03296)](https://ar5iv.arxiv.org/html/2109.03296)
- Robust "sigma_G" lightcurve filter: sigma_G = 0.7413 × (x75 − x25). Points outside ±2 sigma_G of the median are rejected, and the summed likelihood is recomputed. Candidates are kept if the recomputed summed likelihood is at least 10. The filter runs on about 10^6 trajectories in about 60 s on 30 cores and also runs in-line on the GPU. — [Smotherman et al. 2021](https://ar5iv.arxiv.org/html/2109.03296)
- Grid: velocities 92-550 px/day and angles ±pi/10 from the ecliptic, with 512 velocity × 256 angle steps. Candidates need at least 15 observations. — [Smotherman et al. 2021](https://ar5iv.arxiv.org/html/2109.03296)
- Final filtering: a stamp-moment cut, then a ResNet-50 CNN stamp classifier (about 96% test accuracy, 75% probability cut) with summed likelihood above 15. This leaves at most about 11 candidates per CCD. Every candidate still needs review by eye, and the remaining false positives are dominated by artifacts and real sources. — [Smotherman et al. 2021](https://ar5iv.arxiv.org/html/2109.03296)
- Results: 75 unlinked moving objects (faintest VR = 25.02 ± 0.93) and 24 known objects recovered. — [Smotherman et al. 2021 abstract (ADS)](https://ui.adsabs.harvard.edu/abs/2021AJ....162..245S/abstract)

**WISE/NEOWISE Planet Nine searches (Meisner et al. 2017, 2018)**
- 2017 (AJ 153, 65): inertial W1 coadds binned into about 1-day "visits". The search covered about 2,000 deg² (the Holman & Payne region) out to 800 AU, where single exposures run out at about 430 AU. The limit was W1 < 16.66 at 90% completeness, with no plausible candidate. — [Meisner et al. 2017, arXiv:1611.00015](https://arxiv.org/abs/1611.00015)
- 2018 3π search, coadds:
  - 129,483 epochal coadds at 2.75"/px, with 7-12 epochs per footprint (typically 8-9).
  - Coadds are about 1.3 mag deeper than single frames (single-exposure limit W1 about 15.3).
  - Each epoch's reference template combines epochs more than 5 months away.
  - HOTPANTS difference imaging, then Source Extractor transient detection. — [Meisner et al. 2018, arXiv:1712.04950](https://ar5iv.arxiv.org/html/1712.04950)
- 2018 3π search, linking:
  - Transients are linked with chi-square prescreens (triplets chi² < 30, quadruplets < 150), then orbfit Keplerian fits (chi² < 40, centroid sigma 0.8").
  - 92 billion triplets and 275 million quadruplets were enumerated, with about 8 million orbfit calls.
  - At least 5 linked transients were required (the 2017 search required 4).
  - The paper does not give a sky-plane trial-motion grid. — [Meisner et al. 2018](https://ar5iv.arxiv.org/html/1712.04950)
- 2018 3π search, false-positive controls:
  - Static sources removed using 2MASS.
  - Masks for ringing, bright-star cores and spikes, and latents.
  - Dense Galactic tiles excised (1,131 tiles with more than 90,000 2MASS sources).
  - 5.6 million transients gave 2,735 linkages. Of these, 737 matched known high proper-motion objects in SIMBAD, and the other 1,998 were rejected after every finder chart was inspected by eye. Zero valid candidates remained. — [Meisner et al. 2018](https://ar5iv.arxiv.org/html/1712.04950)
- 2018 3π search, limits:
  - 31,480 deg² (76.3% of sky, |beta| < 55°).
  - 90% completeness at W1 = 16.70 at high Galactic latitude (footprint-wide mean 16.69, range 15.97-16.93), which corresponds to about 800-900 AU for the brightest model.
  - Stated caveats: objects near bright stars or diffraction spikes could be missed, W1 < 9.5 is saturated, and the result depends heavily on epoch count. — [Meisner et al. 2018](https://ar5iv.arxiv.org/html/1712.04950)

### Inferences
- The S/N gain from stacking N equal-depth images is sqrt(N): +0.38 mag for 2, +0.60 mag for 3 and +0.75 mag for 4 epochs (using Whidden's 1.26 log10 N, or 2.5 log10 sqrt N). It is far smaller than the 1-2 mag that KBMOD gets from 6-40 images.
- For ARCNAVE, the WISE Planet Nine pipeline is the closer analogue: per-epoch coadds, a template from other epochs, then a chi-square fit linking positions. The numbers from that search (about 27% of linkages were known high proper-motion stars, and everything else was artifacts) show that known proper-motion stars and artifacts dominate any motion search of infrared survey data.

### Gaps
- Could not read the full Zhai et al. 2014 text, so its exact velocity-grid and false-alarm parameters are not given here.
- Meisner et al. 2017/2018 did not run a sky-plane shift-and-stack over trial proper motions. I found no published WISE Planet Nine search that literally stacks along trial motions. The "motion-compensated coadd" wording in the brief does not match what I could verify: the coadds are inertial, per epoch.

## Q2. Is a trial proper-motion grid over a cutout feasible in browser JS for 2-4 epochs? Compute cost

### Takeaway
Yes, it is cheap: about 10^8-10^9 bilinear samples, which takes seconds in a Web Worker. It also adds little for this target class. The motion between epochs is under 1-2.5 px, so a plain static coadd already holds almost all of a mover's flux. The better approach is to detect on the deep all-epoch, all-band coadd, measure per-epoch centroids by forced PSF fitting, and fit a straight line. The trial-motion grid is most useful as a likelihood scan around each detected source, to give a proper-motion estimate and an uncertainty map.

### Cited Findings
- SPHEREx: 102 bands, 0.75-5.0 µm, 6.2" pixels, four all-sky surveys in the two-year prime mission. Launched 11 March 2025, first all-sky survey completed December 2025. After four maps, 5 sigma depth is 19.5-19.9 AB at 0.75-3.8 µm and 17.8-18.8 AB at 3.8-5.0 µm. — [SPHEREx mission paper, arXiv:2511.02985](https://arxiv.org/abs/2511.02985); [SPHEREx science overview, arXiv:2404.11017](https://arxiv.org/html/2404.11017v1)
- KBMOD's precomputed Psi/Phi formulation reduces each trajectory test to N array lookups and adds, at about 2.4×10^-11 s per image per trajectory on a GPU. — [Whidden et al. 2019](https://ar5iv.arxiv.org/html/1901.02492)
- CatWISE2020 measures motions from 12 unWISE epoch coadds (each about 1 day, spaced about 6 months, more than 8-yr baseline). It detects on full-depth coadds and fits motion across the epochs. — [CatWISE2020, arXiv:2012.13084](https://ar5iv.arxiv.org/html/2012.13084); [Meisner et al. time-resolved coadds, arXiv:1710.02526](https://arxiv.org/pdf/1710.02526)

### Inferences (own estimates, not from sources)
- **Motion scale.** 10"/yr × 0.5 yr = 5" = 0.81 px per gap. Over 4 passes (1.5 yr) that is 15" = 2.4 px. At 0.5"/yr it is 0.04 px per gap and 0.12 px total, which is below realistic centroid precision for anything but bright stars.
- **Grid density needed.** The trial grid only needs to keep misregistration below about a quarter of the PSF FWHM over the baseline T. With T = 1.5 yr and a tolerance of about 1.5" (0.25 px), a step of about 2"/yr is enough. A ±10"/yr grid in 2"/yr steps is 11 × 11 = 121 trials. The requested 0.5"/yr steps give 41 × 41 = 1,681 trials, oversampled about 4× per axis but still affordable.
- **Cost (1,681 trials).** A 256 × 256 px cutout (about 26' square) with 4 per-pass coadds needs 65,536 × 1,681 × 4 = 4.4×10^8 bilinear samples. At about 10 flops each, plain JS typed arrays at about 0.2-1 Gflop/s take roughly 5-20 s, and the 121-trial grid takes under 2 s.
- **Cost with every band image.** Using each of about 6 band images per pass as its own term (24 images) multiplies the cost by 6. It is cheaper to make one inverse-variance-weighted Psi/Phi map per pass first: the band images within a pass are close enough in time.
- **Implementation.** Use KBMOD's approach:
  1. Convolve each per-pass image with its PSF once to get Psi and Phi maps.
  2. Score each trial (mu_ra, mu_dec) as nu = sum Psi / sqrt(sum Phi) at the shifted positions.
  3. Run it in a Web Worker on Float32Array.
- **Static stars.** Movers here barely move, so a static template built from other epochs subtracts most of the mover's own flux (self-subtraction), and the difference image shows only a dipole of amplitude about (shift / FWHM) × flux. A sub-pixel mover's difference signal is therefore much weaker than its direct signal. Shift-and-stack on difference images only beats direct detection for movers that shift by more than about 1 FWHM over the baseline, which here is only the fastest objects (about 8-10"/yr) with 3-4 passes.
- **Recommended pipeline:**
  1. Detect on the deep static coadd of all epochs and bands.
  2. Forced-fit the PSF centroid in each pass.
  3. Fit a linear proper motion by weighted least squares.
  4. Optionally scan the trial-PM likelihood around each source and report the peak and the 1-sigma contour.
  5. Use template-difference shift-and-stack only as a secondary search for objects that are absent or very faint in the static coadd and whose dipoles line up.
- **Parallax.** Passes 6 months apart sample opposite parallax extremes. A brown dwarf at 5 pc has a parallax of 0.2", so its displacement swing reaches up to 0.4" (0.07 px). That is negligible at 6" pixels except for the very nearest objects, but with 2 epochs it cannot be separated from proper motion. The tool should say so.

### Gaps
- No source gives measured JS/WebAssembly throughput for this kernel, so the timings above are estimates.
- I did not find the SPHEREx PSF FWHM per band in the sources read. It sets the grid step and the centroid precision.
- I could not confirm the exact time spread of SPHEREx band images within one pass for one sky position (hours to days?), which matters only for asteroids.

## Q3. How shift-and-stack handles stationary background stars

### Takeaway
There are three proven approaches, and they can be combined:
- **Masking:** mask pixels where sources recur in several images (KBMOD 2019).
- **Differencing:** subtract a PSF-matched template built from epochs well separated in time (Smotherman 2021: other half of the visits, at least 12 h apart; Meisner 2018: epochs more than 5 months away).
- **Catalog cross-match:** remove static catalogue matches (2MASS in Meisner 2018).

Each needs extra filters downstream, because artifacts and residuals from subtracting bright stars dominate what is left.

### Cited Findings
- KBMOD 2019 masks sources above 5 sigma that appear at the same position in at least 2 images, grows the masks by 2 px, and also masks bright pixels. — [Whidden et al. 2019](https://ar5iv.arxiv.org/html/1901.02492)
- KBMOD 2021 uses Alard-Lupton kernel-matched templates from the other half of the visits, with masking only for sources detected in 10 or more images. Differencing cut static detections 18×, but reducing the masking raised the number of trajectories with summed likelihood above 10 about 10×, which had to be filtered by the sigma_G and CNN stages. — [Smotherman et al. 2021](https://ar5iv.arxiv.org/html/2109.03296)
- Meisner 2018 builds a reference from epochs more than 5 months from the search epoch, subtracts it with HOTPANTS, rejects 2MASS counterparts, and masks bright-star spikes and latents. Third-order latents and spikes beyond the masks still contaminated linkages. — [Meisner et al. 2018](https://ar5iv.arxiv.org/html/1712.04950)
- In synthetic tracking without subtraction, stationary stars become streaks in the shifted stack. — [Shao et al. 2014](https://ar5iv.arxiv.org/html/1309.3248)

### Inferences
- With only 2 epochs in ARCNAVE, "template from other epochs" means "the other epoch". A simple median template needs at least 3 epochs to reject a mover, and even then sub-pixel movers partly survive in the median.
- A practical browser approach:
  1. Make the template a median of the other passes, after registering each pass on Gaia-matched bright stars.
  2. Match the PSF approximately with a Gaussian blur rather than full Alard-Lupton.
  3. Mask bright-star cores and spikes.
  4. Treat subtraction residuals around bright stars as the main source of false positives.

### Gaps
- SPHEREx-specific artifact behaviour was not covered by the sources read: persistence or latents, and spectral-filter variation across the detector, where the same pixel sees different wavelengths in different visits.

## Q4. Tracklet linking (LSST MOPS, HelioLinC/HelioLinC3D, THOR): requirements and applicability to 2-4 epoch linear movers

### Takeaway
MOPS, HelioLinC3D and THOR are built for asteroids. They need many detections spread over many nights (intra-night tracklets of 2-3 or more detections, at least 3 nights within about 12-14 days, or at least 5 observations for THOR). They also solve a nonlinear heliocentric-orbit problem with a combinatorially huge search. None of that applies to stars whose motion is linear over years and below a pixel per epoch. For 2-4 epochs, the right method is nearest-neighbour matching within a motion-bounded radius, then a weighted linear fit with a chi-square test, as in CatWISE-style motion fitting.

### Cited Findings
- **MOPS:** pairs detections within a night into tracklets, then links at least 3 tracklets using a kd-tree search (Kubica et al. 2007), which reduces the number of candidate tracks from n² to n log n. The simulated LSST NEO linking efficiency was 93.6% for tracks with tracklets on at least 3 nights within 12 days. Tunables include the minimum number of nights and detections, velocity bounds, and kd-tree thresholds. — [Jones et al., NEO orbit linking with LSST, arXiv:1706.09397](https://arxiv.org/pdf/1706.09397)
- **Rubin HelioLinC3D, tracklets:** minimum tracklet length of 3 detections (to limit false tracklets), minimum motion of 5", maximum rate 1.5 deg/day. Another Rubin page describes 2-detection tracklets spanning 5-90 min, so the two documents conflict. — [Rubin DP1 SSP linking](https://dp1.lsst.io/processing/moving/ss_linking.html); [Rubin DP1 paper, arXiv:2603.23786](https://arxiv.org/pdf/2603.23786)
- **Rubin HelioLinC3D, linkages:** need at least 3 tracklets from different nights within 14 days, which is at least 6 detections. Overlapping linkages are then refined by Herget orbit fitting. — [Rubin SSP linking docs](https://dp1.lsst.io/processing/moving/ss_linking.html)
- **HelioLinC3D example:** it found NEO 2022 SF289 in ATLAS data seen on 4 nights but only 3 times per night, which is too few for single-night discovery. — [DiRAC news](https://dirac.astro.washington.edu/new-algorithm-and-first-potentially-hazardous-asteroid-discovery)
- **THOR:** links without tracklets by moving detections into the frame of dynamically chosen heliocentric "test orbits". In that frame nearby orbits move linearly, so a Hough-type line detector finds them, followed by orbit determination. On 2 weeks of ZTF data it recovered 97.4% of known, discoverable objects with a > 1.7 au and at least 5 observations, compared with 68% for ZMODE. — [Moeyens et al. 2021, AJ 162, 143 (arXiv:2105.01056)](https://arxiv.org/pdf/2105.01056); [DiRAC THOR page](https://dirac.astro.washington.edu/thor-an-algorithm-for-cadence-independent-asteroid-discovery/)
- **Planet Nine linking:** the WISE Planet Nine search linked single-epoch transients with chi-square prescreens and orbit fits, and needed at least 5 transients to keep false linkages manageable. — [Meisner et al. 2018](https://ar5iv.arxiv.org/html/1712.04950)

### Inferences
- **Why they don't apply:**
  - ARCNAVE has 2-4 detections in total, with none clustered into tracklets, and the motion is linear (plus tiny parallax).
  - The orbit-space search that makes MOPS, HelioLinC and THOR necessary is moot: the model has 4 parameters (x0, y0, mu_x, mu_y), or 5 with parallax.
  - Combinatorics are trivial because the search radius is bounded: at most 10"/yr × 1.5 yr = 15", about 2.4 px. Each source has at most a few candidate counterparts per epoch.
- **Recommended linking:**
  1. Match each source in the reference (deep or first-pass) catalog to detections in each other pass within r_max = mu_max × Delta t + 3 sigma_pos.
  2. Fit x(t) = x0 + mu × (t − t0) by weighted least squares, using the forced centroids and their errors.
  3. Report mu, its covariance and chi-square. Degrees of freedom are 2 × (N_epochs − 2): zero for 2 epochs, 2 for 3 epochs and 4 for 4 epochs. Accept if chi-square is below the 99% quantile (about 9.2 for 2 dof, 13.3 for 4 dof).
  4. Require mu / sigma_mu ≥ 5 before calling a motion significant.
  5. With 2 epochs there is no consistency test: label such results as a "two-epoch displacement".
- **Intra-pass check.** The several band images within one pass give independent centroids at nearly the same epoch, which helps in two ways. Their scatter gives an empirical sigma_pos per pass, the same kind of robust spread that KBMOD measures with sigma_G. They also reject single-image artifacts, because a real source must appear consistently across bands, allowing for colour. Requiring a detection in at least k of the bands in each pass is a cheap substitute for the "at least 5 detections" rule.

### Gaps
- I did not find a published linking method designed specifically for 2-4 epoch proper motion. CatWISE and unWISE use more epochs, and I did not verify the exact CatWISE fitting code.

## Q5. Lessons from the WISE Planet Nine searches and the SPHEREx context for honest labelling in an educational tool

### Takeaway
The professional searches found that almost every motion candidate was either a known high proper-motion star or an artifact. They report non-detections with completeness limits rather than claims, and they vet every candidate by eye. ARCNAVE should cross-match against known movers first (Gaia, CatWISE, SIMBAD), call anything left over a "candidate needing confirmation", and never use the word discovery. Planet Nine / Planet X is hypothetical. Bodies at hundreds of AU have parallactic motion that is not linear proper motion, and they would sit far below SPHEREx's 6" resolution and depth for this purpose.

### Cited Findings
- Meisner 2018: 737 of 2,735 linkages were known high proper-motion objects in SIMBAD. All 1,998 others were artifacts or chance alignments, rejected after inspecting each finder chart by eye. Zero valid candidates. The paper reports "no detection" with 90% completeness at W1 = 16.70 and lists where completeness fails (bright stars, spikes, Galactic plane, tile edges, saturation W1 < 9.5). — [Meisner et al. 2018](https://ar5iv.arxiv.org/html/1712.04950)
- Meisner 2017: "We do not detect a plausible Planet Nine candidate", reported with W1 < 16.66 at 90% completeness over about 2,000 deg². — [Meisner et al. 2017](https://arxiv.org/abs/1611.00015)
- Parallactic smearing sets a minimum distance for a distant-planet search with WISE epochs: about 250 AU at |beta| = 30°, rising to about 600 AU at |beta| = 55°. Motion at these distances is dominated by Earth's parallax, not linear drift. — [Meisner et al. 2018](https://ar5iv.arxiv.org/html/1712.04950)
- Even KBMOD's final candidate lists needed human review, and false positives were dominated by artifacts and real sources. — [Smotherman et al. 2021](https://ar5iv.arxiv.org/html/2109.03296)
- CatWISE proper motions have systematics of about ±40 mas/yr from an uncorrected early-epoch astrometric offset. One unrefereed preprint reports that the uncertainties near W1 about 17.2 are underestimated by about 2.1× relative to Gaia. — [CatWISE2020](https://ar5iv.arxiv.org/html/2012.13084); preprint as summarised in [search results](https://arxiv.org/html/2408.15067v1) (unreviewed; treat with caution)
- Backyard Worlds: Planet 9 (citizen science, WISE flipbooks) found its first brown dwarf, which shows that visual review of motion candidates is a legitimate educational route. — [Kuchner et al. 2017, arXiv:1705.02919](https://arxiv.org/pdf/1705.02919)

### Inferences
- **Suggested label scheme:**
  - "Known mover (Gaia/CatWISE/SIMBAD ID, catalogue PM vs measured PM)".
  - "Motion candidate: N epochs, mu ± sigma, chi², needs confirmation".
  - "Likely artifact": near a bright star or spike, inconsistent across bands, or failing chi-square.
  - Never "discovery" or "new object". For any Planet X / Planet Nine framing, say plainly that it is hypothetical and that this tool cannot test for it.
- **Show the evidence.** Always draw the measured per-epoch positions with error ellipses and the fitted line, and show per-pass cutouts (blink). That reproduces the visual vetting step every professional pipeline still relies on.
- **Precision limit.** With 6.15" pixels, centroid precision is roughly FWHM / SNR, which means arcsec-level per epoch for faint sources. Over at most 1.5 yr, motions below about 2-3"/yr will usually not be significant for faint sources. The tool should show sigma_mu rather than imply 0.5"/yr sensitivity.

### Gaps
- No source gives SPHEREx astrometric precision per epoch or a SPHEREx proper-motion study. I found no published SPHEREx moving-object or proper-motion search.
- Exact SPHEREx revisit timing per sky position (beyond "four surveys in two years") was not confirmed from a primary cadence document.
