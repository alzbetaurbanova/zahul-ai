# Theme (scaffold)

Default: **dark**. Optional: **light** (partial — token overrides only).

## Files

| File | Role |
|------|------|
| `static/js/theme.js` | `data-theme` on `<html>`, localStorage, navbar wiring |
| `static/css/theme.css` | Light palette overrides (`[data-theme="light"]`) |

## HTML (panel pages)

Load **before** paint:

```html
<script src="/static/js/theme.js"></script>
<link rel="stylesheet" href="/static/css/styles.css">
<link rel="stylesheet" href="/static/css/theme.css">
```

## API (future)

- `GET /api/me` → `current_user.theme`: `"dark"` \| `"light"`
- Optional: `PATCH /api/users/{id}` or session prefs to persist

After login / navbar init: `ZahulTheme.syncFromSession()`.

## JS

```js
ZahulTheme.setTheme('light');       // + localStorage
ZahulTheme.getTheme();              // 'dark' | 'light'
ZahulTheme.syncFromSession();       // when API has user.theme
```

Navbar toggle uses `ZahulTheme.wireToggle(lightBtn, darkBtn)`.

## Extending light mode

1. Add token overrides in `theme.css`.
2. Add component rules under `[data-theme="light"]` as needed.
3. Avoid hard-coded Tailwind grays on new UI — use CSS variables from `styles.css`.
