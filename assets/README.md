# Optional photoreal car

The site draws its own F1 car in code. To use a downloaded model instead,
put a glTF binary here named `f1-car.glb` (for example a CC-BY model from
Sketchfab, credited in the footer). It is scaled to 5.6 m and placed on the
track automatically.

If it faces the wrong way, add `f1-car.json` next to it:

```json
{ "rotateY": 180 }
```
