"""Check actual muzzle and tail skin in a 16-second straight walk.

Capture the named specimens with capture-poses.mjs --steady-walk, then
run this file with Blender's Python and the capture directory. Each measured
region follows the same visible vertices throughout the walk.
"""
import sys
from pathlib import Path

import numpy as np


def midline(directory, species, region):
    def read_frame(tag):
        return np.fromfile(directory / f'{species}-{tag}.bin', '<f4').reshape(-1, 3)

    stand = read_frame('Stand')
    span = np.ptp(stand, axis=0)
    fraction = (stand - stand.min(axis=0)) / span
    cuts = (.86, .965) if region == 'muzzle' else (.035, .26)
    # The hooked hands of Therizinosaurus extend beside its neck in plan view.
    head_or_tail = fraction[:, 2] > .63 if species == 'therizinosaurus' else np.ones(len(stand), bool)
    sections = [head_or_tail & (np.abs(fraction[:, 0] - cut) < .024) for cut in cuts]
    directions = []
    for frame in range(180, 1141, 12):
        skin = read_frame(f'Cruise {frame:04d}')
        back, front = [np.percentile(skin[mask, :2], [5, 95], axis=0).mean(axis=0) for mask in sections]
        forward, lateral = front - back
        directions.append(np.degrees(np.arctan2(lateral, forward)))
    lower, middle, upper = np.percentile(directions, [2.5, 50, 97.5])
    print(f'{species} {region}: {lower:+.2f}° / {middle:+.2f}° / {upper:+.2f}°')
    if not lower < 0 < upper or abs(middle) > 5:
        raise ValueError(f'{species} {region} stays biased to one side of the travelling body')


if __name__ == '__main__':
    directory = Path(sys.argv[1])
    for species in ('baryonyx', 'therizinosaurus', 'stegosaurus', 'carnotaurus'):
        midline(directory, species, 'muzzle')
    for species in ('allosaurus-pandras', 'sauropelta', 'maiasaura', 'stegosaurus', 'carnotaurus'):
        midline(directory, species, 'tail')
