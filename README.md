# TA-aero website

Open [index.html](index.html) in a browser to preview the site locally. No build step is required.

## Editing
- **Contact details**: top of `js/site.js` (`CONFIG`). Only the ones you fill in are shown on the Contact page.
- **Photos**: add a `<figure class="slot" data-src="images/...">` like the existing ones. A slot whose file is missing stays hidden.
- **Timeline**: `journey.html`. Add `class="done"` to an `<li>` once a milestone is finished.
- **Navigation**: the `NAV` list in `js/site.js`.
- **Colours and fonts**: the `:root` block at the top of `css/style.css`.
- **3D car**: `js/car-model.js` builds the car (shape, paint, every part). `js/car3d.js` is the 3D lab (studio, exploded view, wind tunnel).
- **Racing game**: `game.html` and `js/game.js` (track layout is the `ctrl` list, rivals are in `RIVALS`). **Simulator physics**: `js/sim.js`.
