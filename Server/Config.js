// FranticDreamer 2026
"use strict";

const { Logger } = require("./Logger.js");

// ========================
// Defaults
// ========================

/// <summary>
/// Every server setting with its default value.
/// data/frantic-owls.json is merged over this, so a server only needs to list what it changes.
/// </summary>
const defaultConfig = Object.freeze
({
	command: "owl",
	openKey: "up",
	numbers:
	{
		visible: false,
	},
	contacts:
	{
		maxContacts: 250,
		maxNameLength: 40,
	},
	avatars:
	{
		maxUrlLength: 512,
		allowedHosts: [],
		allowInsecure: false,
	},
	messages:
	{
		maxLength: 500,
		pageSize: 40,
		maxChatsListed: 100,
		rateLimitCount: 8,
		rateLimitWindowMs: 5000,
		unsendSeconds: 120,
		maxPinnedChats: 5,
	},
	privacy:
	{
		readReceipts: true,
		typingIndicators: true,
	},
	groups:
	{
		maxMembers: 12,
		maxTitleLength: 40,
	},
	inform:
	{
		rangeMetres: 5,
		rangeToleranceMetres: 2,
		cooldownSeconds: 30,
		revealNames: true,
		requireConsent: true,
		allowExchange: true,
		requestSeconds: 60,
	},
	locations:
	{
		enabled: true,
		markerSeconds: 0,
		arrivalMetres: 10,
	},
	calls:
	{
		enabled: true,
		ringSeconds: 30,
		logSize: 50,
		rateLimitCount: 4,
		rateLimitWindowMs: 30000,
		ringtones:
		[
			{ id: "hoot", label: "Owl Hoot", file: "Sounds/OwlHoot.wav" },
			{ id: "chime", label: "Bell Chime", file: "Sounds/BellChime.wav" },
			{ id: "harp", label: "Enchanted Harp", file: "Sounds/EnchantedHarp.wav" },
		],
		defaultRingtone: "hoot",
		voiceEnabled: true,
		voiceBitrate: 24000,
	},
	notifications:
	{
		toastDurationMs: 3000,
		bannerDurationMs: 4000,
		soundMode: "file",
		sounds:
		[
			{ id: "hoot", label: "Owl Hoot", file: "Sounds/OwlHoot.wav" },
			{ id: "chime", label: "Bell Chime", file: "Sounds/BellChime.wav" },
			{ id: "sparkle", label: "Wand Sparkle", file: "Sounds/WandSparkle.wav" },
			{ id: "tap", label: "Window Tap", file: "Sounds/WindowTap.wav" },
			{ id: "quill", label: "Quill Scratch", file: "Sounds/QuillScratch.wav" },
			{ id: "harp", label: "Enchanted Harp", file: "Sounds/EnchantedHarp.wav" },
		],
		defaultSound: "hoot",
		wwiseEvent: "UI_OwlMail_Envelope_Open",
		quietActivities: ["duel:standard"],
	},
	storage:
	{
		disableSoftDelete: false,
		messageRetentionDays: 0,
	},
	flight:
	{
		enabled: false,
		minSeconds: 3,
		maxSeconds: 45,
		secondsPerHundredMetres: 3,
		groupSeconds: 5,
	},
	announcements:
	{
		enabled: true,
		command: "owl_announce",
		senderName: "Ministry of Magic",
		avatarUrl: "",
		capability: "admin.announce",
		fallbackGroup: "admin",
		fallbackMinimumGrade: 1,
		maxLength: 1000,
	},
	logging:
	{
		enabled: false,
		destination: "",
		url: "",
		urlEnv: "FRANTIC_OWLS_WEBHOOK_URL",
		username: "Owl Post",
		includeBodies: false,
		flushIntervalMs: 5000,
		events:
		{
			messages: true,
			groups: true,
			informs: true,
			calls: true,
			blocks: true,
			announcements: true,
			system: true,
		},
	},
	network:
	{
		flushIntervalMs: 50,
		nearbyRefreshMs: 1000,
		requestTimeoutMs: 8000,
		requestRateLimitCount: 30,
		requestRateLimitWindowMs: 3000,
		maxBatchBytes: 24000,
	},
	ui:
	{
		scale: 1.0,
		widthPx: 360,
		heightPx: 700,
		rightMarginPx: 32,
		defaultTheme: "muggle",
		defaultLanguage: "en-GB",
		allowMove: false,
	},
});

const configPath = "data/frantic-owls.json";
const soundModes = ["file", "wwise", "none"];

/// <summary>
/// Most notification sounds a server can offer, and the shape of a sound's ID.
/// </summary>
const maxSounds = 16;
const soundIdPattern = /^[a-z0-9_-]{1,24}$/;

/// <summary>
/// Read a sound file path. It becomes an audio element's source inside the page, so it must stay a plain relative path within UI/.
/// </summary>
/// <param name="value">Configured path</param>
/// <returns>The path, or "" when it is not acceptable</returns>
function CleanSoundFile(value)
{
	const file = String(value || "").trim().replace(/\\/g, "/");
	return /^[A-Za-z0-9_\-/]+\.(wav|mp3|ogg)$/.test(file) && !file.includes("..") ? file : "";
}

/// <summary>
/// Read a configured list of sounds (notification sounds or ringtones), dropping entries that are malformed or repeat an ID.
/// </summary>
/// <param name="list">Configured list: [{ id, label, file }]</param>
/// <param name="fallback">List used when nothing configured is usable</param>
/// <returns>Clean list, never empty</returns>
function CleanSoundList(list, fallback)
{
	const sounds = [];

	for (const raw of Array.isArray(list) ? list : [])
	{
		const id = String(raw && raw.id || "").trim().toLowerCase();
		const file = CleanSoundFile(raw && raw.file);

		if (sounds.length < maxSounds && soundIdPattern.test(id) && file && !sounds.some((sound) => sound.id === id))
		{
			sounds.push({ id, label: String(raw.label || id).trim().slice(0, 32) || id, file });
		}
	}

	return sounds.length > 0 ? sounds : JSON.parse(JSON.stringify(fallback));
}

/// <summary>
/// Phone themes the page ships styles for.
/// </summary>
const themes = Object.freeze(["muggle", "parchment"]);

/// <summary>
/// Former theme IDs and the theme that replaced each, so older configs and saved choices keep their look.
/// </summary>
const themeAliases = Object.freeze({ night: "muggle" });

// ========================
// Clamping
// ========================

/// <summary>
/// Read a theme ID, following renamed themes to their current ID.
/// </summary>
/// <param name="value">Configured or stored theme</param>
/// <returns>A known theme ID, or "" when value names none</returns>
function NormaliseTheme(value)
{
	const theme = String(value || "").trim().toLowerCase();
	const current = Object.prototype.hasOwnProperty.call(themeAliases, theme) ? themeAliases[theme] : theme;
	return themes.includes(current) ? current : "";
}

/// <summary>
/// Read an integer setting, falling back when it is missing or not a number.
/// </summary>
/// <param name="value">Raw configured value</param>
/// <param name="minimum">Smallest accepted value</param>
/// <param name="maximum">Largest accepted value</param>
/// <param name="fallback">Value used when the setting is unusable</param>
/// <returns>Integer clamped into [minimum, maximum]</returns>
function ClampInteger(value, minimum, maximum, fallback)
{
	const number = Math.trunc(Number(value));

	if (!Number.isFinite(number))
	{
		return fallback;
	}

	return Math.min(maximum, Math.max(minimum, number));
}

/// <summary>
/// Read a decimal setting, falling back when it is missing or not a number.
/// </summary>
/// <param name="value">Raw configured value</param>
/// <param name="minimum">Smallest accepted value</param>
/// <param name="maximum">Largest accepted value</param>
/// <param name="fallback">Value used when the setting is unusable</param>
/// <returns>Number clamped into [minimum, maximum]</returns>
function ClampNumber(value, minimum, maximum, fallback)
{
	const number = Number(value);

	if (!Number.isFinite(number))
	{
		return fallback;
	}

	return Math.min(maximum, Math.max(minimum, number));
}

/// <summary>
/// Clamp every loaded setting into a range the rest of the resource can rely on.
/// </summary>
/// <param name="config">Merged configuration, modified in place</param>
/// <returns>The same configuration object</returns>
function Sanitise(config)
{
	const fallback = defaultConfig;

	// A section written as something other than an object (e.g. "inform": null) would break every read below.
	for (const [section, value] of Object.entries(fallback))
	{
		if (typeof value === "object" && (!config[section] || typeof config[section] !== "object" || Array.isArray(config[section])))
		{
			config[section] = JSON.parse(JSON.stringify(value));
		}
	}

	config.command = String(config.command || fallback.command).trim().replace(/^\//, "").toLowerCase() || fallback.command;
	config.openKey = String(config.openKey || "").trim().toLowerCase();
	config.numbers.visible = config.numbers.visible === true;

	// The crest is worded by the language files now; an old config's branding section is simply ignored.
	delete config.branding;

	const contacts = config.contacts;
	contacts.maxContacts = ClampInteger(contacts.maxContacts, 1, 5000, fallback.contacts.maxContacts);
	contacts.maxNameLength = ClampInteger(contacts.maxNameLength, 2, 64, fallback.contacts.maxNameLength);

	const avatars = config.avatars;
	avatars.maxUrlLength = ClampInteger(avatars.maxUrlLength, 32, 2048, fallback.avatars.maxUrlLength);
	avatars.allowedHosts = Array.isArray(avatars.allowedHosts) ? avatars.allowedHosts.map((host) => String(host).trim().toLowerCase()).filter((host) => host.length > 0) : [];
	avatars.allowInsecure = avatars.allowInsecure === true;

	const messages = config.messages;
	messages.maxLength = ClampInteger(messages.maxLength, 1, 4000, fallback.messages.maxLength);
	messages.pageSize = ClampInteger(messages.pageSize, 5, 200, fallback.messages.pageSize);
	messages.maxChatsListed = ClampInteger(messages.maxChatsListed, 10, 1000, fallback.messages.maxChatsListed);
	messages.rateLimitCount = ClampInteger(messages.rateLimitCount, 1, 1000, fallback.messages.rateLimitCount);
	messages.rateLimitWindowMs = ClampInteger(messages.rateLimitWindowMs, 100, 600000, fallback.messages.rateLimitWindowMs);
	messages.unsendSeconds = ClampInteger(messages.unsendSeconds, 0, 86400, fallback.messages.unsendSeconds);
	messages.maxPinnedChats = ClampInteger(messages.maxPinnedChats, 0, 50, fallback.messages.maxPinnedChats);

	const privacy = config.privacy;
	privacy.readReceipts = privacy.readReceipts !== false;
	privacy.typingIndicators = privacy.typingIndicators !== false;

	const groups = config.groups;
	groups.maxMembers = ClampInteger(groups.maxMembers, 3, 64, fallback.groups.maxMembers);
	groups.maxTitleLength = ClampInteger(groups.maxTitleLength, 2, 64, fallback.groups.maxTitleLength);

	const inform = config.inform;
	inform.rangeMetres = ClampNumber(inform.rangeMetres, 0.5, 100, fallback.inform.rangeMetres);
	inform.rangeToleranceMetres = ClampNumber(inform.rangeToleranceMetres, 0, 50, fallback.inform.rangeToleranceMetres);
	inform.cooldownSeconds = ClampNumber(inform.cooldownSeconds, 0, 86400, fallback.inform.cooldownSeconds);
	inform.revealNames = inform.revealNames !== false;
	inform.requireConsent = inform.requireConsent !== false;
	inform.allowExchange = inform.allowExchange !== false;
	inform.requestSeconds = ClampInteger(inform.requestSeconds, 10, 3600, fallback.inform.requestSeconds);

	const locations = config.locations;
	locations.enabled = locations.enabled !== false;
	// 0 keeps a shown location until the reader reaches it or hides it; any other value is a time limit of at least 30 seconds.
	const markerSeconds = ClampInteger(locations.markerSeconds, 0, 86400, fallback.locations.markerSeconds);
	locations.markerSeconds = markerSeconds > 0 ? Math.max(30, markerSeconds) : 0;
	locations.arrivalMetres = ClampNumber(locations.arrivalMetres, 1, 100, fallback.locations.arrivalMetres);

	const calls = config.calls;
	calls.enabled = calls.enabled !== false;
	calls.ringSeconds = ClampInteger(calls.ringSeconds, 5, 120, fallback.calls.ringSeconds);
	calls.logSize = ClampInteger(calls.logSize, 10, 500, fallback.calls.logSize);
	calls.rateLimitCount = ClampInteger(calls.rateLimitCount, 1, 100, fallback.calls.rateLimitCount);
	calls.rateLimitWindowMs = ClampInteger(calls.rateLimitWindowMs, 1000, 600000, fallback.calls.rateLimitWindowMs);
	calls.voiceEnabled = calls.voiceEnabled !== false;
	calls.voiceBitrate = ClampInteger(calls.voiceBitrate, 8000, 64000, fallback.calls.voiceBitrate);
	calls.ringtones = CleanSoundList(calls.ringtones, fallback.calls.ringtones);
	calls.defaultRingtone = calls.ringtones.some((ringtone) => ringtone.id === calls.defaultRingtone) ? calls.defaultRingtone : calls.ringtones[0].id;

	const notifications = config.notifications;
	notifications.toastDurationMs = ClampInteger(notifications.toastDurationMs, 500, 30000, fallback.notifications.toastDurationMs);
	notifications.bannerDurationMs = ClampInteger(notifications.bannerDurationMs, 500, 30000, fallback.notifications.bannerDurationMs);
	notifications.soundMode = soundModes.includes(notifications.soundMode) ? notifications.soundMode : fallback.notifications.soundMode;
	notifications.wwiseEvent = String(notifications.wwiseEvent || "").trim();

	notifications.sounds = CleanSoundList(notifications.sounds, fallback.notifications.sounds);
	notifications.defaultSound = notifications.sounds.some((sound) => sound.id === notifications.defaultSound) ? notifications.defaultSound : notifications.sounds[0].id;
	notifications.quietActivities = Array.isArray(notifications.quietActivities) ? [...new Set(notifications.quietActivities.map((id) => String(id).trim()).filter((id) => id.length > 0 && id.length <= 64))].slice(0, 32) : [];
	delete notifications.soundFile;

	const storage = config.storage;
	storage.disableSoftDelete = storage.disableSoftDelete === true;
	storage.messageRetentionDays = ClampInteger(storage.messageRetentionDays, 0, 36500, fallback.storage.messageRetentionDays);

	const flight = config.flight;
	flight.enabled = flight.enabled === true;
	flight.minSeconds = ClampNumber(flight.minSeconds, 0, 600, fallback.flight.minSeconds);
	flight.maxSeconds = ClampNumber(flight.maxSeconds, flight.minSeconds, 3600, Math.max(flight.minSeconds, fallback.flight.maxSeconds));
	flight.secondsPerHundredMetres = ClampNumber(flight.secondsPerHundredMetres, 0, 600, fallback.flight.secondsPerHundredMetres);
	flight.groupSeconds = ClampNumber(flight.groupSeconds, 0, 3600, fallback.flight.groupSeconds);

	const announcements = config.announcements;
	announcements.enabled = announcements.enabled !== false;
	announcements.command = String(announcements.command || fallback.announcements.command).trim().replace(/^\//, "").toLowerCase() || fallback.announcements.command;
	announcements.senderName = String(announcements.senderName || fallback.announcements.senderName).trim().slice(0, 64) || fallback.announcements.senderName;
	announcements.avatarUrl = String(announcements.avatarUrl || "").trim();
	announcements.capability = String(announcements.capability ?? fallback.announcements.capability).trim();
	announcements.fallbackGroup = String(announcements.fallbackGroup ?? fallback.announcements.fallbackGroup).trim();
	announcements.fallbackMinimumGrade = ClampInteger(announcements.fallbackMinimumGrade, 0, 1000000, fallback.announcements.fallbackMinimumGrade);
	announcements.maxLength = ClampInteger(announcements.maxLength, 1, 4000, fallback.announcements.maxLength);

	const logging = config.logging;
	logging.enabled = logging.enabled === true;
	logging.destination = String(logging.destination || "").trim();
	logging.url = String(logging.url || "").trim();
	logging.urlEnv = String(logging.urlEnv || fallback.logging.urlEnv).trim();
	logging.username = String(logging.username || fallback.logging.username).trim().slice(0, 80) || fallback.logging.username;
	logging.includeBodies = logging.includeBodies === true;
	logging.flushIntervalMs = ClampInteger(logging.flushIntervalMs, 1000, 600000, fallback.logging.flushIntervalMs);
	logging.events = logging.events && typeof logging.events === "object" ? logging.events : {};

	for (const [category, enabled] of Object.entries(fallback.logging.events))
	{
		logging.events[category] = typeof logging.events[category] === "boolean" ? logging.events[category] : enabled;
	}

	const network = config.network;
	network.flushIntervalMs = ClampInteger(network.flushIntervalMs, 0, 1000, fallback.network.flushIntervalMs);
	network.nearbyRefreshMs = ClampInteger(network.nearbyRefreshMs, 250, 10000, fallback.network.nearbyRefreshMs);
	network.requestTimeoutMs = ClampInteger(network.requestTimeoutMs, 1000, 60000, fallback.network.requestTimeoutMs);
	network.requestRateLimitCount = ClampInteger(network.requestRateLimitCount, 1, 1000, fallback.network.requestRateLimitCount);
	network.requestRateLimitWindowMs = ClampInteger(network.requestRateLimitWindowMs, 100, 600000, fallback.network.requestRateLimitWindowMs);
	network.maxBatchBytes = ClampInteger(network.maxBatchBytes, 4096, 60000, fallback.network.maxBatchBytes);

	const ui = config.ui;
	ui.scale = ClampNumber(ui.scale, 0.5, 3, fallback.ui.scale);
	ui.widthPx = ClampInteger(ui.widthPx, 280, 600, fallback.ui.widthPx);
	ui.heightPx = ClampInteger(ui.heightPx, 480, 1000, fallback.ui.heightPx);
	ui.rightMarginPx = ClampInteger(ui.rightMarginPx, 0, 400, fallback.ui.rightMarginPx);
	ui.defaultTheme = NormaliseTheme(ui.defaultTheme) || fallback.ui.defaultTheme;
	ui.defaultLanguage = String(ui.defaultLanguage || fallback.ui.defaultLanguage).trim();
	ui.allowMove = ui.allowMove === true;

	return config;
}

// ========================
// Loading
// ========================

/// <summary>
/// Load data/frantic-owls.json (relative to the server working directory) over the defaults.
/// A missing or unreadable file is not fatal; the defaults are used and the problem is logged.
/// </summary>
/// <param name="hmp">hmp-lib server import</param>
/// <returns>Sanitised configuration object</returns>
function LoadConfig(hmp)
{
	const defaults = JSON.parse(JSON.stringify(defaultConfig));
	let config = defaults;

	// hmp-lib throws on malformed JSON, so this is one of the few places that has to catch.
	try
	{
		const loaded = hmp.config.load(process.env.FRANTIC_OWLS_CONFIG || configPath, { cwd: process.cwd(), required: false });
		config = hmp.config.merge(defaults, loaded);
	}
	catch (error)
	{
		Logger.LogError("Config", `Could not read ${configPath}, using defaults: ${Logger.Describe(error)}`);
		config = defaults;
	}

	return Sanitise(config);
}

/// <summary>
/// Pick the settings a client needs to draw the phone. Nothing here is secret, but it is kept minimal.
/// </summary>
/// <param name="config">Loaded server configuration</param>
/// <param name="languages">Languages players can pick: [{ id, name }]</param>
/// <returns>Plain object safe to send to clients</returns>
function GetClientConfig(config, languages)
{
	return {
		languages: languages.map((language) => ({ ...language })),
		quietActivities: config.notifications.quietActivities.length > 0,
		command: config.command,
		openKey: config.openKey,
		numbersVisible: config.numbers.visible,
		maxNameLength: config.contacts.maxNameLength,
		maxAvatarUrlLength: config.avatars.maxUrlLength,
		maxMessageLength: config.messages.maxLength,
		maxGroupMembers: config.groups.maxMembers,
		maxGroupTitleLength: config.groups.maxTitleLength,
		informCooldownSeconds: config.inform.cooldownSeconds,
		informConsent: config.inform.requireConsent,
		locationsEnabled: config.locations.enabled,
		callsEnabled: config.calls.enabled,
		callRingSeconds: config.calls.ringSeconds,
		voiceEnabled: config.calls.voiceEnabled,
		voiceBitrate: config.calls.voiceBitrate,
		ringtones: config.calls.ringtones.map((ringtone) => ({ ...ringtone })),
		defaultRingtone: config.calls.defaultRingtone,
		flightEnabled: config.flight.enabled,
		toastDurationMs: config.notifications.toastDurationMs,
		bannerDurationMs: config.notifications.bannerDurationMs,
		soundMode: config.notifications.soundMode,
		sounds: config.notifications.sounds.map((sound) => ({ ...sound })),
		defaultSound: config.notifications.defaultSound,
		readReceipts: config.privacy.readReceipts,
		typingIndicators: config.privacy.typingIndicators,
		unsendSeconds: config.messages.unsendSeconds,
		maxPinnedChats: config.messages.maxPinnedChats,
		wwiseEvent: config.notifications.wwiseEvent,
		nearbyRefreshMs: config.network.nearbyRefreshMs,
		requestTimeoutMs: config.network.requestTimeoutMs,
		ui: { ...config.ui },
	};
}

module.exports = { LoadConfig, GetClientConfig, ClampInteger, ClampNumber, NormaliseTheme };
