// FranticDreamer 2026
"use strict";

const { Logger } = require("./Logger.js");

// ========================
// Defaults
// ========================

/// <summary>
/// Every server setting with its default value.
/// data/frantic-owls.json is merged over this, so a server only needs to list what it changes.
///
/// <para>
/// NOTE: mode picks the front end players get: "phone" (the /owl pseudo-smartphone) or "immersive" (letters written on parchment, read at a desk in the middle of the screen).
/// Settings only one of them uses carry its prefix (phonemode_ or immersivemode_); everything unprefixed is shared.
/// Both front ends keep their owls in the same tables, so a server can switch mode and every owl, contact and setting carries over.
/// </para>
///
/// </summary>
const defaultConfig = Object.freeze
({
	mode: "phone",
	command: "owl",
	openKey: "up",
	defaultLanguage: "en-GB",
	backfillNumbers: true,
	contacts:
	{
		maxContacts: 250,
		maxNameLength: 40,
	},
	messages:
	{
		pageSize: 40,
		maxChatsListed: 100,
		rateLimitCount: 8,
		rateLimitWindowMs: 5000,
	},
	notifications:
	{
		toastDurationMs: 3000,
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
	attachments:
	{
		galleons: true,
		galleonsItem: "native:galleons",
		maxGalleons: 10000,
		postageGalleons: 0,
		dailyGalleonsCap: 0,
		returnAfterDays: 7,
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
			parcels: true,
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
	avatars:
	{
		maxUrlLength: 512,
		allowedHosts: [],
		allowInsecure: false,
	},
	phonemode_numbers:
	{
		visible: false,
		dialling: false,
		rateLimitCount: 10,
		rateLimitWindowMs: 60000,
	},
	phonemode_messages:
	{
		maxLength: 500,
		unsendSeconds: 120,
		maxPinnedChats: 5,
		maxForwardTargets: 5,
	},
	phonemode_polls:
	{
		enabled: true,
		maxOptions: 10,
		maxQuestionLength: 200,
		maxOptionLength: 100,
	},
	phonemode_privacy:
	{
		readReceipts: true,
		typingIndicators: true,
	},
	phonemode_groups:
	{
		maxMembers: 12,
		maxTitleLength: 40,
	},
	phonemode_inform:
	{
		rangeMetres: 5,
		rangeToleranceMetres: 2,
		cooldownSeconds: 30,
		revealNames: true,
		requireConsent: true,
		allowExchange: true,
		requestSeconds: 60,
	},
	phonemode_locations:
	{
		enabled: true,
		markerSeconds: 0,
		arrivalMetres: 10,
	},
	phonemode_calls:
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
	phonemode_effects:
	{
		enabled: true,
		muggle:
		{
			keyTap: "Sounds/Phone/KeyTap.wav",
			keyEraseTap: "Sounds/Phone/KeyEraseTap.wav",
			appTap: "Sounds/Phone/AppTap.wav",
			lock: "Sounds/Phone/Lock.wav",
			unlock: "Sounds/Phone/Unlock.wav",
			messageSent: "Sounds/Phone/MessageSent.wav",
			messageReceived: "Sounds/Phone/MessageReceived.wav",
		},
		parchment:
		{
			keyTap: "Sounds/Parchment/KeyTap.wav",
			keyEraseTap: "Sounds/Parchment/KeyEraseTap.wav",
			appTap: "Sounds/Parchment/AppTap.wav",
			lock: "Sounds/Parchment/Lock.wav",
			unlock: "Sounds/Parchment/Unlock.wav",
			messageSent: "Sounds/Parchment/MessageSent.wav",
			messageReceived: "Sounds/Parchment/MessageReceived.wav",
		},
	},
	phonemode_ui:
	{
		scale: 1.0,
		widthPx: 360,
		heightPx: 700,
		rightMarginPx: 32,
		defaultTheme: "muggle",
		allowMove: false,
		lockScreen: true,
		bannerDurationMs: 4000,
	},
	immersivemode_readmode: "free",
	immersivemode_writemode: "free",
	immersivemode_letters:
	{
		maxLength: 4000,
		maxLines: 150,
		maxRecipients: 8,
	},
	immersivemode_posts: [],
	immersivemode_postadmin:
	{
		capability: "admin.view",
		fallbackGroup: "admin",
		fallbackMinimumGrade: 1,
	},
	immersivemode_avatars: false,
	immersivemode_ui:
	{
		scale: 1.0,
	},
});

const configPath = "data/frantic-owls.json";
const soundModes = ["file", "wwise", "none"];

/// <summary>
/// Front ends a server can run.
/// </summary>
const modes = Object.freeze(["phone", "immersive"]);

/// <summary>
/// Where immersive mode lets letters be read and written.
/// "free" is anywhere; "postonly" only at an owl post; "postonly_freeunread" (reading only) is unread letters anywhere and the rest only at an owl post.
/// </summary>
const readModes = Object.freeze(["free", "postonly", "postonly_freeunread"]);
const writeModes = Object.freeze(["free", "postonly"]);

/// <summary>
/// Most owl posts a server can list, and the shape of a post's ID.
/// </summary>
const maxPosts = 64;

/// <summary>
/// Most characters an official letter can be addressed to by name. Anything wider goes to everyone as an announcement.
/// </summary>
const maxOfficialRecipients = 50;
const postIdPattern = /^[a-z0-9_-]{1,32}$/;

/// <summary>
/// Most notification sounds a server can offer, and the shape of a sound's ID.
/// </summary>
const maxSounds = 16;
const soundIdPattern = /^[a-z0-9_-]{1,24}$/;

/// <summary>
/// The phone's sound effects, as named in the "phonemode_effects" section and by Owls.Effects in the page.
/// </summary>
const effectNames = Object.freeze(["keyTap", "keyEraseTap", "appTap", "lock", "unlock", "messageSent", "messageReceived"]);

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
/// Read the configured owl posts, dropping entries that are malformed or repeat an ID.
/// </summary>
/// <param name="list">Configured list: [{ id, label, position: { x, y, z }, areaId, regionId, radiusMetres, model, yaw }]</param>
/// <returns>Clean list, possibly empty</returns>
function CleanPosts(list)
{
	const posts = [];

	for (const raw of Array.isArray(list) ? list : [])
	{
		if (!raw || typeof raw !== "object")
		{
			continue;
		}

		const id = String(raw.id || "").trim().toLowerCase();
		const position = raw.position && typeof raw.position === "object" ? raw.position : {};
		const point = { x: Number(position.x), y: Number(position.y), z: Number(position.z) };

		if (posts.length >= maxPosts || !postIdPattern.test(id) || ![point.x, point.y, point.z].every(Number.isFinite) || posts.some((post) => post.id === id))
		{
			Logger.LogWarning("Config", `Skipped an owl post in immersivemode_posts (${id || "no id"}): it needs a unique id (a-z, 0-9, _ or -) and a position with x, y and z.`);
			continue;
		}

		posts.push
		({
			id,
			label: String(raw.label || id).trim().slice(0, 64) || id,
			position: point,
			areaId: String(raw.areaId || "").trim(),
			regionId: String(raw.regionId || "").trim(),
			radiusMetres: ClampNumber(raw.radiusMetres, 0.5, 50, 3),
			model: String(raw.model || "").trim().slice(0, 256),
			yaw: ClampNumber(raw.yaw, -360, 360, 0),
		});
	}

	return posts;
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
/// Read one of a fixed set of words, falling back when it is anything else.
/// </summary>
/// <param name="value">Raw configured value</param>
/// <param name="allowed">Accepted values</param>
/// <param name="fallback">Value used when the setting is unusable</param>
/// <returns>One of allowed</returns>
function ClampChoice(value, allowed, fallback)
{
	const choice = String(value || "").trim().toLowerCase();
	return allowed.includes(choice) ? choice : fallback;
}

/// <summary>
/// Clamp every loaded setting into a range the rest of the resource can rely on.
/// </summary>
/// <param name="config">Merged configuration, modified in place</param>
/// <returns>The same configuration object</returns>
function Sanitise(config)
{
	const fallback = defaultConfig;

	// A section written as something other than an object (e.g. "phonemode_inform": null) would break every read below.
	for (const [section, value] of Object.entries(fallback))
	{
		if (value && typeof value === "object" && !Array.isArray(value) && (!config[section] || typeof config[section] !== "object" || Array.isArray(config[section])))
		{
			config[section] = JSON.parse(JSON.stringify(value));
		}
	}

	config.mode = ClampChoice(config.mode, modes, fallback.mode);
	config.command = String(config.command || fallback.command).trim().replace(/^\//, "").toLowerCase() || fallback.command;
	config.openKey = String(config.openKey || "").trim().toLowerCase();
	config.defaultLanguage = String(config.defaultLanguage || fallback.defaultLanguage).trim();
	config.backfillNumbers = config.backfillNumbers !== false;

	// The crest is worded by the language files now; an old config's branding section is simply ignored.
	delete config.branding;

	const contacts = config.contacts;
	contacts.maxContacts = ClampInteger(contacts.maxContacts, 1, 5000, fallback.contacts.maxContacts);
	contacts.maxNameLength = ClampInteger(contacts.maxNameLength, 2, 64, fallback.contacts.maxNameLength);

	const messages = config.messages;
	messages.pageSize = ClampInteger(messages.pageSize, 5, 200, fallback.messages.pageSize);
	messages.maxChatsListed = ClampInteger(messages.maxChatsListed, 10, 1000, fallback.messages.maxChatsListed);
	messages.rateLimitCount = ClampInteger(messages.rateLimitCount, 1, 1000, fallback.messages.rateLimitCount);
	messages.rateLimitWindowMs = ClampInteger(messages.rateLimitWindowMs, 100, 600000, fallback.messages.rateLimitWindowMs);

	const notifications = config.notifications;
	notifications.toastDurationMs = ClampInteger(notifications.toastDurationMs, 500, 30000, fallback.notifications.toastDurationMs);
	notifications.soundMode = soundModes.includes(notifications.soundMode) ? notifications.soundMode : fallback.notifications.soundMode;
	notifications.wwiseEvent = String(notifications.wwiseEvent || "").trim();
	notifications.sounds = CleanSoundList(notifications.sounds, fallback.notifications.sounds);
	notifications.defaultSound = notifications.sounds.some((sound) => sound.id === notifications.defaultSound) ? notifications.defaultSound : notifications.sounds[0].id;
	notifications.quietActivities = Array.isArray(notifications.quietActivities) ? [...new Set(notifications.quietActivities.map((id) => String(id).trim()).filter((id) => id.length > 0 && id.length <= 64))].slice(0, 32) : [];

	const storage = config.storage;
	storage.disableSoftDelete = storage.disableSoftDelete === true;
	storage.messageRetentionDays = ClampInteger(storage.messageRetentionDays, 0, 36500, fallback.storage.messageRetentionDays);

	const flight = config.flight;
	flight.enabled = flight.enabled === true;
	flight.minSeconds = ClampNumber(flight.minSeconds, 0, 600, fallback.flight.minSeconds);
	flight.maxSeconds = ClampNumber(flight.maxSeconds, flight.minSeconds, 3600, Math.max(flight.minSeconds, fallback.flight.maxSeconds));
	flight.secondsPerHundredMetres = ClampNumber(flight.secondsPerHundredMetres, 0, 600, fallback.flight.secondsPerHundredMetres);
	flight.groupSeconds = ClampNumber(flight.groupSeconds, 0, 3600, fallback.flight.groupSeconds);

	// Parcels need hmp-inventory too; without it they stay off whatever this says (see Parcels.js).
	const attachments = config.attachments;
	attachments.galleons = attachments.galleons !== false;
	attachments.galleonsItem = String(attachments.galleonsItem || fallback.attachments.galleonsItem).trim() || fallback.attachments.galleonsItem;
	attachments.maxGalleons = ClampInteger(attachments.maxGalleons, 1, 1000000000, fallback.attachments.maxGalleons);
	attachments.postageGalleons = ClampInteger(attachments.postageGalleons, 0, 1000000, fallback.attachments.postageGalleons);
	attachments.dailyGalleonsCap = ClampInteger(attachments.dailyGalleonsCap, 0, 1000000000, fallback.attachments.dailyGalleonsCap);
	attachments.returnAfterDays = ClampInteger(attachments.returnAfterDays, 1, 365, fallback.attachments.returnAfterDays);

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

	// Picture links follow the same rules in both front ends: the phone's profile pictures, overrides and wallpapers, and immersive mode's correspondents (immersivemode_avatars).
	const avatars = config.avatars;
	avatars.maxUrlLength = ClampInteger(avatars.maxUrlLength, 32, 2048, fallback.avatars.maxUrlLength);
	avatars.allowedHosts = Array.isArray(avatars.allowedHosts) ? avatars.allowedHosts.map((host) => String(host).trim().toLowerCase()).filter((host) => host.length > 0) : [];
	avatars.allowInsecure = avatars.allowInsecure === true;

	const network = config.network;
	network.flushIntervalMs = ClampInteger(network.flushIntervalMs, 0, 1000, fallback.network.flushIntervalMs);
	network.nearbyRefreshMs = ClampInteger(network.nearbyRefreshMs, 250, 10000, fallback.network.nearbyRefreshMs);
	network.requestTimeoutMs = ClampInteger(network.requestTimeoutMs, 1000, 60000, fallback.network.requestTimeoutMs);
	network.requestRateLimitCount = ClampInteger(network.requestRateLimitCount, 1, 1000, fallback.network.requestRateLimitCount);
	network.requestRateLimitWindowMs = ClampInteger(network.requestRateLimitWindowMs, 100, 600000, fallback.network.requestRateLimitWindowMs);
	network.maxBatchBytes = ClampInteger(network.maxBatchBytes, 4096, 60000, fallback.network.maxBatchBytes);

	SanitisePhoneMode(config, fallback);
	SanitiseImmersiveMode(config, fallback);
	return config;
}

/// <summary>
/// Clamp the settings only the phone uses (every phonemode_ section).
/// </summary>
/// <param name="config">Merged configuration, modified in place</param>
/// <param name="fallback">Default configuration</param>
function SanitisePhoneMode(config, fallback)
{
	const numbers = config.phonemode_numbers;
	numbers.visible = numbers.visible === true;
	numbers.dialling = numbers.dialling === true;
	numbers.rateLimitCount = ClampInteger(numbers.rateLimitCount, 1, 1000, fallback.phonemode_numbers.rateLimitCount);
	numbers.rateLimitWindowMs = ClampInteger(numbers.rateLimitWindowMs, 1000, 3600000, fallback.phonemode_numbers.rateLimitWindowMs);

	const messages = config.phonemode_messages;
	messages.maxLength = ClampInteger(messages.maxLength, 1, 4000, fallback.phonemode_messages.maxLength);
	messages.unsendSeconds = ClampInteger(messages.unsendSeconds, 0, 86400, fallback.phonemode_messages.unsendSeconds);
	messages.maxPinnedChats = ClampInteger(messages.maxPinnedChats, 0, 50, fallback.phonemode_messages.maxPinnedChats);
	messages.maxForwardTargets = ClampInteger(messages.maxForwardTargets, 0, 20, fallback.phonemode_messages.maxForwardTargets);

	const polls = config.phonemode_polls;
	polls.enabled = polls.enabled !== false;
	polls.maxOptions = ClampInteger(polls.maxOptions, 2, 12, fallback.phonemode_polls.maxOptions);
	polls.maxQuestionLength = ClampInteger(polls.maxQuestionLength, 10, 300, fallback.phonemode_polls.maxQuestionLength);
	polls.maxOptionLength = ClampInteger(polls.maxOptionLength, 10, 150, fallback.phonemode_polls.maxOptionLength);

	const privacy = config.phonemode_privacy;
	privacy.readReceipts = privacy.readReceipts !== false;
	privacy.typingIndicators = privacy.typingIndicators !== false;

	const groups = config.phonemode_groups;
	groups.maxMembers = ClampInteger(groups.maxMembers, 3, 64, fallback.phonemode_groups.maxMembers);
	groups.maxTitleLength = ClampInteger(groups.maxTitleLength, 2, 64, fallback.phonemode_groups.maxTitleLength);

	const inform = config.phonemode_inform;
	inform.rangeMetres = ClampNumber(inform.rangeMetres, 0.5, 100, fallback.phonemode_inform.rangeMetres);
	inform.rangeToleranceMetres = ClampNumber(inform.rangeToleranceMetres, 0, 50, fallback.phonemode_inform.rangeToleranceMetres);
	inform.cooldownSeconds = ClampNumber(inform.cooldownSeconds, 0, 86400, fallback.phonemode_inform.cooldownSeconds);
	inform.revealNames = inform.revealNames !== false;
	inform.requireConsent = inform.requireConsent !== false;
	inform.allowExchange = inform.allowExchange !== false;
	inform.requestSeconds = ClampInteger(inform.requestSeconds, 10, 3600, fallback.phonemode_inform.requestSeconds);

	const locations = config.phonemode_locations;
	locations.enabled = locations.enabled !== false;
	// 0 keeps a shown location until the reader reaches it or hides it; any other value is a time limit of at least 30 seconds.
	const markerSeconds = ClampInteger(locations.markerSeconds, 0, 86400, fallback.phonemode_locations.markerSeconds);
	locations.markerSeconds = markerSeconds > 0 ? Math.max(30, markerSeconds) : 0;
	locations.arrivalMetres = ClampNumber(locations.arrivalMetres, 1, 100, fallback.phonemode_locations.arrivalMetres);

	const calls = config.phonemode_calls;
	calls.enabled = calls.enabled !== false;
	calls.ringSeconds = ClampInteger(calls.ringSeconds, 5, 120, fallback.phonemode_calls.ringSeconds);
	calls.logSize = ClampInteger(calls.logSize, 10, 500, fallback.phonemode_calls.logSize);
	calls.rateLimitCount = ClampInteger(calls.rateLimitCount, 1, 100, fallback.phonemode_calls.rateLimitCount);
	calls.rateLimitWindowMs = ClampInteger(calls.rateLimitWindowMs, 1000, 600000, fallback.phonemode_calls.rateLimitWindowMs);
	calls.voiceEnabled = calls.voiceEnabled !== false;
	calls.voiceBitrate = ClampInteger(calls.voiceBitrate, 8000, 64000, fallback.phonemode_calls.voiceBitrate);
	calls.ringtones = CleanSoundList(calls.ringtones, fallback.phonemode_calls.ringtones);
	calls.defaultRingtone = calls.ringtones.some((ringtone) => ringtone.id === calls.defaultRingtone) ? calls.defaultRingtone : calls.ringtones[0].id;

	// Each theme has its own set: a Muggle Phone clicks like a phone, a sheet of parchment should not.
	// Each effect is a file inside UI/ like the notification sounds; "" (or a path that is not acceptable) turns that one effect off.
	const effects = config.phonemode_effects;
	effects.enabled = effects.enabled !== false;

	for (const theme of themes)
	{
		const set = effects[theme] && typeof effects[theme] === "object" && !Array.isArray(effects[theme]) ? effects[theme] : JSON.parse(JSON.stringify(fallback.phonemode_effects[theme]));
		effects[theme] = Object.fromEntries(effectNames.map((name) => [name, CleanSoundFile(set[name] ?? fallback.phonemode_effects[theme][name])]));
	}

	const ui = config.phonemode_ui;
	ui.scale = ClampNumber(ui.scale, 0.5, 3, fallback.phonemode_ui.scale);
	ui.widthPx = ClampInteger(ui.widthPx, 280, 600, fallback.phonemode_ui.widthPx);
	ui.heightPx = ClampInteger(ui.heightPx, 480, 1000, fallback.phonemode_ui.heightPx);
	ui.rightMarginPx = ClampInteger(ui.rightMarginPx, 0, 400, fallback.phonemode_ui.rightMarginPx);
	ui.defaultTheme = NormaliseTheme(ui.defaultTheme) || fallback.phonemode_ui.defaultTheme;
	ui.allowMove = ui.allowMove === true;
	ui.lockScreen = ui.lockScreen !== false;
	ui.bannerDurationMs = ClampInteger(ui.bannerDurationMs, 500, 30000, fallback.phonemode_ui.bannerDurationMs);
}

/// <summary>
/// Clamp the settings only immersive mode uses (every immersivemode_ key).
/// </summary>
/// <param name="config">Merged configuration, modified in place</param>
/// <param name="fallback">Default configuration</param>
function SanitiseImmersiveMode(config, fallback)
{
	config.immersivemode_readmode = ClampChoice(config.immersivemode_readmode, readModes, fallback.immersivemode_readmode);
	config.immersivemode_writemode = ClampChoice(config.immersivemode_writemode, writeModes, fallback.immersivemode_writemode);

	// A letter is kept whole, spaces and blank lines included, so it is bounded by characters and by lines rather than squeezed like a phone owl.
	const letters = config.immersivemode_letters;
	letters.maxLength = ClampInteger(letters.maxLength, 100, 20000, fallback.immersivemode_letters.maxLength);
	letters.maxLines = ClampInteger(letters.maxLines, 10, 1000, fallback.immersivemode_letters.maxLines);
	letters.maxRecipients = ClampInteger(letters.maxRecipients, 1, 50, fallback.immersivemode_letters.maxRecipients);

	config.immersivemode_posts = CleanPosts(config.immersivemode_posts);

	const postAdmin = config.immersivemode_postadmin;
	postAdmin.capability = String(postAdmin.capability ?? fallback.immersivemode_postadmin.capability).trim();
	postAdmin.fallbackGroup = String(postAdmin.fallbackGroup ?? fallback.immersivemode_postadmin.fallbackGroup).trim();
	postAdmin.fallbackMinimumGrade = ClampInteger(postAdmin.fallbackMinimumGrade, 0, 1000000, fallback.immersivemode_postadmin.fallbackMinimumGrade);

	config.immersivemode_avatars = config.immersivemode_avatars === true;

	const ui = config.immersivemode_ui;
	ui.scale = ClampNumber(ui.scale, 0.5, 2, fallback.immersivemode_ui.scale);

	if (config.mode === "immersive" && config.immersivemode_posts.length === 0 && (config.immersivemode_readmode !== "free" || config.immersivemode_writemode !== "free"))
	{
		Logger.LogWarning("Config", "Letters may only be read or written at an owl post, but immersivemode_posts lists none; players will not be able to reach them.");
	}
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
/// Read only the owl posts (immersivemode_posts) from data/frantic-owls.json again, for reloading them while the server runs.
///
/// <para>
/// NOTE: Nothing else in the file is reloaded, since most settings are handed to services once at start and changing them underneath would leave those services half on the old values.
/// A file that cannot be read gives null rather than an empty list, so a typo while editing does not take every post down.
/// </para>
///
/// </summary>
/// <param name="hmp">hmp-lib server import</param>
/// <returns>Clean list of posts, or null when the file cannot be read</returns>
function LoadPosts(hmp)
{
	// Same as LoadConfig: hmp-lib throws on malformed JSON.
	// hmp-lib keeps a file it loaded once in memory; fresh reads it from disk again, or the edit just made would never be seen.
	try
	{
		const loaded = hmp.config.load(process.env.FRANTIC_OWLS_CONFIG || configPath, { cwd: process.cwd(), required: false, fresh: true });
		return CleanPosts(loaded && typeof loaded === "object" ? loaded.immersivemode_posts : []);
	}
	catch (error)
	{
		Logger.LogError("Config", `Could not read ${configPath} to reload the owl posts: ${Logger.Describe(error)}`);
		return null;
	}
}

/// <summary>
/// Pick the settings a client needs to draw its front end. Nothing here is secret, but it is kept minimal.
/// </summary>
/// <param name="config">Loaded server configuration</param>
/// <param name="languages">Languages players can pick: [{ id, name }]</param>
/// <returns>Plain object safe to send to clients</returns>
function GetClientConfig(config, languages)
{
	const shared =
	{
		mode: config.mode,
		languages: languages.map((language) => ({ ...language })),
		quietActivities: config.notifications.quietActivities.length > 0,
		command: config.command,
		openKey: config.openKey,
		maxNameLength: config.contacts.maxNameLength,
		maxContacts: config.contacts.maxContacts,
		maxAvatarUrlLength: config.avatars.maxUrlLength,
		flightEnabled: config.flight.enabled,
		toastDurationMs: config.notifications.toastDurationMs,
		soundMode: config.notifications.soundMode,
		sounds: config.notifications.sounds.map((sound) => ({ ...sound })),
		defaultSound: config.notifications.defaultSound,
		wwiseEvent: config.notifications.wwiseEvent,
		requestTimeoutMs: config.network.requestTimeoutMs,
		// Whether parcels can carry Galleons is decided again once hmp-inventory is known to run (see Main.js).
		galleons: config.attachments.galleons ? { max: config.attachments.maxGalleons, postage: config.attachments.postageGalleons, returnAfterDays: config.attachments.returnAfterDays } : null,
	};

	if (config.mode === "immersive")
	{
		return {
			...shared,
			readMode: config.immersivemode_readmode,
			writeMode: config.immersivemode_writemode,
			maxLetterLength: config.immersivemode_letters.maxLength,
			maxLetterLines: config.immersivemode_letters.maxLines,
			maxRecipients: config.immersivemode_letters.maxRecipients,
			hasPosts: config.immersivemode_posts.length > 0,
			avatars: config.immersivemode_avatars,
			maxOfficialRecipients: maxOfficialRecipients,
			ui: { ...config.immersivemode_ui },
		};
	}

	return {
		...shared,
		// Dialling by number is useless unless players can read their own number to hand it out, so it shows numbers too.
		numbersVisible: config.phonemode_numbers.visible || config.phonemode_numbers.dialling,
		numbersDialling: config.phonemode_numbers.dialling,
		maxMessageLength: config.phonemode_messages.maxLength,
		maxGroupMembers: config.phonemode_groups.maxMembers,
		maxGroupTitleLength: config.phonemode_groups.maxTitleLength,
		informCooldownSeconds: config.phonemode_inform.cooldownSeconds,
		informConsent: config.phonemode_inform.requireConsent,
		locationsEnabled: config.phonemode_locations.enabled,
		callsEnabled: config.phonemode_calls.enabled,
		callRingSeconds: config.phonemode_calls.ringSeconds,
		voiceEnabled: config.phonemode_calls.voiceEnabled,
		voiceBitrate: config.phonemode_calls.voiceBitrate,
		ringtones: config.phonemode_calls.ringtones.map((ringtone) => ({ ...ringtone })),
		defaultRingtone: config.phonemode_calls.defaultRingtone,
		bannerDurationMs: config.phonemode_ui.bannerDurationMs,
		effects: config.phonemode_effects.enabled ? Object.fromEntries(themes.map((theme) => [theme, Object.fromEntries(effectNames.filter((name) => config.phonemode_effects[theme][name]).map((name) => [name, config.phonemode_effects[theme][name]]))])) : {},
		readReceipts: config.phonemode_privacy.readReceipts,
		typingIndicators: config.phonemode_privacy.typingIndicators,
		unsendSeconds: config.phonemode_messages.unsendSeconds,
		maxPinnedChats: config.phonemode_messages.maxPinnedChats,
		maxForwardTargets: config.phonemode_messages.maxForwardTargets,
		pollsEnabled: config.phonemode_polls.enabled,
		pollMaxOptions: config.phonemode_polls.maxOptions,
		pollMaxQuestionLength: config.phonemode_polls.maxQuestionLength,
		pollMaxOptionLength: config.phonemode_polls.maxOptionLength,
		nearbyRefreshMs: config.network.nearbyRefreshMs,
		ui: { ...config.phonemode_ui },
	};
}

module.exports = { LoadConfig, LoadPosts, GetClientConfig, ClampInteger, ClampNumber, NormaliseTheme, maxOfficialRecipients, postIdPattern };
