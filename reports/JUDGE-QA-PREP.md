# ARCNAVE: judge Q&A prep (for the team)

Judges want to hear that the team understands what it built. Each answer below is short enough to say in about 20
seconds, and each one names the code that backs it up so you can show it. Practise saying them out loud in English.

## 1. The idea

**Q: What does ARCNAVE do, in one sentence?**
It takes every real SPHEREx image of one spot in the sky, lines them up, and plays them as a film so you can see what
moves or changes. Then it measures the motion and checks it against Gaia and WISE.

**Q: Why SPHEREx? WISE already did this.**
SPHEREx sees the whole sky every six months in 102 colours, and new passes are still coming. WISE is finished. Nobody
had built a "blink" tool for SPHEREx. Ours picks up each new release with no code change (DR1, and now DR2).

**Q: Who is it for?**
Students and the public (film, game, tours in 4 languages), citizen scientists (WiseView-style blinking plus the
Backyard Worlds checks), and researchers (measurements with errors, plus a Jupyter notebook to redo the work).

## 2. How it works

**Q: SPHEREx files are 65-72 MB. How is it fast?**
FITS stores the image row by row, so the rows that cover our field are one continuous block of bytes. We read only that
block from NASA's open copy on AWS S3 with HTTP range requests: about 4 MB instead of 65 MB. Code: `lib/s3cut.js`.

**Q: How do you line up images from different passes?**
We fit the image's WCS to Gaia DR3 stars, after moving each Gaia star to the date of that image with its proper motion.
The median alignment scatter is about 0.06 pixel. Code: `lib/fits.js` (WCS and reprojection), the Aligner step in `public/app.js`.

**Q: SPHEREx images in each pass are in different colours. Doesn't that break the comparison?**
Yes, if you ignore it. We read each image's WCS-WAVE table to find its real wavelength at the spot, then only compare
images whose colours match (usually within 0.02 µm). Code: `lib/wave.js`.

**Q: How do you measure the motion?**
We build a PSF from each image's own stars (an empirical PSF, checked against the official SPHEREx PSF), fit the star's
position in every image, then fit a straight line through the passes. The error has a floor, taken from about 40 steady
Gaia stars in the same field. Code: `epsfGrid` and `psfStars` in `lib/fits.js`, `epsfFit` in `public/app.js`.

**Q: What about bad pixels, cosmic rays, ghosts?**
We use the SPHEREx pipeline's own FLAGS bits to mask them, and remove the ZODI (zodiacal light) model. A spot that shows
up in only one exposure, and not in the one taken minutes later, is marked as a cosmic ray.

## 3. The results

**Q: Barnard's Star: 9.9″/yr against 10.4″/yr. Why not exact?**
The star is saturated in most SPHEREx images, so we measure it from its glow, not its core. Over 359 days it moved
9.7″ and Gaia predicts 10.2″. That is a 0.5″ difference on 6.2″ pixels: under a tenth of a pixel.

**Q: WISE 0855 is 8.82 ± 1.10 but CatWISE says 7.94. Is that wrong?**
They differ by 0.88″/yr and our error is 1.10, so they agree within one sigma. The object is very faint in each pass
(S/N 2.4-5), which is why the error is large, and the app says so.

**Q: How do you know RW Aurigae really faded, and it is not your calibration?**
We compare it with three steady stars in the same images. They stay within 0.13 mag while RW Aur fades 0.74 mag, in all
6 colours.

## 4. Planet X (expect this one)

**Q: Can ARCNAVE find Planet X?**
Honestly, not a Planet Nine as it is predicted. Predictions put it at about V 19-24 (Batygin et al. 2019), and our
measured limit for a slow mover in one field is about AB 17. What we tested is how deep the method reaches: we hid
19,880 fake planets in real images, and a planet 1,000 AU away is caught down to AB 17 in all 18 test fields. What
SPHEREx and ARCNAVE can realistically find are nearby cold brown dwarfs like WISE 0855, fast stars, and asteroids.
Code: `lib/planetx.js`.

**Q: Why are 300 AU planets missed in 6 fields?**
The images of one pass are spread over days to weeks. A planet 300 AU away moves tens of pixels in that time, so the
median stack removes it like a cosmic ray. The motion-following stack (shift the images back along the planet's path
before stacking) brought it from 9 to 12 fields out of 18.

**Q: Why 18 fields chosen in advance?**
So we could not pick fields where it looks good. They are on a grid: every 60° along the ecliptic, on it and 40° above
and below. The bad fields (crowded Milky Way) stay in the tables.

## 5. Limits

**Q: What can't it do?**
- Most stars move less than 1″ a year: too small for 6.2″ pixels over 1-1.5 years.
- Asteroids cross a field in days: we find them as changes and match them to known asteroids, but we do not follow them
  across passes.
- Crowded Milky Way fields give more false alarms, and the app warns there.
- A new spot takes 20-90 s the first time, because it is downloaded live from NASA.

## 6. The team and AI

**Q: Did you use AI?**
Yes, and it is declared in the README and the about page. We used an AI coding assistant to write code faster. The idea,
the test plan (5 targets, 18 pre-chosen fields, fake-planet injection) and the checks of every number against Gaia and
CatWISE are ours. Each number in the deck can be reproduced by opening the live link.

**Q: What was the hardest part?**
Pick one you really worked on and tell it as a story. Two good ones:
- *Speed:* the IRSA cutout service took 25-45 s per image, so we switched to reading only the needed rows from S3.
- *Honest errors:* the first error bars were too small, so we added a per-field error floor from steady Gaia stars, and
  the fake-mover test showed the scaled errors scatter by 1.03 (1.00 is ideal).

**Q: What next?**
Every new SPHEREx release explorable the day it is out; candidate lists of nearby brown dwarfs for citizen scientists.

## Live demo order (if judges ask you to show it)

1. `https://arcnave.vldeena2008.workers.dev/#ct=barnard`, then press **Play the film** (10 s).
2. Point at "What am I seeing?" and **How sure are we?** (10 s).
3. Switch to Blink, then to WISE 0855 (`#ct=wise0855`) (15 s).
4. Open `#scorecard` and show "In one look" (15 s).
5. Switch the language to Tamil (5 s).
