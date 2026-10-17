// FranticDreamer 2026
"use strict";

// ========================
// Development Mock
// ========================

/// <summary>
/// Stand-in for the client script and server, so the phone page can be previewed in a normal browser.
/// Defines window.callEvent the way the game's browser does and answers requests from in-memory data.
///
/// <para>
/// NOTE: Lives outside UI/ on purpose: the manifest only ships UI/**, so this never reaches players.
/// Open Dev/Preview.html in any browser to use it.
/// </para>
///
/// </summary>
(() =>
{
	const me = { number: "12345678", name: "Harriet Pemberton", avatarUrl: "" };
	const sampleAvatar = "data:image/svg+xml," + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'><rect width='40' height='40' fill='#6b8f71'/><circle cx='20' cy='16' r='7' fill='#e9dcb6'/><rect x='9' y='26' width='22' height='12' rx='6' fill='#e9dcb6'/></svg>");
	const now = Date.now();
	const minute = 60000;

	const contacts =
	[
		{ id: 1, number: "20000001", name: "Ambrose Swott", avatarUrl: "", updatedAt: now },
		{ id: 2, number: "20000002", name: "Natsai Onai", avatarUrl: "", profileAvatarUrl: sampleAvatar, favourite: true, updatedAt: now },
		{ id: 3, number: "20000003", name: "Sebastian Sallow", avatarUrl: "", updatedAt: now },
		{ id: 4, number: "20000004", name: "Poppy Sweeting", avatarUrl: "", updatedAt: now },
		{ id: 5, number: "20000005", name: "Everett Clopton", avatarUrl: "", updatedAt: now },
	];

	const messages =
	[
		{ id: 1, chatId: 1, sender: "20000002", body: "Are you coming to the Three Broomsticks tonight?", sentAt: now - 26 * 60 * minute },
		{ id: 2, chatId: 1, sender: me.number, body: "Only if Sirona saves us a table.", sentAt: now - 25 * 60 * minute },
		{ id: 3, chatId: 1, sender: "20000002", body: "She always does. 8 o'clock!", sentAt: now - 12 * minute },
		{ id: 10, chatId: 1, sender: "20000002", kind: "location", body: JSON.stringify({ x: 12000, y: -3400, z: 250, areaId: "Overland", regionId: "Hogsmeade", world: 0, place: "Hogsmeade" }), sentAt: now - 10 * minute },
		{ id: 4, chatId: 2, sender: "20000003", body: "Meet me at the Undercroft.", sentAt: now - 90 * minute },
		{ id: 5, chatId: 3, sender: "20000004", body: "Who fed the Puffskein?", sentAt: now - 5 * minute },
		{ id: 6, chatId: 3, sender: "20000001", body: "Not me. Probably Everett.", sentAt: now - 4 * minute, replyTo: { id: 5, sender: "20000004", kind: "text", body: "Who fed the Puffskein?", unsent: false } },
		{ id: 11, chatId: 3, sender: me.number, body: "It was me. Sorry.", sentAt: now - 3 * minute },
		{ id: 7, chatId: 4, sender: "30000009", body: "Psst. I hear you sell Wiggenweld?", sentAt: now - 3 * 24 * 60 * minute },
		{ id: 8, chatId: 5, sender: "00000001", body: "The Floo Network will be closed for maintenance tonight. Travel by broom.", sentAt: now - 30 * minute },
		{ id: 9, chatId: 6, sender: "00000002", body: "Your vault statement: 1,204 Galleons, 7 Sickles.", sentAt: now - 2 * 60 * minute },
	];

	const chats =
	[
		{ id: 1, kind: "direct", title: "", members: [me.number, "20000002"], createdAt: now - 2 * 24 * 60 * minute },
		{ id: 2, kind: "direct", title: "", members: [me.number, "20000003"], createdAt: now - 2 * 24 * 60 * minute },
		{ id: 3, kind: "group", title: "Beast Club", createdBy: me.number, members: [me.number, "20000001", "20000004", "20000005"], admins: [me.number], avatarUrl: "", createdAt: now - 24 * 60 * minute, pinnedMessage: { id: 5, sender: "20000004", kind: "text", body: "Who fed the Puffskein?", unsent: false, sentAt: now - 5 * minute } },
		{ id: 4, kind: "direct", title: "", members: [me.number, "30000009"], createdAt: now - 4 * 24 * 60 * minute },
		{ id: 5, kind: "channel", title: "Ministry of Magic", createdBy: "00000001", members: [], createdAt: now - 5 * 24 * 60 * minute },
		{ id: 6, kind: "direct", title: "", createdBy: "00000002", members: ["00000002", me.number], createdAt: now - 5 * 24 * 60 * minute },
	];

	const senders =
	[
		{ number: "00000001", name: "Ministry of Magic", avatarUrl: "", acceptsReplies: false },
		{ number: "00000002", name: "Gringotts Wizarding Bank", avatarUrl: "", acceptsReplies: false },
	];

	const blocks = new Set();
	const retired = new Set();
	const mutes = new Map();

	/// <summary>
	/// The language files the preview offers, read from ../Lang over HTTP the first time the page says it is ready.
	/// </summary>
	const languageFiles = ["en-GB", "tr"];
	const languages = new Map();
	const pins = new Map([[1, now]]);
	const hidden = new Set();

	/// <summary>
	/// How far the other members have read each chat, as the server would report it.
	/// </summary>
	const reads = new Map([[1, new Map([["20000002", 2]])], [3, new Map([["20000001", 11], ["20000004", 11], ["20000005", 6]])]]);

	/// <summary>
	/// Informs waiting for this owl's answer, as the server keeps them.
	/// </summary>
	let informRequests = [];

	/// <summary>
	/// Flight time the mock gives every owl you send, so "In flight" can be seen.
	/// </summary>
	const mockFlightMs = 5000;

	/// <summary>
	/// The location owl the mock has "on the map" ({ chatId, messageId }), or null.
	/// </summary>
	let shownLocation = null;

	/// <summary>
	/// The call log as the server keeps it, newest first, from this owl's side.
	/// </summary>
	let callLog =
	[
		{ id: 3, number: "20000002", direction: "out", outcome: "answered", startedAt: now - 40 * minute, answeredAt: now - 40 * minute + 4000, endedAt: now - 37 * minute, isNew: false },
		{ id: 2, number: "20000003", direction: "in", outcome: "missed", startedAt: now - 3 * 60 * minute, answeredAt: 0, endedAt: now - 3 * 60 * minute + 30000, isNew: true },
		{ id: 1, number: "30000009", direction: "in", outcome: "declined", startedAt: now - 2 * 24 * 60 * minute, answeredAt: 0, endedAt: now - 2 * 24 * 60 * minute + 5000, isNew: false },
	];

	/// <summary>
	/// The call in progress ({ id, number, direction, state, startedAt, answeredAt, expiresAt }), and its timers.
	/// Calling Natsai is answered after a moment, Sebastian is busy and Poppy unreachable; anyone else rings out.
	/// </summary>
	let call = null;
	let callTimers = [];
	let nextCallId = 1;
	let nextCallLogId = 10;

	/// <summary>
	/// How late your own voice comes back as the other owl's, and how many voice messages the page has sent (OwlsDev.VoiceStats).
	/// </summary>
	const voiceEchoMs = 250;
	let voiceMessagesSent = 0;

	/// <summary>
	/// End the call in progress the way the server does: write it to the log and tell the page.
	/// </summary>
	/// <param name="outcome">How it ended</param>
	/// <param name="endedBy">Who ended it, or ""</param>
	function EndCall(outcome, endedBy)
	{
		if (!call)
		{
			return;
		}

		const ended = call;
		call = null;
		callTimers.forEach(clearTimeout);
		callTimers = [];

		const isMissed = ended.direction === "in" && outcome !== "answered" && outcome !== "declined";
		const entry = { id: nextCallLogId++, number: ended.number, direction: ended.direction, outcome, startedAt: ended.startedAt, answeredAt: ended.answeredAt, endedAt: Date.now(), isNew: isMissed };
		callLog.unshift(entry);
		Push([{ type: "call:ended", data: { callId: ended.id, outcome, endedBy, entry } }]);
	}

	/// <summary>
	/// Log a call that never rang (busy or unreachable) and hand back the caller's entry.
	/// </summary>
	/// <param name="number">Callee</param>
	/// <param name="outcome">"busy" or "unreachable"</param>
	/// <returns>Log entry</returns>
	function LogUnconnected(number, outcome)
	{
		const entry = { id: nextCallLogId++, number, direction: "out", outcome, startedAt: Date.now(), answeredAt: 0, endedAt: Date.now(), isNew: false };
		callLog.unshift(entry);
		return entry;
	}

	const config =
	{
		callsEnabled: true, callRingSeconds: 15, defaultRingtone: "hoot", voiceEnabled: true, voiceBitrate: 24000,
		ringtones:
		[
			{ id: "hoot", label: "Owl Hoot", file: "../UI/Sounds/OwlHoot.wav" },
			{ id: "chime", label: "Bell Chime", file: "../UI/Sounds/BellChime.wav" },
			{ id: "harp", label: "Enchanted Harp", file: "../UI/Sounds/EnchantedHarp.wav" },
		],
		command: "owl",
		openKey: "up",
		numbersVisible: false, maxNameLength: 40, maxAvatarUrlLength: 512, maxMessageLength: 500, maxGroupMembers: 12, maxGroupTitleLength: 40,
		informCooldownSeconds: 30, informConsent: true, locationsEnabled: true, toastDurationMs: 3000, bannerDurationMs: 4000, soundMode: "file", wwiseEvent: "",
		sounds:
		[
			{ id: "hoot", label: "Owl Hoot", file: "../UI/Sounds/OwlHoot.wav" },
			{ id: "chime", label: "Bell Chime", file: "../UI/Sounds/BellChime.wav" },
			{ id: "sparkle", label: "Wand Sparkle", file: "../UI/Sounds/WandSparkle.wav" },
			{ id: "tap", label: "Window Tap", file: "../UI/Sounds/WindowTap.wav" },
			{ id: "quill", label: "Quill Scratch", file: "../UI/Sounds/QuillScratch.wav" },
			{ id: "harp", label: "Enchanted Harp", file: "../UI/Sounds/EnchantedHarp.wav" },
		],
		defaultSound: "hoot", readReceipts: true, typingIndicators: true, unsendSeconds: 120, maxPinnedChats: 5,
		nearbyRefreshMs: 1000, requestTimeoutMs: 8000, ui: { scale: 1, widthPx: 360, heightPx: 700, rightMarginPx: 32, defaultTheme: "muggle", defaultLanguage: "en-GB", allowMove: true },
		languages: [], quietActivities: true,
	};

	let settings = { notificationSound: true, notificationVolume: 0.6, popups: true, sound: "", ringtone: "", ringtoneVolume: 0.8, callVolume: 1, readReceipts: true, typingIndicators: true, theme: "", layout: null, language: "", doNotDisturb: false, quietDuringActivities: true, wallpaperUrl: "", colourScheme: "default", animations: true };

	/// <summary>
	/// Read the language files once, the way the server reads Lang/ at start.
	/// </summary>
	/// <returns>Promise settling once every file was tried</returns>
	async function LoadLanguages()
	{
		if (languages.size > 0)
		{
			return;
		}

		for (const id of languageFiles)
		{
			// A file the preview cannot fetch (opened from disk rather than over HTTP) is simply not offered.
			try
			{
				const response = await fetch(`../Lang/${id}.json`);
				const parsed = await response.json();
				languages.set(id, { id, name: parsed.name || id, strings: parsed.strings || {} });
			}
			catch (error)
			{
				console.warn(`DevMock: could not load Lang/${id}.json; serve the resource folder over HTTP.`, error);
			}
		}

		config.languages = [...languages.values()].map((language) => ({ id: language.id, name: language.name }));
	}

	/// <summary>
	/// Push the player's language table in chunks, with English underneath, as the server's PushLanguage does.
	/// </summary>
	/// <returns>Items to deliver</returns>
	function GetLanguageItems()
	{
		const id = languages.has(settings.language) ? settings.language : "en-GB";
		const base = languages.get("en-GB");
		const chosen = languages.get(id);
		const entries = Object.entries({ ...(base ? base.strings : {}), ...(chosen ? chosen.strings : {}) });
		const items = [];

		for (let start = 0; start < Math.max(1, entries.length); start += 120)
		{
			items.push({ type: "lang:chunk", data: { reset: start === 0, strings: entries.slice(start, start + 120) } });
		}

		items.push({ type: "lang:ready", data: { id } });
		return items;
	}

	/// <summary>
	/// Send the page a layout the way the client script does. The preview window stands in for the whole screen.
	/// </summary>
	/// <param name="mode">"docked" or "edit"</param>
	function SendLayout(mode)
	{
		const layout = settings.layout || { x: 0.8, y: 0.5, scale: 1 };
		window.dispatchEvent(new CustomEvent("frantic-owls:layout", { detail: { mode, baseScale: 1, multiplier: layout.scale, centreX: layout.x, centreY: layout.y } }));
		document.body.classList.toggle("is-docked-preview", mode === "docked");
		document.documentElement.style.setProperty("--preview-x", `${layout.x * 100}%`);
		document.documentElement.style.setProperty("--preview-y", `${layout.y * 100}%`);
	}
	let nextId = 100;

	/// <summary>
	/// Deliver items to the page the way the client script does.
	/// </summary>
	/// <param name="items">[{ type, data }]</param>
	function Push(items)
	{
		setTimeout(() => window.dispatchEvent(new CustomEvent("frantic-owls:items", { detail: { items } })), 60);
	}

	/// <summary>
	/// Summary of a chat as the server would send it.
	/// </summary>
	/// <param name="chat">Mock chat</param>
	/// <returns>Chat summary</returns>
	function Summarise(chat)
	{
		const own = messages.filter((message) => message.chatId === chat.id && !hidden.has(message.id));
		const last = own.length > 0 ? own[own.length - 1] : null;
		return { createdBy: chat.members[0], admins: [], avatarUrl: "", pinnedMessage: null, ...chat, lastActivityAt: last ? last.sentAt : chat.createdAt, lastMessage: last, unread: last && last.sender !== me.number ? 1 : 0, mutedUntil: mutes.get(chat.id) || 0, pinnedAt: pins.get(chat.id) || 0 };
	}

	/// <summary>
	/// Push a chat's shared facts to the page the way the server's "chat:update" does.
	/// </summary>
	/// <param name="chat">Mock chat</param>
	function PushChat(chat)
	{
		Push([{ type: "chat:update", data: { chat: { id: chat.id, title: chat.title, avatarUrl: chat.avatarUrl || "", members: chat.members, admins: chat.admins || [], pinnedMessage: chat.pinnedMessage || null } } }]);
	}

	/// <summary>
	/// Record a note about a chat and show it, like the server's notes for group changes.
	/// </summary>
	/// <param name="chat">Mock chat</param>
	/// <param name="kind">Note kind</param>
	/// <param name="details">Note details</param>
	function PushNote(chat, kind, details = {})
	{
		const message = { id: nextId++, chatId: chat.id, sender: me.number, body: JSON.stringify(details), kind, sentAt: Date.now(), deliverAt: 0 };
		messages.push(message);
		Push([{ type: "message:new", data: { chat: { id: chat.id, kind: chat.kind, title: chat.title, members: chat.members, admins: chat.admins || [], createdAt: chat.createdAt, lastActivityAt: message.sentAt }, message } }]);
	}

	/// <summary>
	/// Have the other owl of a chat type for a moment and then read everything, as a live conversation would.
	/// </summary>
	/// <param name="chat">Mock chat</param>
	/// <param name="delayMs">When they read it</param>
	function SimulateReader(chat, delayMs)
	{
		const others = chat.members.filter((member) => member !== me.number && !member.startsWith("0"));
		setTimeout(() =>
		{
			const newest = Math.max(...messages.filter((message) => message.chatId === chat.id).map((message) => message.id));

			for (const number of others)
			{
				if (!reads.has(chat.id))
				{
					reads.set(chat.id, new Map());
				}

				reads.get(chat.id).set(number, newest);
				Push([{ type: "chat:read", data: { chatId: chat.id, number, messageId: newest } }]);
			}
		}, delayMs);
	}

	/// <summary>
	/// Answer one request.
	/// </summary>
	/// <param name="action">Action name</param>
	/// <param name="data">Action payload</param>
	/// <returns>{ ok, error, data }</returns>
	function Handle(action, data)
	{
		// Mirror the real server: a contact ID that is not in this owl's list is refused, never trusted.
		const contactIds = data.contactId !== undefined ? [data.contactId] : (data.contactIds || []);

		if (contactIds.some((id) => !contacts.some((entry) => entry.id === id)))
		{
			return { ok: false, error: "That contact no longer exists." };
		}

		switch (action)
		{
		case "calls.start":
		{
			const contact = data.contactId ? contacts.find((entry) => entry.id === data.contactId) : null;
			const number = contact ? contact.number : String(data.number || "");

			if (call)
			{
				return { ok: false, errorKey: "error.callAlreadyIn" };
			}

			if (blocks.has(number))
			{
				return { ok: false, errorKey: "error.callYouBlocked" };
			}

			if (number === "20000003")
			{
				return { ok: false, errorKey: "error.callBusy", data: { entry: LogUnconnected(number, "busy") } };
			}

			if (number === "20000004")
			{
				return { ok: false, errorKey: "error.callUnreachable", data: { entry: LogUnconnected(number, "unreachable") } };
			}

			const startedAt = Date.now();
			call = { id: nextCallId++, number, direction: "out", state: "ringing", startedAt, answeredAt: 0, expiresAt: startedAt + config.callRingSeconds * 1000, isMuted: false, isOtherMuted: false };
			callTimers.push(setTimeout(() => EndCall("missed", ""), config.callRingSeconds * 1000));

			if (number === "20000002")
			{
				callTimers.push(setTimeout(() =>
				{
					callTimers.forEach(clearTimeout);
					callTimers = [];
					call.state = "active";
					call.answeredAt = Date.now();
					Push([{ type: "call:update", data: { call: { ...call } } }]);
				}, 3000));
			}

			return { ok: true, data: { call: { ...call } } };
		}
		case "calls.answer":
			if (!call || call.id !== data.callId || call.direction !== "in" || call.state !== "ringing")
			{
				return { ok: false, errorKey: "error.callGone", data: { callId: data.callId } };
			}

			callTimers.forEach(clearTimeout);
			callTimers = [];
			call.state = "active";
			call.answeredAt = Date.now();
			return { ok: true, data: { call: { ...call } } };
		case "calls.hangup":
		{
			if (!call || call.id !== data.callId)
			{
				return { ok: false, errorKey: "error.callGone", data: { callId: data.callId } };
			}

			const outcome = call.state === "active" ? "answered" : call.direction === "out" ? "cancelled" : "declined";
			const callId = call.id;
			setTimeout(() => EndCall(outcome, me.number), 0);
			return { ok: true, data: { callId } };
		}
		case "calls.mute":
			if (!call || call.id !== data.callId || call.state !== "active")
			{
				return { ok: false, errorKey: "error.callGone", data: { callId: data.callId } };
			}

			call.isMuted = data.muted === true;
			return { ok: true, data: { call: { ...call } } };
		case "calls.seen":
			callLog.forEach((entry) => (entry.isNew = false));
			return { ok: true, data: {} };
		case "calls.clear":
			callLog = data.callId > 0 ? callLog.filter((entry) => entry.id !== data.callId) : [];
			return { ok: true, data: { callId: data.callId } };
		case "chats.history":
		{
			const chatReads = settings.readReceipts ? [...(reads.get(data.chatId) || new Map())].map(([number, messageId]) => ({ number, messageId })) : [];
			return { ok: true, data: { chatId: data.chatId, beforeId: data.beforeId, messages: messages.filter((message) => message.chatId === data.chatId && !blocks.has(message.sender) && !hidden.has(message.id)), hasMore: false, reads: chatReads, serverNow: Date.now() } };
		}
		case "chats.pin":
			if (data.pinned && pins.size >= config.maxPinnedChats)
			{
				return { ok: false, error: `You can pin at most ${config.maxPinnedChats} chats. Unpin one first.` };
			}

			if (data.pinned)
			{
				pins.set(data.chatId, Date.now());
			}
			else
			{
				pins.delete(data.chatId);
			}

			return { ok: true, data: { chatId: data.chatId, pinnedAt: pins.get(data.chatId) || 0 } };
		case "chats.typing":
			return { ok: true, data: {} };
		case "contacts.favourite":
		{
			const contact = contacts.find((entry) => entry.id === data.contactId);
			contact.favourite = !!data.favourite;
			return { ok: true, data: { contactId: contact.id, favourite: contact.favourite } };
		}
		case "messages.hide":
			hidden.add(data.messageId);
			return { ok: true, data: { chatId: data.chatId, messageId: data.messageId } };
		case "messages.unsend":
		{
			const message = messages.find((entry) => entry.id === data.messageId && entry.sender === me.number);

			if (!message || Date.now() - message.sentAt > config.unsendSeconds * 1000)
			{
				return { ok: false, error: "Only your own owls can be unsent, and only within 2 minutes of sending." };
			}

			message.body = "";
			message.unsentAt = Date.now();
			return { ok: true, data: { chatId: data.chatId, messageId: message.id, unsentAt: message.unsentAt } };
		}
		case "messages.pin":
		{
			const chat = chats.find((entry) => entry.id === data.chatId);
			const message = messages.find((entry) => entry.id === data.messageId);
			chat.pinnedMessage = message ? { id: message.id, sender: message.sender, kind: message.kind || "text", body: message.body, unsent: false, sentAt: message.sentAt } : null;
			PushNote(chat, message ? "pinned" : "unpinned");
			return { ok: true, data: { chatId: chat.id, pinnedMessage: chat.pinnedMessage } };
		}
		case "groups.rename":
		{
			const chat = chats.find((entry) => entry.id === data.chatId);
			chat.title = String(data.title).trim();
			PushChat(chat);
			PushNote(chat, "renamed", { title: chat.title });
			return { ok: true, data: { chatId: chat.id, title: chat.title } };
		}
		case "groups.picture":
		{
			const chat = chats.find((entry) => entry.id === data.chatId);
			const url = String(data.avatarUrl).trim();

			if (url && !/^https:\/\//.test(url))
			{
				return { ok: false, error: "Use an https:// image link." };
			}

			chat.avatarUrl = url;
			PushChat(chat);
			PushNote(chat, "picture", { cleared: url === "" });
			return { ok: true, data: { chatId: chat.id, avatarUrl: url } };
		}
		case "groups.addMembers":
		{
			const chat = chats.find((entry) => entry.id === data.chatId);
			const added = data.contactIds.map((id) => contacts.find((entry) => entry.id === id).number).filter((number) => !chat.members.includes(number));
			chat.members.push(...added);
			PushChat(chat);
			added.forEach((number) => PushNote(chat, "added", { target: number }));
			return { ok: true, data: { chatId: chat.id, added: added.length, skipped: 0 } };
		}
		case "groups.removeMember":
		{
			const chat = chats.find((entry) => entry.id === data.chatId);
			chat.members = chat.members.filter((number) => number !== data.number);
			chat.admins = (chat.admins || []).filter((number) => number !== data.number);
			PushChat(chat);
			PushNote(chat, "removed", { target: data.number });
			return { ok: true, data: { chatId: chat.id, number: data.number } };
		}
		case "groups.setAdmin":
		{
			const chat = chats.find((entry) => entry.id === data.chatId);
			chat.admins = data.admin ? [...new Set([...(chat.admins || []), data.number])] : (chat.admins || []).filter((number) => number !== data.number);
			PushChat(chat);
			PushNote(chat, data.admin ? "promoted" : "demoted", { target: data.number });
			return { ok: true, data: { chatId: chat.id, number: data.number, admin: !!data.admin } };
		}
		case "chats.mute":
		{
			const mutedUntil = data.minutes === 0 ? 0 : data.minutes < 0 ? 253402300799000 : Date.now() + data.minutes * 60000;
			mutes.set(data.chatId, mutedUntil);
			return { ok: true, data: { chatId: data.chatId, mutedUntil } };
		}
		case "blocks.add":
			blocks.add(data.number);
			return { ok: true, data: { number: data.number } };
		case "blocks.remove":
			blocks.delete(data.number);
			return { ok: true, data: { number: data.number } };
		case "chats.read":
			return { ok: true, data: {} };
		case "chats.leave":
		{
			const chat = chats.find((entry) => entry.id === data.chatId);

			if (!chat || chat.kind !== "group")
			{
				return { ok: false, error: "Only a bulk owl can be left." };
			}

			chats.splice(chats.indexOf(chat), 1);
			return { ok: true, data: { chatId: data.chatId } };
		}
		case "messages.send":
		{
			const chat = chats.find((entry) => entry.id === data.chatId);
			const other = chat && chat.kind === "direct" ? chat.members.find((member) => member !== me.number) : "";

			if (chat && chat.kind === "direct" && blocks.has(other))
			{
				return { ok: false, errorKey: "error.youBlocked", data: { clientKey: data.clientKey } };
			}

			if (chat && chat.kind === "direct" && retired.has(other))
			{
				return { ok: false, errorKey: "error.retired", data: { clientKey: data.clientKey } };
			}

			const sentAt = Date.now();
			const quoted = data.replyToId ? messages.find((entry) => entry.id === data.replyToId) : null;
			const replyTo = quoted ? { id: quoted.id, sender: quoted.sender, kind: quoted.kind || "text", body: quoted.unsentAt ? "" : quoted.body, unsent: !!quoted.unsentAt } : null;
			const message = { id: nextId++, chatId: data.chatId, sender: me.number, body: data.body, kind: "text", sentAt, deliverAt: sentAt + mockFlightMs, replyTo, unsentAt: 0 };
			messages.push(message);
			setTimeout(() => Push([{ type: "message:landed", data: { chatId: message.chatId, messageId: message.id } }]), mockFlightMs);

			if (chat)
			{
				SimulateReader(chat, mockFlightMs + 2500);
			}

			return { ok: true, data: { message, clientKey: data.clientKey, serverNow: Date.now() } };
		}
		case "messages.sendLocation":
		{
			const sentAt = Date.now();
			const body = JSON.stringify({ x: 15200, y: -3100, z: 240, areaId: "Overland", regionId: "LowerHogsfield", world: 0, place: "Lower Hogsfield" });
			const message = { id: nextId++, chatId: data.chatId, sender: me.number, body, kind: "location", sentAt, deliverAt: sentAt + mockFlightMs };
			messages.push(message);
			setTimeout(() => Push([{ type: "message:landed", data: { chatId: message.chatId, messageId: message.id } }]), mockFlightMs);
			return { ok: true, data: { message, serverNow: Date.now() } };
		}
		case "locations.show":
		{
			const message = messages.find((entry) => entry.id === data.messageId && entry.kind === "location");

			if (!message)
			{
				return { ok: false, error: "That location is no longer available." };
			}

			// Showing the shown location again hides it, like the server.
			if (shownLocation && shownLocation.chatId === data.chatId && shownLocation.messageId === data.messageId)
			{
				Push([{ type: "location:clear", data: { ...shownLocation, reason: "hidden" } }]);
				shownLocation = null;
				return { ok: true, data: { isHidden: true } };
			}

			const location = JSON.parse(message.body);
			console.log(`DevMock: route to ${location.place} (${location.x}, ${location.y}, ${location.z}) labelled "${data.label ? `${data.label}'s owl` : "Shared location"}"`);
			shownLocation = { chatId: data.chatId, messageId: data.messageId };
			Push([{ type: "location:route", data: { key: "hmp:frantic-owls:location-1", label: data.label, ...shownLocation, target: { x: location.x, y: location.y, z: location.z }, isNative: false, seconds: 0, arrivalMetres: 10 } }]);
			return { ok: true, data: { place: location.place, isElsewhere: location.place === "Hogsmeade" } };
		}
		case "inform.respond":
		{
			const request = informRequests.find((entry) => entry.id === data.requestId);

			if (!request)
			{
				return { ok: false, error: "That owl is no longer waiting for you.", data: { requestId: data.requestId } };
			}

			informRequests = informRequests.filter((entry) => entry !== request);

			if (data.choice === "decline")
			{
				return { ok: true, data: { requestId: request.id, choice: data.choice, contact: null, exchanged: false } };
			}

			// Record the contact on the mock server's side too, as the real server does, so later requests about it succeed.
			let contact = contacts.find((entry) => entry.number === request.number);

			if (!contact)
			{
				contact = { id: nextId++, number: request.number, name: request.name, avatarUrl: "", profileAvatarUrl: request.avatarUrl, updatedAt: Date.now() };
				contacts.push(contact);
			}

			return { ok: true, data: { requestId: request.id, choice: data.choice, contact: { ...contact }, exchanged: data.choice === "exchange" } };
		}
		case "chats.openDirect":
		{
			const contact = contacts.find((entry) => entry.id === data.contactId);
			let chat = chats.find((entry) => entry.kind === "direct" && entry.members.includes(contact.number));

			if (!chat)
			{
				chat = { id: nextId++, kind: "direct", title: "", members: [me.number, contact.number], createdAt: Date.now() };
				chats.push(chat);
			}

			return { ok: true, data: { chat: Summarise(chat) } };
		}
		case "chats.createGroup":
		{
			const members = [me.number, ...data.contactIds.map((id) => contacts.find((entry) => entry.id === id).number)];
			const chat = { id: nextId++, kind: "group", title: data.title.trim(), members, createdAt: Date.now() };
			chats.push(chat);
			return { ok: true, data: { chat: Summarise(chat) } };
		}
		case "contacts.update":
		{
			const contact = contacts.find((entry) => entry.id === data.contactId);
			contact.name = String(data.name).trim();
			contact.avatarUrl = String(data.avatarUrl).trim();
			return contact.name ? { ok: true, data: { contact: { ...contact } } } : { ok: false, error: "A contact needs a name." };
		}
		case "contacts.delete":
			contacts.splice(contacts.findIndex((entry) => entry.id === data.contactId), 1);
			return { ok: true, data: { contactId: data.contactId } };
		case "contacts.saveFromChat":
		{
			const chat = chats.find((entry) => entry.id === data.chatId);
			const contact = { id: nextId++, number: chat.members.find((member) => member !== me.number), name: String(data.name).trim() || "Unnamed Owl", avatarUrl: "", updatedAt: Date.now() };
			contacts.push(contact);
			return { ok: true, data: { contact } };
		}
		case "inform.nearby":
			return { ok: true, data: { rangeMetres: 5, players: [{ playerId: 7, name: "Garreth Weasley", distance: 1.8, cooldownSeconds: 0 }, { playerId: 9, name: "Leander Prewett", distance: 4.2, cooldownSeconds: 0 }] } };
		case "inform.send":
			return { ok: true, data: { status: config.informConsent ? "requested" : "added", name: data.playerId === 7 ? "Garreth Weasley" : "Leander Prewett", cooldownSeconds: 30 } };
		case "settings.update":
		{
			const before = settings.language;

			// Like the server, a wallpaper must be an https link (the preview also accepts data: pictures, to try one without a host).
			if (typeof data.settings.wallpaperUrl === "string" && data.settings.wallpaperUrl && !/^(https:\/\/|data:image\/)/.test(data.settings.wallpaperUrl))
			{
				return { ok: false, errorKey: "error.pictureHttps" };
			}

			settings = { ...settings, ...data.settings };

			if (settings.language !== before)
			{
				Push(GetLanguageItems());
			}

			return { ok: true, data: { settings } };
		}
		case "profile.update":
			me.avatarUrl = String(data.avatarUrl).trim();
			return { ok: true, data: { avatarUrl: me.avatarUrl } };
		case "profiles.lookup":
			return { ok: true, data: { profiles: data.numbers.map((number) => ({ number, avatarUrl: "" })) } };
		default:
			return { ok: false, error: `Mock does not know "${action}".` };
		}
	}

	window.callEvent = (name, json) =>
	{
		const payload = json ? JSON.parse(json) : null;

		switch (name)
		{
		case "frantic-owls:ready":
			SendLayout("docked");
			LoadLanguages().then(() => Push
			([
				...GetLanguageItems(),
				{ type: "state:reset", data: { me, settings, config, blocks: [...blocks], retired: [...retired], quiet: { active: false, label: "" }, senders, serverNow: Date.now() } },
				{ type: "profiles:chunk", data: { reset: true, profiles: [{ number: "20000002", avatarUrl: sampleAvatar }] } },
				{ type: "contacts:chunk", data: { reset: true, contacts } },
				{ type: "chats:chunk", data: { reset: true, chats: chats.map(Summarise) } },
				{ type: "calls:chunk", data: { reset: true, entries: callLog.map((entry) => ({ ...entry })) } },
				{ type: "call:current", data: { call: call ? { ...call } : null } },
				{ type: "inform:requests", data: { requests: informRequests.filter((request) => request.expiresAt > Date.now()) } },
				{ type: "state:ready", data: {} },
			]));
			setTimeout(() => window.dispatchEvent(new CustomEvent("frantic-owls:opened")), 300);
			break;
		case "frantic-owls:request":
		{
			const result = Handle(payload.action, payload.data);
			Push([{ type: "response", data: { requestId: payload.requestId, ok: result.ok, error: result.error || "", errorKey: result.errorKey || "", errorParams: result.errorParams || {}, data: result.data || {} } }]);
			break;
		}
		case "frantic-owls:close":
			window.dispatchEvent(new CustomEvent("frantic-owls:closed"));
			break;
		case "frantic-owls:voice":
			// The other owl here is an echo: your own voice comes back a moment later, as the server would pass theirs on.
			++voiceMessagesSent;

			if (call && call.state === "active" && !call.isMuted)
			{
				setTimeout(() => window.dispatchEvent(new CustomEvent("frantic-owls:voice", { detail: payload })), voiceEchoMs);
			}
			break;
		case "frantic-owls:layout-edit":
			SendLayout("edit");
			break;
		case "frantic-owls:layout-cancel":
			SendLayout("docked");
			break;
		case "frantic-owls:layout-done":
			settings.layout = payload.layout;
			SendLayout("docked");
			break;
		default:
			console.log(`DevMock: ${name}`, payload);
			break;
		}
	};

	window.OwlsDev =
	{
		ResetPosition: () =>
		{
			settings.layout = null;
			Push([{ type: "settings:update", data: { settings } }]);
			SendLayout("docked");
		},
		Open: () => window.dispatchEvent(new CustomEvent("frantic-owls:opened")),
		Announce: () =>
		{
			const message = { id: nextId++, chatId: 5, sender: "00000001", body: "By order of the Ministry: duelling in Hogsmeade's high street is forbidden.", kind: "text", sentAt: Date.now(), deliverAt: 0 };
			messages.push(message);
			const chat = chats.find((entry) => entry.id === 5);
			Push([{ type: "message:new", data: { chat: { id: 5, kind: "channel", title: chat.title, createdBy: chat.createdBy, members: [], createdAt: chat.createdAt, lastActivityAt: message.sentAt }, message } }]);
		},
		MemberLeaves: (chatId = 3) =>
		{
			const chat = chats.find((entry) => entry.id === chatId);

			if (!chat)
			{
				return;
			}

			const leaver = chat.members.find((member) => member !== me.number);
			chat.members = chat.members.filter((member) => member !== leaver);
			const message = { id: nextId++, chatId, sender: leaver, body: "", kind: "left", sentAt: Date.now() };
			messages.push(message);
			Push([{ type: "message:new", data: { chat: { id: chat.id, kind: chat.kind, title: chat.title, members: chat.members, createdAt: chat.createdAt, lastActivityAt: message.sentAt }, message } }]);
		},
		Close: () => window.dispatchEvent(new CustomEvent("frantic-owls:closed")),
		Typing: (chatId = 1) =>
		{
			const chat = chats.find((entry) => entry.id === chatId);
			const typists = chat.members.filter((member) => member !== me.number).slice(0, chat.kind === "group" ? 2 : 1);
			Push(typists.map((number) => ({ type: "chat:typing", data: { chatId, number, durationMs: 5000 } })));
		},
		RemovedFromGroup: (chatId = 3) =>
		{
			const chat = chats.find((entry) => entry.id === chatId);
			Push([{ type: "chat:removed", data: { chatId, title: chat ? chat.title : "" } }]);
		},
		Incoming: (chatId = 3) =>
		{
			const chat = chats.find((entry) => entry.id === chatId);
			const sender = chat.members.find((member) => member !== me.number);
			const message = { id: nextId++, chatId, sender, body: "An owl just landed on your windowsill!", sentAt: Date.now() };
			messages.push(message);
			Push([{ type: "message:new", data: { chat: { id: chat.id, kind: chat.kind, title: chat.title, members: chat.members, createdAt: chat.createdAt, lastActivityAt: message.sentAt }, message } }]);
		},
		Inform: (name = "Garreth Weasley") =>
		{
			const number = name === "Garreth Weasley" ? "20000050" : `2000${String(nextId).padStart(4, "0")}`;
			const request = { id: nextId++, number, name, avatarUrl: name === "Garreth Weasley" ? "" : sampleAvatar, expiresAt: Date.now() + 60000, canExchange: true };
			informRequests.push(request);
			Push([{ type: "inform:request", data: { request: { id: request.id, name: request.name, avatarUrl: request.avatarUrl, expiresAt: request.expiresAt, canExchange: request.canExchange } } }]);
		},
		InformWithoutConsent: () =>
		{
			// Record the contact on the mock server's side too, as the real server does, so later requests about it succeed.
			let contact = contacts.find((entry) => entry.number === "20000050");

			if (!contact)
			{
				contact = { id: 50, number: "20000050", name: "Garreth Weasley", avatarUrl: "", profileAvatarUrl: "", updatedAt: Date.now() };
				contacts.push(contact);
			}

			Push
			([
				{ type: "contact:upsert", data: { contact: { ...contact } } },
				{ type: "notify", data: { kind: "inform", title: contact.name, bodyKey: "inform.tell.informed", params: {}, contactId: contact.id } },
			]);
		},
		IncomingCall: (number = "20000003") =>
		{
			if (call)
			{
				console.warn("DevMock: already in a call.");
				return;
			}

			const startedAt = Date.now();
			call = { id: nextCallId++, number, direction: "in", state: "ringing", startedAt, answeredAt: 0, expiresAt: startedAt + config.callRingSeconds * 1000, isMuted: false, isOtherMuted: false };
			callTimers.push(setTimeout(() => EndCall("missed", ""), config.callRingSeconds * 1000));
			Push([{ type: "call:incoming", data: { call: { ...call } } }]);
		},
		OtherHangsUp: () =>
		{
			if (!call)
			{
				console.warn("DevMock: no call to hang up.");
				return;
			}

			const outcome = call.state === "active" ? "answered" : call.direction === "in" ? "cancelled" : "declined";
			EndCall(outcome, call.number);
		},
		VoiceStats: () => ({ sent: voiceMessagesSent, voice: window.Owls && Owls.Voice ? Owls.Voice.GetState() : null }),
		OtherMutes: (muted = true) =>
		{
			if (!call || call.state !== "active")
			{
				console.warn("DevMock: no call in progress.");
				return;
			}

			call.isOtherMuted = muted;
			Push([{ type: "call:update", data: { call: { ...call } } }]);
		},
		MissedWhileBusy: (number = "20000001") =>
		{
			const entry = { id: nextCallLogId++, number, direction: "in", outcome: "busy", startedAt: Date.now(), answeredAt: 0, endedAt: Date.now(), isNew: true };
			callLog.unshift(entry);
			Push([{ type: "call:logged", data: { entry } }]);
		},
		DuelStarts: () => Push([{ type: "quiet:update", data: { active: true, label: "Duel" } }]),
		DuelEnds: () => Push([{ type: "quiet:update", data: { active: false, label: "" } }]),
		CharacterDeleted: (number = "20000005") =>
		{
			// The server retires the owl, takes it out of its bulk owls with a note, and tells everyone related.
			retired.add(number);
			const items = [{ type: "owl:retired", data: { number } }];

			for (const chat of chats.filter((entry) => entry.kind === "group" && entry.members.includes(number)))
			{
				chat.members = chat.members.filter((member) => member !== number);
				chat.admins = (chat.admins || []).filter((member) => member !== number);
				const message = { id: nextId++, chatId: chat.id, sender: number, body: "", kind: "retired", sentAt: Date.now(), deliverAt: 0 };
				messages.push(message);
				items.push({ type: "message:new", data: { chat: { id: chat.id, kind: chat.kind, title: chat.title, members: chat.members, admins: chat.admins, createdAt: chat.createdAt, lastActivityAt: message.sentAt }, message } });
			}

			Push(items);
		},
	};
})();
