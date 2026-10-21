# Vansh Thacker — 3D F1 Portfolio

A personal portfolio rendered as a real-time 3D night circuit. Each career
milestone and project is a stop on the lap, marked by a trackside LED board.
Scrolling drives a procedurally modelled F1 car from stop to stop, switching
between parked three-quarter shots and a chase cam, and ends on the finish line.

## Stack

- [Three.js](https://threejs.org/) r169 (vendored in `vendor/`, no build step)
- Plain HTML, CSS and ES modules

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page content and layout |
| `style.css` | Design system and responsive styles (shared with project pages) |
| `main.js` | Scroll, HUD, start-lights intro, navigation, card tilt |
| `scene.js` | Three.js scene: circuit, milestone boards, lighting, bloom and camera |
| `car.js` | Procedural F1 car (lofted bodywork, aerofoil wings, Pirelli tyres) |
| `assets/` | Optional `f1-car.glb` to swap in a downloaded car model |
| `projects/` | Project detail pages |
| `ferrari.mp4` | Fallback background when WebGL is unavailable |

## Adding a milestone

Add a `<section class="section stop">` to `index.html` with `data-u` (its
position around the lap, 0 to 1), `data-cam`, `data-frame` and the board text
in `data-num`, `data-title`, `data-sub` and `data-date`. Copy a neighbour.

## Run locally

ES modules need a web server, so open the site through one rather than as a file:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

The site works on GitHub Pages as-is.
