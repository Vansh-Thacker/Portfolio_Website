# Vansh Thacker — Drivable F1 Portfolio

An interactive portfolio you drive. Visitors take an F1 car round a golden-hour
circuit and drive into glowing zones to read each part of the CV: pit garages
for work experience, marshal flags for education, projects and activities, a
podium for the hackathon runner-up finish, and the chequered flag for contact.
The name letters, cones and tyre stacks can be knocked around.

A plain **Classic CV** view (the same page, `#cv` or `?classic`) is one click
away for recruiters, and is what browsers without JavaScript or WebGL get.

## Controls

| Desktop | Phone |
| --- | --- |
| `W A S D` or arrow keys to drive | Steering slider and Gas/Brake pedals |
| `Space` handbrake | Drift button |
| `R` reset to the track, `C` camera, `M` sound | Sectors menu to jump to a zone |
| Drag to look around | Drag to look around |

## Stack

- [Three.js](https://threejs.org/) r169 and [cannon-es](https://github.com/pmndrs/cannon-es) 0.20, vendored in `vendor/` (no build step)
- Plain HTML, CSS and ES modules; engine sound synthesised with the Web Audio API

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Classic CV content; each `<article>` is also a zone in the world |
| `world.css` | HUD, panels, touch controls and the classic CV layout |
| `main.js` | Boot, start lights, input, zone panel, minimap, sectors menu |
| `world.js` | The 3D world: sky, circuit, pit building, zones, props, camera |
| `drive.js` | Car handling (bicycle model with grip limit, brakes, handbrake) |
| `car.js` | Procedural F1 car (lofted bodywork, aerofoil wings, Pirelli tyres) |
| `audio.js` | Synthesised engine, tyre squeal and impact sounds |
| `style.css` | Styles for the project detail pages in `projects/` |

## Adding a CV entry

1. Add an `<article id="…">` to the classic CV in `index.html`, copying a
   neighbour. `data-kind` is `flag`, `pit`, `podium` or `finish`; `data-num`,
   `data-title`, `data-sub` and `data-date` are printed on its trackside board.
2. Give it a place in `ZONE_LAYOUT` at the top of `world.js`: `u` (0 to 1
   round the lap) and `side` (1 infield, -1 outside), or `garage` for the pit building.

## Run locally

ES modules need a web server, so open the site through one rather than as a file:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

The site works on GitHub Pages as-is.
