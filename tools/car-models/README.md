# Car models

How `public/models/cars/*.glb.gz` are made from models other people built. This
folder is not part of the site: nothing in `src/` imports it, the site's build
does not run it, and its dependencies are its own.

The output is deterministic. Run on the same downloads, it reproduces the
shipped files byte for byte.

## Sources

Each is CC BY 4.0. The credits are on the site, in the footer
(`src/content/carModels.ts`).

| Key | Download as GLB from | Save as `raw/` |
| --- | --- | --- |
| `nexia` | https://sketchfab.com/3d-models/90006f59fd594d2b95f1469f651491f1 (vsevolod_smoki) | `daewoo_-_nexiacielo.glb` |
| `damas` | https://sketchfab.com/3d-models/70f8556e4b3840e7b975f0e000b54757 (own.guest) | `chevrolet_damas.glb` |
| `matiz` | https://sketchfab.com/3d-models/61be0476f0d64a9d8b37e4cdbc430fff (elijahforonda631) | `daewoo-matiz.glb` |
| `malibu` | https://sketchfab.com/3d-models/c1e8e127ce114b14a166e93100642424 (twr422) | `2021_chevrolet_malibu_2lz_premier.glb` |
| `vaz2106` | https://sketchfab.com/3d-models/a73b3cdeddd846209bf7c73d5f04d20f (domhathair) | `vaz-2106.glb` |
| `vaz2107` | https://sketchfab.com/3d-models/91270dab9d1a47c7ba7ffaaf8c8b0beb (prephonat) | `old_car_-_vaz_2107.glb` |

Sketchfab only lets a signed-in account download. Use the "glTF Binary (.glb)"
option, which is the autoconverted one.

## Running it

```bash
cd tools/car-models
npm ci
node process.mjs --all        # or: node process.mjs nexia [--debug]
cp out/*.glb.gz ../../public/models/cars/
```

`raw/`, `out/` and `node_modules/` are ignored by git.

## What it does to each model

`process.mjs` does the same thing to every model. What differs between them is
in `models.mjs`, `models-a.mjs` and `models-b.mjs`: which file it is, which way
it faces, how long the real car is, and what each part is.

1. **Normalises it.** The model is read in world space. It is then turned so
   its front is +x, with +y up and +z the car's right. It is scaled so its
   length is the real car's, then stood on y = 0 and centred on the middle of
   its wheelbase.
2. **Gives every triangle a role.** The roles are `paint` or `skin`, `glass`,
   `chrome`, `trim`, `lamp_front`, `lamp_rear`, `lamp_turn`, `tyre`, `rim` or
   `wheel`, `detail`, and `cabin`.
   - A role comes from the part's material, its place on the car, and, where
     one texture covers everything, the colour under the triangle.
   - A triangle with no role is dropped. That is how interiors, engines,
     badges, nameplates and the models' own number plates go.
   - Where the seats have been taken out, a dark `cabin` box stands in for
     them behind the glass.
3. **Keeps the paint tintable.** An untextured body is `paint` with a white
   base. A textured one is `skin`: its own texture, plus a soft greyscale mask
   of where the paint is, which rides in the emissive slot with no emission.
   It also carries a `paintGain` that brings the paint's own shade up to one.
   The walk tints only what the mask marks, so dust and rust stay where they
   are.
4. **Finds the wheels.** It takes every `tyre`, `rim` and `wheel` triangle and
   splits them into four corners. The front-right wheel becomes the one
   template, centred on its own axle. Its four places go in the extras, and
   the left side's wheels are that template turned half round.
5. **Simplifies it** with meshoptimizer, to two levels of detail. Near is about
   9 000 triangles for the body plus about 1 000 for the wheel; far is about
   2 000 plus 300. `models-a.mjs` and `models-b.mjs` also weld, flatten and
   pre-simplify the parts of models that store every corner three times,
   which meshoptimizer would otherwise refuse to collapse.
6. **Packs it.**
   - Textures become WebP at 512 px or less.
   - Texture coordinates are squeezed into [0, 1], with a
     `KHR_texture_transform` to undo it.
   - Positions, normals and texture coordinates are quantised
     (`KHR_mesh_quantization`).
   - The file is gzipped at level 9.
   - No Draco, meshopt compression or KTX2: decoding those needs WebAssembly,
     which the site's Content-Security-Policy does not allow.
   - The site unpacks the gzip itself (`DecompressionStream`), so how the host
     serves the file makes no difference.

## What a file holds

- **Nodes:**
  - `body`, `wheel`, `body_far` and `wheel_far`.
  - Each node carries a matrix: a uniform scale and a translation, which turn
    its quantised positions back into metres.
- **Materials:** each material's `extras.role` names its role.
- **`scene.extras`:**
  - `kind`, `length`, `width`, `height`, `wheelbase`, `track`, `wheelRadius`
    and `wheelFaces`.
  - `wheels`: four axles, in the order front-left, front-right, rear-left,
    rear-right.
  - `plates`: the front and rear plate, each as its centre, width and height,
    facing ±x.
  - `credit`.

`tests/unit/carModels.test.ts` checks every shipped file against this: the
contract, the triangle and texture budgets, no decoder extensions, the size,
and that the credit matches the footer's.
