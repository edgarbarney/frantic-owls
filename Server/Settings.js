// FranticDreamer 2026
"use strict";

const { Ok, Fail } = require("./Result.js");
const { NormaliseTheme } = require("./Config.js");
const { CheckAvatarUrl } = require("./Avatars.js");
const Lang = require("./Lang.js");

/// <summary>
/// Range of the player's own phone scale, on top of the server's ui.scale.
/// </summary>
const minLayoutScale = 0.6;
const maxLayoutScale = 1.6;

// ========================
// Player Settings
// ========================

/// <summary>
/// Per-owl settings a player can change from the Settings screen, with their defaults.
/// Only these keys are ever stored; anything else a client sends is dropped.
///
/// <para>
/// theme is "" until the player picks one, so a server that changes phonemode_ui.defaultTheme also changes it for everyone who never chose.
/// layout is null while the phone sits in its default place; otherwise { x, y } is the phone's centre as a fraction of the screen
/// (so it survives resolution changes) and scale multiplies the server's ui.scale.
/// sound is "" for the server's default notification sound, otherwise the ID of one of notifications.sounds.
/// ringtone is the same for Floo-Calls ringing: "" for calls.defaultRingtone, otherwise the ID of one of calls.ringtones; ringtoneVolume is its own volume.
/// callVolume is how loud the other owl's voice plays during a Floo-Call.
/// language is "" for the server's default language (defaultLanguage), otherwise the ID of a file in Lang/.
/// doNotDisturb silences every pop-up, banner and sound; quietDuringActivities does the same only while a notifications.quietActivities activity (e.g. a duel) runs.
/// colourScheme picks the Muggle Phone theme's colours ("default" or one of the four houses); Parchment ignores it.
/// animations turns the Muggle Phone's motion on or off: icons falling into place, and apps opening from and closing into their icons.
/// lockScreen shows the lock screen each time the phone is taken out (a clock on Muggle Phone, a sealed letter on Parchment), when the server allows it (phonemode_ui.lockScreen).
/// soundEffects plays the phone's own sounds (key taps, app taps, locking, owls sent and arriving in the chat on screen) at effectsVolume, when the server has any (effects).
/// wallpaperUrl is the home screen's picture ("" for none). Only its owner's page ever loads it, so unlike profile pictures it shows nobody else's IP address to the image host.
/// </para>
///
/// <para>
/// NOTE: readReceipts and typingIndicators work both ways, as in most messengers: an owl that stops sharing them also stops seeing other owls'.
/// </para>
///
/// </summary>
const defaultSettings = Object.freeze
({
	notificationSound: true,
	notificationVolume: 0.6,
	popups: true,
	sound: "",
	ringtone: "",
	ringtoneVolume: 0.8,
	callVolume: 1,
	readReceipts: true,
	typingIndicators: true,
	theme: "",
	layout: null,
	language: "",
	doNotDisturb: false,
	quietDuringActivities: true,
	wallpaperUrl: "",
	colourScheme: "default",
	animations: true,
	lockScreen: true,
	soundEffects: true,
	effectsVolume: 0.5,
});

/// <summary>
/// Colour schemes the page ships styles for.
/// </summary>
const colourSchemes = Object.freeze(["default", "gryffindor", "slytherin", "ravenclaw", "hufflepuff"]);

/// <summary>
/// Longest stored wallpaper link. Links are checked against avatars.maxUrlLength when set; this only bounds what is read back.
/// </summary>
const maxWallpaperLength = 2048;

/// <summary>
/// Validate a phone layout.
/// </summary>
/// <param name="raw">Stored or client-supplied value</param>
/// <param name="fallback">Value used when raw is unusable (undefined counts as unusable; null is a valid "default place")</param>
/// <returns>{ x, y, scale } or null</returns>
function SanitiseLayout(raw, fallback)
{
	if (raw === null)
	{
		return null;
	}

	if (!raw || typeof raw !== "object")
	{
		return fallback;
	}

	const x = Number(raw.x);
	const y = Number(raw.y);
	const scale = Number(raw.scale);

	if (![x, y, scale].every(Number.isFinite))
	{
		return fallback;
	}

	return {
		x: Math.min(1, Math.max(0, x)),
		y: Math.min(1, Math.max(0, y)),
		scale: Math.min(maxLayoutScale, Math.max(minLayoutScale, scale)),
	};
}

/// <summary>
/// Keep the known keys of a settings object and coerce them to their expected types.
/// </summary>
/// <param name="raw">Stored or client-supplied object (may be anything)</param>
/// <param name="base">Values used for keys missing from raw</param>
/// <returns>Complete, valid settings object</returns>
function SanitiseSettings(raw, base = defaultSettings)
{
	const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
	const volume = Number(source.notificationVolume);
	const ringtoneVolume = Number(source.ringtoneVolume);
	const callVolume = Number(source.callVolume);
	const effectsVolume = Number(source.effectsVolume);

	return {
		notificationSound: typeof source.notificationSound === "boolean" ? source.notificationSound : base.notificationSound,
		notificationVolume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : base.notificationVolume,
		popups: typeof source.popups === "boolean" ? source.popups : base.popups,
		sound: typeof source.sound === "string" && /^[a-z0-9_-]{0,24}$/.test(source.sound) ? source.sound : base.sound,
		ringtone: typeof source.ringtone === "string" && /^[a-z0-9_-]{0,24}$/.test(source.ringtone) ? source.ringtone : base.ringtone,
		ringtoneVolume: Number.isFinite(ringtoneVolume) ? Math.min(1, Math.max(0, ringtoneVolume)) : base.ringtoneVolume,
		callVolume: Number.isFinite(callVolume) ? Math.min(1, Math.max(0, callVolume)) : base.callVolume,
		readReceipts: typeof source.readReceipts === "boolean" ? source.readReceipts : base.readReceipts,
		typingIndicators: typeof source.typingIndicators === "boolean" ? source.typingIndicators : base.typingIndicators,
		theme: source.theme === "" ? "" : NormaliseTheme(source.theme) || base.theme,
		layout: SanitiseLayout(source.layout, base.layout),
		language: source.language === "" ? "" : Lang.Normalise(source.language) || base.language,
		doNotDisturb: typeof source.doNotDisturb === "boolean" ? source.doNotDisturb : base.doNotDisturb,
		quietDuringActivities: typeof source.quietDuringActivities === "boolean" ? source.quietDuringActivities : base.quietDuringActivities,
		wallpaperUrl: typeof source.wallpaperUrl === "string" && source.wallpaperUrl.length <= maxWallpaperLength ? source.wallpaperUrl : base.wallpaperUrl,
		colourScheme: colourSchemes.includes(source.colourScheme) ? source.colourScheme : base.colourScheme,
		animations: typeof source.animations === "boolean" ? source.animations : base.animations,
		lockScreen: typeof source.lockScreen === "boolean" ? source.lockScreen : base.lockScreen,
		soundEffects: typeof source.soundEffects === "boolean" ? source.soundEffects : base.soundEffects,
		effectsVolume: Number.isFinite(effectsVolume) ? Math.min(1, Math.max(0, effectsVolume)) : base.effectsVolume,
	};
}

// ========================
// Settings Service
// ========================

/// <summary>
/// Reads and writes the Settings screen's values.
/// </summary>
class SettingsService
{
	/// <summary>
	/// OwlDatabase instance.
	/// </summary>
	#database;

	/// <summary>
	/// The "phonemode_ui" section of the server config.
	/// </summary>
	#uiConfig;

	/// <summary>
	/// OwlDirectory instance, whose entries hold the settings of owls online.
	/// </summary>
	#directory;

	/// <summary>
	/// The "phonemode_avatars" section of the server config, whose link rules the wallpaper follows too.
	/// </summary>
	#avatarsConfig;

	/// <summary>
	/// Constructor.
	/// </summary>
	/// <param name="database">OwlDatabase instance</param>
	/// <param name="uiConfig">The "phonemode_ui" section of the server config</param>
	/// <param name="directory">OwlDirectory instance</param>
	/// <param name="avatarsConfig">The "phonemode_avatars" section of the server config</param>
	constructor(database, uiConfig, directory, avatarsConfig)
	{
		this.#database = database;
		this.#uiConfig = uiConfig;
		this.#directory = directory;
		this.#avatarsConfig = avatarsConfig;
	}

	/// <summary>
	/// The settings of several owls: from memory for those online, from the database for the rest.
	/// </summary>
	/// <param name="numbers">Owl numbers</param>
	/// <returns>Map of number to complete settings; an owl whose settings cannot be read gets the defaults</returns>
	async GetMany(numbers)
	{
		const result = new Map();
		const offline = [];

		for (const number of numbers)
		{
			const entry = this.#directory.GetByNumber(number);

			if (entry)
			{
				result.set(number, entry.settings);
			}
			else
			{
				offline.push(number);
			}
		}

		const stored = offline.length > 0 ? await this.#database.ListSettings(offline) : new Map();

		for (const number of offline)
		{
			result.set(number, SanitiseSettings(stored ? stored.get(number) : null));
		}

		return result;
	}

	/// <summary>
	/// Load an owl's settings, falling back to the defaults when nothing is stored or the read fails.
	/// </summary>
	/// <param name="number">Owl number</param>
	/// <returns>Complete settings object</returns>
	async Load(number)
	{
		const stored = await this.#database.GetSettings(number);
		return SanitiseSettings(stored);
	}

	/// <summary>
	/// Apply a partial settings change from the client.
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <param name="data">{ settings } with any subset of the known keys</param>
	/// <returns>Result carrying the full, saved settings object</returns>
	async Update(entry, data)
	{
		const changes = data && typeof data.settings === "object" ? data.settings : null;

		if (!changes)
		{
			return Fail("error.nothingToSave");
		}

		// Moving the phone is opt-in per server; without it the stored layout is left exactly as it was.
		const accepted = { ...changes };

		if (!this.#uiConfig.allowMove)
		{
			delete accepted.layout;
		}

		// A wallpaper link follows the same rules as picture links (https, length, allowed hosts).
		if (accepted.wallpaperUrl !== undefined)
		{
			const wallpaper = CheckAvatarUrl(accepted.wallpaperUrl, this.#avatarsConfig);

			if (!wallpaper.ok)
			{
				return Fail(wallpaper.error);
			}

			accepted.wallpaperUrl = wallpaper.url;
		}

		const merged = SanitiseSettings({ ...entry.settings, ...accepted }, entry.settings);

		if (!await this.#database.SaveSettings(entry.number, merged))
		{
			return Fail("error.settingsFailed");
		}

		entry.settings = merged;
		return Ok({ settings: merged });
	}

	/// <summary>
	/// Put the phone back in its default place and size.
	/// </summary>
	/// <param name="entry">Directory entry of the owl</param>
	/// <returns>True when saved</returns>
	async ResetLayout(entry)
	{
		const reset = { ...entry.settings, layout: null };

		if (!await this.#database.SaveSettings(entry.number, reset))
		{
			return false;
		}

		entry.settings = reset;
		return true;
	}
}

module.exports = { SettingsService, SanitiseSettings, defaultSettings, minLayoutScale, maxLayoutScale };
