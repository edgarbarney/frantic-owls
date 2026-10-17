// FranticDreamer 2026
"use strict";

const fs = require("fs");
const path = require("path");

const { Logger } = require("./Logger.js");

/// <summary>
/// Language every other one falls back to, key by key. Its file must exist and hold every key.
/// </summary>
const baseLanguage = "en-GB";

/// <summary>
/// Folder holding one JSON file per language (e.g. Lang/en-GB.json), next to Server/.
/// Server scripts run as CommonJS, so __dirname is there; the server's working directory is the fallback should a loader ever drop it.
/// </summary>
const languageFolder = typeof __dirname === "string" ? path.join(__dirname, "..", "Lang") : path.join(process.cwd(), "resources", "frantic-owls", "Lang");

/// <summary>
/// Shape of a language ID, which doubles as the locale the page formats dates with (e.g. "en-GB", "de", "pt-BR").
/// </summary>
const languageIdPattern = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/;

/// <summary>
/// Plural categories a string may be split into, as Intl.PluralRules names them.
/// </summary>
const pluralCategories = Object.freeze(["zero", "one", "two", "few", "many", "other"]);

/// <summary>
/// Longest translated string kept, so a broken file cannot bloat what every page is sent.
/// </summary>
const maxStringLength = 2000;

// ========================
// Language Files
// ========================

/// <summary>
/// Loaded languages by ID: { id, name, strings } where strings maps a key to its text, or to { one, other, ... } for plurals.
/// </summary>
const languages = new Map();

/// <summary>
/// Language of players who have not picked one (ui.defaultLanguage), and of server logs and API errors.
/// </summary>
let defaultLanguage = baseLanguage;

/// <summary>
/// Read one translated value: a string, or an object of plural forms.
/// </summary>
/// <param name="value">Raw value from the file</param>
/// <returns>The value, or null when it is unusable</returns>
function CleanValue(value)
{
	if (typeof value === "string")
	{
		return value.slice(0, maxStringLength);
	}

	if (!value || typeof value !== "object" || Array.isArray(value))
	{
		return null;
	}

	const forms = {};

	for (const category of pluralCategories)
	{
		if (typeof value[category] === "string")
		{
			forms[category] = value[category].slice(0, maxStringLength);
		}
	}

	return typeof forms.other === "string" ? forms : null;
}

/// <summary>
/// Read one language file.
/// </summary>
/// <param name="file">File name inside the language folder</param>
/// <returns>{ id, name, strings }, or null when the file is unusable</returns>
function ReadLanguage(file)
{
	const id = path.basename(file, ".json");

	if (!languageIdPattern.test(id))
	{
		Logger.LogWarning("Lang", `Skipped ${file}: "${id}" is not a language ID like "en-GB" or "de".`);
		return null;
	}

	// JSON.parse throws on a malformed file; one broken translation should not take the others down.
	let parsed = null;

	try
	{
		parsed = JSON.parse(fs.readFileSync(path.join(languageFolder, file), "utf8"));
	}
	catch (error)
	{
		Logger.LogWarning("Lang", `Skipped ${file}: ${Logger.Describe(error)}`);
		return null;
	}

	if (!parsed || typeof parsed !== "object" || !parsed.strings || typeof parsed.strings !== "object")
	{
		Logger.LogWarning("Lang", `Skipped ${file}: it needs a "strings" object.`);
		return null;
	}

	const strings = {};

	for (const [key, value] of Object.entries(parsed.strings))
	{
		const clean = CleanValue(value);

		if (clean !== null)
		{
			strings[key] = clean;
		}
	}

	return { id, name: String(parsed.name || id).trim().slice(0, 40) || id, strings };
}

/// <summary>
/// Load every language in Lang/. Call once, after the logger is ready.
/// </summary>
/// <param name="preferredDefault">ui.defaultLanguage; falls back to en-GB when no such language was loaded</param>
function Load(preferredDefault)
{
	languages.clear();

	// readdirSync throws when the folder is missing, which leaves the server with keys instead of text; say so loudly.
	let files = [];

	try
	{
		files = fs.readdirSync(languageFolder).filter((file) => file.toLowerCase().endsWith(".json")).sort();
	}
	catch (error)
	{
		Logger.LogError("Lang", `Could not read the Lang folder: ${Logger.Describe(error)}`);
	}

	for (const file of files)
	{
		const language = ReadLanguage(file);

		if (language)
		{
			languages.set(language.id, language);
		}
	}

	if (!languages.has(baseLanguage))
	{
		Logger.LogError("Lang", `Lang/${baseLanguage}.json is missing or broken; players will see text keys instead of text.`);
		languages.set(baseLanguage, { id: baseLanguage, name: "English (UK)", strings: {} });
	}

	defaultLanguage = languages.has(preferredDefault) ? preferredDefault : baseLanguage;

	if (preferredDefault && preferredDefault !== defaultLanguage)
	{
		Logger.LogWarning("Lang", `ui.defaultLanguage "${preferredDefault}" has no file in Lang/; using ${defaultLanguage}.`);
	}

	Logger.LogMessage("Lang", `Languages: ${[...languages.keys()].join(", ")} (default ${defaultLanguage}).`);
}

// ========================
// Lookup
// ========================

/// <summary>
/// A known language ID, matched without regard to case.
/// </summary>
/// <param name="id">Requested ID</param>
/// <returns>The loaded ID, or "" when there is no such language</returns>
function Normalise(id)
{
	const wanted = String(id || "").trim().toLowerCase();

	for (const known of languages.keys())
	{
		if (known.toLowerCase() === wanted)
		{
			return known;
		}
	}

	return "";
}

/// <summary>
/// The language a player actually gets: their choice when it still exists, otherwise the server default.
/// </summary>
/// <param name="id">Player's chosen language ("" for the default)</param>
/// <returns>Loaded language ID</returns>
function Resolve(id)
{
	return Normalise(id) || defaultLanguage;
}

/// <summary>
/// Put parameters into a text: "{name} left." with { name: "Bram" } becomes "Bram left.".
/// Placeholders without a parameter are left as they are, so a missing one is visible rather than silently blank.
/// </summary>
/// <param name="text">Text with {placeholders}</param>
/// <param name="params">Parameter values</param>
/// <returns>Finished text</returns>
function Interpolate(text, params)
{
	return text.replace(/\{(\w+)\}/g, (match, name) => (params[name] === undefined || params[name] === null ? match : String(params[name])));
}

/// <summary>
/// Translate a key into a language.
/// A key the language lacks falls back to en-GB; a key nobody has comes back as itself.
/// A plural string picks its form from params.count.
/// </summary>
/// <param name="id">Language ID ("" for the default)</param>
/// <param name="key">Text key (e.g. "error.chatGone")</param>
/// <param name="params">Parameters for its placeholders (optional)</param>
/// <returns>Translated text</returns>
function Translate(id, key, params = {})
{
	const language = languages.get(Resolve(id));
	const base = languages.get(baseLanguage);
	const value = language && language.strings[key] !== undefined ? language.strings[key] : base ? base.strings[key] : undefined;

	if (value === undefined)
	{
		return key;
	}

	if (typeof value === "string")
	{
		return Interpolate(value, params);
	}

	// Intl.PluralRules throws on a locale it cannot parse; the "other" form is always there to fall back on.
	let category = "other";

	try
	{
		category = new Intl.PluralRules(language ? language.id : baseLanguage).select(Number(params.count) || 0);
	}
	catch (error)
	{
		category = "other";
	}

	return Interpolate(value[category] ?? value.other, params);
}

/// <summary>
/// Every string of a language with the en-GB fallbacks filled in, for the page.
/// </summary>
/// <param name="id">Language ID ("" for the default)</param>
/// <returns>{ id, strings }</returns>
function GetTable(id)
{
	const resolved = Resolve(id);
	const base = languages.get(baseLanguage);
	const language = languages.get(resolved);
	return { id: resolved, strings: { ...(base ? base.strings : {}), ...(language ? language.strings : {}) } };
}

/// <summary>
/// The languages players can pick, in file order.
/// </summary>
/// <returns>[{ id, name }]</returns>
function List()
{
	return [...languages.values()].map((language) => ({ id: language.id, name: language.name }));
}

/// <summary>
/// The server's default language.
/// </summary>
/// <returns>Language ID</returns>
function GetDefault()
{
	return defaultLanguage;
}

// ========================
// Problems
// ========================

/// <summary>
/// Describe something that went wrong, for a player, without picking a language yet.
/// The page translates it into the player's language; logs and other resources get the server default (see Describe).
/// </summary>
/// <param name="key">Text key</param>
/// <param name="params">Parameters for its placeholders (optional)</param>
/// <returns>{ key, params }</returns>
function Problem(key, params = {})
{
	return { key, params };
}

/// <summary>
/// A problem as text in the server's default language.
/// </summary>
/// <param name="problem">{ key, params }, or a plain key</param>
/// <returns>Text</returns>
function Describe(problem)
{
	return typeof problem === "string" ? Translate("", problem) : Translate("", problem.key, problem.params || {});
}

module.exports = { Load, Normalise, Resolve, Translate, GetTable, List, GetDefault, Problem, Describe, baseLanguage };
