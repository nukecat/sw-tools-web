# sw-tools-web

Browser version of [sw-tools](https://github.com/nukecat/sw-tools) for Sandbox World `.structure` files.
Everything runs locally in WebAssembly; nothing is uploaded.

Tools: Music Player (MIDI), Pixel Art (image), Mesh (glTF/GLB), Insert Data, Catalog (blocks, props and terrain layers).
Music Player, Pixel Art and Mesh convert as soon as you pick a file or change a setting. Pixel Art and Mesh show a 3D preview of
the result; Music Player plays what its tone generators would sound like in the game.

## Build

```
wasm-pack build --target web      # writes pkg/
python3 -m http.server            # then open http://localhost:8000
```

Pushing to `main` deploys to GitHub Pages via `.github/workflows/static.yml`.

## Notes

- Preview coordinates are the game's (left-handed); the viewer mirrors X. Pixel art is viewed from -Z so the picture reads
  the right way round, meshes from +Z (glTF front).
- The Music Player has no visual preview: its blocks are small parts stacked in one spot, which unit cubes would misrepresent.
- three.js (r160) is vendored in `js/vendor` and loaded through an import map.
