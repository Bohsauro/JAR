# Contributing to JAR

Thanks for helping. JAR is small on purpose, and these notes keep it that way.

## Getting set up

```bash
git clone https://github.com/Bohsauro/pennyroute.git && cd pennyroute
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # add an OpenRouter key to try routing for real
uvicorn pennyroute.app:app --reload --port 8490
```

Run the tests before you push:

```bash
python -m unittest discover tests
```

## House rules

- **No build step.** The dashboard (`static/`) is plain HTML, CSS and JavaScript. Don't add a bundler, a framework or npm dependencies.
- **Few dependencies.** The backend needs five packages. A new one needs a reason in the PR description.
- **Plain JSON state.** Everything lives in `data/`. Write files atomically (temp file, then rename), as `store.py` does.
- **Additive API changes.** Clients depend on `/v1/*`, the `penny` alias and the `pnk-` key prefix. Don't rename or remove them; add new fields or endpoints instead.
- **Escape what you render.** Views build HTML from template strings, so every dynamic value goes through `esc()`.
- **Tests for behaviour changes.** A bug fix comes with a regression test in `tests/` that fails without the fix.
- **The landing page lives twice.** `static/landing.html` is served by the app; `docs/index.html` is the GitHub Pages copy. Change both.

## Pull requests

1. For anything bigger than a small fix, open an issue first so we can agree on the approach.
2. Keep each PR to one change. Say what it does and how you checked it.
3. For UI changes, add before and after screenshots.
4. Write commit messages as [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.

## Reporting bugs

Use the bug report template. Include your version, how you run JAR (installer, Docker or manual), what you expected and what happened, and the relevant lines from `data/events.jsonl` with keys removed.

Security problems go through [SECURITY.md](SECURITY.md), never public issues.
