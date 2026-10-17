# Contributing to Frantic's Wizarding Communication

Thanks for wanting to help! Bug reports, ideas, translations and code are all welcome, and none of them need to be big. For example, a typo fix is a perfectly good first pr.

## Reporting a bug

Open an issue with the **Bug report** template and tell:

- what you did, step by step;
- what you expected, and what happened instead;
- your HogwartsMP server version and the versions of `frantic-owls`, `hmp-core` and `hmp-mysql`;
- anything from the server log or the game's console around the time it happened.

Before pasting a log or your `data/frantic-owls.json`, take out passwords, webhook URLs and anything else private. If the bug lets one player read or do something they should not (another player's owls, for example), please do not post it publicly; message `franticdreamer` on Discord instead.

## Suggesting a feature

Check the [Features](README.md#features) table first: It may already be planned, and then a comment with your use for it still helps decide what comes next. Otherwise open an issue with the **Feature request** template and describe what a player (or server owner) would do with it. Ideas that fit the wizarding world, and work in character, fit best.

## Adding a language

No coding needed:

1. Copy `Lang/en-GB.json` to a file named after your language, e.g. `Lang/de.json` or `Lang/pt-BR.json`.
2. Set `"name"` to what the language calls itself, e.g. `"Deutsch"`.
3. Translate the strings. Keep every `{placeholder}` as it is; you may move it within the sentence.
4. Strings with `"one"` and `"other"` are plural forms. Add the forms your language needs (`zero`, `two`, `few`, `many`), as `Intl.PluralRules` names them.
5. Try it in the preview (see below), then open a pull request.

Keys you leave out fall back to English, so a partial translation is fine to send.

## Pull requests

1. Open an issue first for anything bigger than a small fix, so we can agree on the approach before you spend time on it.
2. Keep each pull request to one change. Two small pull requests get reviewed faster than one big one.
3. Fill in the pull request template: What changed, why, and how you tested it.

### Code style

The code follows my coding conventions, translated to JavaScript from C++. Might be stupid, but it's mine. Reading a file or two next to your change shows it best:

- tabs for indentation and braces on their own line (Allman style), everywhere;
- `PascalCase` functions and methods, `camelCase` variables, and `#private` class members listed first;
- `///` XML doc comments (`<summary>`, `<param>`, `<returns>`) on every function, with a `NOTE:` paragraph wherever the reason for the code is not obvious;
- British English in names, comments and text (`Initialise`, `colour`, `favourite`);
- no thrown errors: Functions return a result or a sentinel and log the problem (`Ok()` and `Fail()` for player requests);
- a `// YourName <year>` line at the top of new files.

### How things fit together

- **Player-facing text** never lives in code. Add a key to `Lang/en-GB.json` and use `T("your.key")` in the page or `Fail("your.key")` on the server.
- **New player actions** are registered in `Server/Main.js` through the `RequestDispatcher`, which checks the request's shape, rate and owl before your handler runs. Never trust what the page sends.
- **Database changes** go in a new migration at the end of `migrations` in `Server/Database.js`, one statement per version. Never edit a version that has been published.
- **Deleting owls** goes through soft deletion (see the README's [Deleting and pruning](README.md#deleting-and-pruning)) unless the server turned it off.

### Testing

- Serve the resource folder over HTTP (e.g. `python -m http.server` inside it) and open `Dev/Preview.html`. It runs the real phone page against a mock server, with buttons that simulate incoming owls, informs, duels and more. If your change adds something the mock does not know, teach `Dev/DevMock.js` about it.
- For server changes, run the resource on a local HogwartsMP server with MariaDB or MySQL, and try it with two characters.

## Licence

By contributing, you agree that your contribution is released under the resource's [BSD 3-Clause licence](LICENCE).
