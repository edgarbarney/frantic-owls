// FranticDreamer 2026
"use strict";

// ========================
// Development Mock (Immersive)
// ========================

/// <summary>
/// Stand-in for the client script and server, so immersive mode's letter desk can be previewed in a normal browser.
/// Defines window.callEvent the way the game's browser does and answers the desk's requests from in-memory letters,
/// following the same rules as Server/Mail.js (read and write modes, owl posts, unread letters, one copy per recipient).
///
/// <para>
/// NOTE: Lives outside UI/ on purpose: the manifest only ships UI/**, so this never reaches players.
/// Open Dev/ImmersivePreview.html over HTTP to use it.
/// </para>
///
/// </summary>
(() =>
{
	const me = { number: "12345678", name: "Harriet Pemberton" };
	const now = Date.now();
	const minute = 60000;
	const post = { id: "hogsmeade", label: "Hogsmeade Owl Post" };

	const contacts =
	[
		{ id: 1, number: "20000002", name: "Natsai Onai" },
		{ id: 2, number: "20000003", name: "Sebastian Sallow" },
	];

	const online =
	[
		{ number: "20000002", name: "Natsai Onai" },
		{ number: "20000006", name: "Ominis Gaunt" },
		{ number: "20000004", name: "Poppy Sweeting" },
		{ number: "20000050", name: "Garreth Weasley" },
	];

	/// <summary>
	/// Every letter the mock server holds: { id, sender, to, text, sentAt, official, groupTitle, isRead }.
	/// </summary>
	const letters =
	[
		{ id: 1, sender: "20000003", to: [me.number], text: "Dear Harriet,\n\nMeet me at the Undercroft after supper. Bring the map, and do not let Ominis see it.\n\nYours,\nSebastian", sentAt: now - 3 * 24 * 60 * minute, isRead: true },
		{ id: 2, sender: me.number, to: ["20000003"], text: "Dear Sebastian,\n\nI will be there. The map stays with me.\n\nSincerely,\nHarriet Pemberton", sentAt: now - 3 * 24 * 60 * minute + 20 * minute, isRead: true },
		{ id: 3, sender: "00000001", to: [me.number], text: "By order of the Ministry: duelling in Hogsmeade's high street is forbidden until further notice.", sentAt: now - 26 * 60 * minute, official: "Ministry of Magic", isRead: true },
		{ id: 4, sender: "20000005", to: [me.number], text: "Who fed the Puffskein?", sentAt: now - 5 * 60 * minute, groupTitle: "Beast Club", isRead: true },
		{ id: 5, sender: "20000099", to: [me.number], text: "To whoever finds this,\n\n    Something stirs beneath the Forbidden Forest. The centaurs have gone quiet,\n    and the lanterns on the old path burn green at midnight.\n\nTell no one who sent this.", sentAt: now - 40 * minute, isRead: false },
		{ id: 6, sender: "20000002", to: [me.number], text: "Dear Harriet,\n\nAre you coming to the Three Broomsticks tonight? Sirona says she will save us a table by the fire, and Poppy promised to bring the Puffskein (I told her not to).\n\nIf you are late, I am ordering the butterbeer without you.\n\nSincerely,\nNatsai Onai", sentAt: now - 12 * minute, isRead: false },
	];

	const config =
	{
		mode: "immersive",
		command: "owl",
		openKey: "up",
		maxNameLength: 40,
		flightEnabled: false,
		toastDurationMs: 3000,
		soundMode: "file",
		sounds:
		[
			{ id: "hoot", label: "Owl Hoot", file: "../UI/Sounds/OwlHoot.wav" },
			{ id: "chime", label: "Bell Chime", file: "../UI/Sounds/BellChime.wav" },
			{ id: "quill", label: "Quill Scratch", file: "../UI/Sounds/QuillScratch.wav" },
		],
		defaultSound: "hoot",
		wwiseEvent: "",
		requestTimeoutMs: 8000,
		readMode: "free",
		writeMode: "free",
		maxLetterLength: 4000,
		maxLetterLines: 150,
		maxRecipients: 8,
		hasPosts: true,
		ui: { scale: 1 },
		languages: [],
		quietActivities: true,
	};

	let settings = { notificationSound: true, notificationVolume: 0.6, popups: true, sound: "", language: "", doNotDisturb: false, quietDuringActivities: true };
	let isAtPost = false;
	let isOpen = false;
	let nextId = 100;

	const languageFiles = ["en-GB", "tr"];
	const languages = new Map();

	/// <summary>
	/// Read the language files once, the way the server reads Lang/ at start.
	/// </summary>
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
				const parsed = await (await fetch(`../Lang/${id}.json`)).json();
				languages.set(id, { id, name: parsed.name || id, strings: parsed.strings || {} });
			}
			catch (error)
			{
				console.warn(`ImmersiveMock: could not load Lang/${id}.json; serve the resource folder over HTTP.`, error);
			}
		}

		config.languages = [...languages.values()].map((language) => ({ id: language.id, name: language.name }));
	}

	/// <summary>
	/// The player's language table in chunks, with English underneath, as the server's PushLanguage sends it.
	/// </summary>
	/// <returns>Items to deliver</returns>
	function GetLanguageItems()
	{
		const id = languages.has(settings.language) ? settings.language : "en-GB";
		const entries = Object.entries({ ...(languages.get("en-GB") || { strings: {} }).strings, ...(languages.get(id) || { strings: {} }).strings });
		return [{ type: "lang:chunk", data: { reset: true, strings: entries } }, { type: "lang:ready", data: { id } }];
	}

	/// <summary>
	/// Deliver items to the page the way the client script does.
	/// </summary>
	/// <param name="items">[{ type, data }]</param>
	function Push(items)
	{
		setTimeout(() => window.dispatchEvent(new CustomEvent("frantic-owls:items", { detail: { items } })), 60);
	}

	/// <summary>
	/// Send the page a layout the way the client script does: the whole window stands in for the screen.
	/// </summary>
	/// <param name="mode">"desk" or "notice"</param>
	function SendLayout(mode)
	{
		window.dispatchEvent(new CustomEvent("frantic-owls:layout", { detail: { mode, baseScale: Math.max(0.5, window.innerHeight / 1080) } }));
	}

	/// <summary>
	/// Why a letter cannot be read here, following Server/Mail.js.
	/// </summary>
	/// <param name="isUnread">Whether the letter is unread</param>
	/// <returns>Text key, or ""</returns>
	function GetReadProblem(isUnread)
	{
		if (config.readMode === "postonly" && !isAtPost)
		{
			return "error.mail.readAtPost";
		}

		return config.readMode === "postonly_freeunread" && !isAtPost && !isUnread ? "error.mail.readOldAtPost" : "";
	}

	/// <summary>
	/// A letter as the server lists it.
	/// </summary>
	/// <param name="letter">Mock letter</param>
	/// <returns>Listed letter</returns>
	function Summarise(letter)
	{
		const box = letter.sender === me.number ? "sent" : "inbox";
		const isUnread = box === "inbox" && !letter.isRead;
		const readProblem = GetReadProblem(isUnread);
		const lines = letter.text.split("\n").map((line) => line.trim()).filter(Boolean);

		return {
			id: letter.id,
			box,
			sentAt: letter.sentAt,
			arrivedAt: letter.sentAt,
			isUnread,
			isReadable: !readProblem,
			readProblem,
			official: letter.official ? { name: letter.official } : null,
			groupTitle: letter.groupTitle || "",
			recipients: box === "sent" ? letter.to : [],
			excerpt: readProblem ? null : { first: lines[0] || "", second: lines[1] || "", last: lines.length > 2 ? lines[lines.length - 1] : "" },
			canReply: box === "inbox" && !letter.official,
		};
	}

	/// <summary>
	/// Answer one request.
	/// </summary>
	/// <param name="action">Action name</param>
	/// <param name="data">Action payload</param>
	/// <returns>{ ok, errorKey, data }</returns>
	function Handle(action, data)
	{
		const unread = () => letters.filter((letter) => letter.sender !== me.number && !letter.isRead).length;

		switch (action)
		{
		case "mail.list":
		{
			const box = data.box === "sent" ? "sent" : "inbox";
			const listed = letters.filter((letter) => (box === "sent") === (letter.sender === me.number) && (!data.beforeId || letter.id < data.beforeId)).sort((first, second) => second.id - first.id);
			return { ok: true, data: { box, beforeId: data.beforeId || 0, letters: listed.slice(0, 40).map(Summarise), hasMore: listed.length > 40, post: isAtPost ? post : null, unread: unread(), serverNow: Date.now() } };
		}
		case "mail.open":
		{
			const letter = letters.find((entry) => entry.id === data.messageId);

			if (!letter)
			{
				return { ok: false, errorKey: "error.mail.gone" };
			}

			const summary = Summarise(letter);

			if (summary.readProblem)
			{
				return { ok: false, errorKey: summary.readProblem };
			}

			letter.isRead = true;
			return { ok: true, data: { letter: { ...summary, isUnread: false, text: letter.text }, unread: unread() } };
		}
		case "mail.recipients":
			return { ok: true, data: { online, post: isAtPost ? post : null } };
		case "mail.send":
		{
			if (config.writeMode === "postonly" && !isAtPost)
			{
				return { ok: false, errorKey: "error.mail.writeAtPost" };
			}

			const targets = new Map();

			if (data.replyToId)
			{
				const answered = letters.find((entry) => entry.id === data.replyToId);
				targets.set(answered.sender, data.replyLabel || "");
			}

			for (const number of data.recipients)
			{
				const known = online.find((entry) => entry.number === number) || contacts.find((entry) => entry.number === number);
				targets.set(number, known ? known.name : "");
			}

			const sent = [];
			const failed = [];
			const added = [];

			// Poppy has blocked Harriet in this mock, to show a letter that reaches only some of its recipients.
			for (const [number, label] of targets)
			{
				if (number === "20000004")
				{
					failed.push({ number, errorKey: "error.undeliverable" });
					continue;
				}

				const id = nextId++;
				letters.push({ id, sender: me.number, to: [number], text: data.body, sentAt: Date.now(), isRead: true });
				sent.push({ number, messageId: id });

				if (label && !contacts.some((contact) => contact.number === number))
				{
					const contact = { id: nextId++, number, name: label };
					contacts.push(contact);
					added.push(contact);
				}
			}

			return sent.length > 0 ? { ok: true, data: { sent, failed, contacts: added, clientKey: data.clientKey } } : { ok: false, errorKey: failed[0].errorKey };
		}
		case "settings.update":
		{
			const languageBefore = settings.language;
			settings = { ...settings, ...data.settings };

			if (settings.language !== languageBefore)
			{
				Push(GetLanguageItems());
			}

			return { ok: true, data: { settings } };
		}
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
			SendLayout("notice");
			LoadLanguages().then(() =>
			{
				const unread = letters.filter((letter) => letter.sender !== me.number && !letter.isRead).length;
				Push
				([
					...GetLanguageItems(),
					{ type: "state:reset", data: { me: { name: me.name }, settings, config, quiet: { active: false, label: "" }, unread, serverNow: Date.now() } },
					{ type: "contacts:chunk", data: { reset: true, contacts } },
					{ type: "state:ready", data: {} },
				]);
			});
			break;
		case "frantic-owls:request":
		{
			const result = Handle(payload.action, payload.data || {});
			Push([{ type: "response", data: { requestId: payload.requestId, ok: result.ok, error: result.error || "", errorKey: result.errorKey || "", errorParams: result.errorParams || {}, data: result.data || {} } }]);
			break;
		}
		case "frantic-owls:close":
			OwlsDev.Close();
			break;
		case "frantic-owls:overlay":
			document.body.classList.toggle("is-overlay", !!(payload && payload.active));
			break;
		default:
			console.log(`ImmersiveMock: ${name}`, payload);
			break;
		}
	};

	window.OwlsDev =
	{
		Open: () =>
		{
			isOpen = true;
			SendLayout("desk");
			Push([{ type: "ui:open", data: { post: isAtPost ? post : null } }]);
			window.dispatchEvent(new CustomEvent("frantic-owls:opened"));
		},
		Close: () =>
		{
			if (!isOpen)
			{
				return;
			}

			isOpen = false;
			window.dispatchEvent(new CustomEvent("frantic-owls:closed"));
			setTimeout(() => SendLayout("notice"), 250);
		},
		Arrive: (signed = true) =>
		{
			const id = nextId++;
			const text = signed ? "Dear Harriet,\n\nThe Puffskein has escaped again. It was last seen heading for the Herbology greenhouses.\n\nSincerely,\nPoppy Sweeting" : "You are being watched.";
			letters.push({ id, sender: signed ? "20000004" : "20000098", to: [me.number], text, sentAt: Date.now(), isRead: false });
			Push([{ type: "mail:arrived", data: { id } }]);
		},
		SetModes: (readMode = "free", writeMode = "free") =>
		{
			config.readMode = readMode;
			config.writeMode = writeMode;
			Push([{ type: "state:reset", data: { me: { name: me.name }, settings, config, quiet: { active: false, label: "" }, unread: 0, serverNow: Date.now() } }, { type: "contacts:chunk", data: { reset: true, contacts } }, { type: "state:ready", data: {} }]);
		},
		AtPost: (value = true) =>
		{
			isAtPost = value;
			Push([{ type: "ui:open", data: { post: isAtPost ? post : null } }]);
		},
	};
})();
