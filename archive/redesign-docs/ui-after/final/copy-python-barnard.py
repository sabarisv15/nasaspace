# ARCNAVE -> Python: the same NASA SPHEREx images, with Astropy and astroquery.
# Install once:  pip install astroquery matplotlib
# View in ARCNAVE: http://localhost:8083/#ra=269.4461&dec=4.7700&fov=0.120&b=3.45&m=change&e=2&sz=0.5&ipe=8&load=1&fra=269.44627&fdec=4.76820
import numpy as np
import matplotlib.pyplot as plt
from astroquery.ipac.irsa import Irsa
from astropy.io import fits
from astropy.wcs import WCS
from astropy.utils.data import conf
conf.remote_timeout = 120

ra, dec = 269.44627, 4.76820   # degrees (ICRS), from ARCNAVE
size = 0.5                    # cutout side in degrees
band = 3.45                   # colour picked in ARCNAVE, micrometres

# 1. Ask NASA/IPAC IRSA which SPHEREx images cover this spot (the same query ARCNAVE uses)
query = f"""
SELECT 'https://irsa.ipac.caltech.edu/' || a.uri || '?center={ra},{dec}d&size={size}' AS uri,
       p.time_bounds_lower AS mjd, p.energy_bandpassname AS det,
       p.energy_bounds_lower AS lam0, p.energy_bounds_upper AS lam1
FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid
WHERE 1 = CONTAINS(POINT('ICRS', {ra}, {dec}), p.poly)
ORDER BY p.time_bounds_lower"""
t = Irsa.query_tap(query).to_table()
print(len(t), 'SPHEREx images cover this spot')
if len(t) == 0:
    raise SystemExit('No SPHEREx images cover this spot yet. Try another position.')

# 2. Keep images whose detector covers your colour (metres -> micrometres), then the first and last in time.
#    SPHEREx's filter changes across each detector, so the exact colour at this spot differs a little per image.
pick = t[(t['lam0'] * 1e6 <= band) & (t['lam1'] * 1e6 >= band)]
if len(pick) < 2:
    pick = t
pair = [pick[0], pick[-1]]

# 3. Download just the small cutouts (not the whole images) and show them side by side
fig = plt.figure(figsize=(11, 5))
for i, row in enumerate(pair):
    with fits.open(row['uri']) as hdul:
        img = hdul['IMAGE'].data.astype(float)
        w = WCS(hdul['IMAGE'].header)
    ax = fig.add_subplot(1, 2, i + 1, projection=w)
    lo, hi = np.nanpercentile(img, [5, 99.5])
    ax.imshow(img, origin='lower', cmap='gray', vmin=lo, vmax=hi)
    x, y = w.world_to_pixel_values(ra, dec)
    ax.plot(x, y, 'o', mfc='none', mec='cyan', ms=16)
    ax.set_title(f"MJD {row['mjd']:.2f}  {row['det']}")
plt.tight_layout()
plt.show()
