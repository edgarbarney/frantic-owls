// FranticDreamer 2026
"use strict";

// ========================
// Development Mock (Immersive)
// ========================

/// <summary>
/// Stand-in for the client script and server, so immersive mode's letter desk can be previewed in a normal browser.
/// Defines window.callEvent the way the game's browser does and answers the desk's requests from in-memory letters,
/// following the same rules as Server/Mail.js (read and write modes, owl posts, unread letters, one copy per recipient,
/// any character by name, correspondents saved without knowing who they are, official letters).
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

	/// <summary>
	/// Every character with an owl, as the server's roster holds them; online ones are marked.
	/// </summary>
	const roster =
	[
		{ number: "20000002", name: "Natsai Onai", online: true },
		{ number: "20000003", name: "Sebastian Sallow", online: false },
		{ number: "20000004", name: "Poppy Sweeting", online: true },
		{ number: "20000005", name: "Amit Thakkar", online: false },
		{ number: "20000006", name: "Ominis Gaunt", online: true },
		{ number: "20000007", name: "Everett Clopton", online: false },
		{ number: "20000008", name: "Sirona Ryan", online: false },
		{ number: "20000009", name: "Lucan Brattleby", online: false },
		{ number: "20000010", name: "Nerida Robinson", online: false },
		{ number: "20000011", name: "Leander Prewett", online: true },
		{ number: "20000012", name: "Samantha Dale", online: false },
		{ number: "20000013", name: "Imelda Reyes", online: false },
		{ number: "20000014", name: "Zenobia Noke", online: false },
		{ number: "20000015", name: "Mariella Fawley", online: false },
		{ number: "20000016", name: "Andrew Larson", online: false },
		{ number: "20000017", name: "Sacharissa Tugwood", online: false },
		{ number: "20000018", name: "Arthur Plummeridge", online: false },
		{ number: "20000019", name: "Noreen Sedgewick", online: false },
		{ number: "20000020", name: "Nellie Oggspire", online: false },
		{ number: "20000021", name: "Cressida Blume", online: false },
		{ number: "20000022", name: "Gladwin Moon", online: false },
		{ number: "20000023", name: "Sébastien Lemaire", online: false },
		{ number: "20000050", name: "Garreth Weasley", online: true },
		{ number: "20000099", name: "Ominous Stranger", online: false },
	];

	/// <summary>
	/// The player's correspondents. realNumber is what the server knows; known is false for one first reached by answering an unsigned letter.
	/// </summary>
	const contacts =
	[
		{ id: 1, realNumber: "20000002", name: "Natsai", known: true, favourite: true, avatarUrl: "" },
		{ id: 2, realNumber: "20000003", name: "Sebastian Sallow", known: true, favourite: false, avatarUrl: "" },
		{ id: 3, realNumber: "20000099", name: "Midnight Writer", known: false, favourite: false, avatarUrl: "" },
		{ id: 4, realNumber: "20000011", name: "Leander", known: true, favourite: false, avatarUrl: "" },
	];

	/// <summary>
	/// A correspondent as the server sends it (see ToDeskContact in Server/Mail.js).
	/// </summary>
	/// <param name="contact">Mock contact</param>
	/// <returns>Correspondent</returns>
	function ToDesk(contact)
	{
		const character = roster.find((entry) => entry.number === contact.realNumber);
		return { id: contact.id, number: contact.known ? contact.realNumber : "", name: contact.name, originalName: contact.known && character ? character.name : "", avatarUrl: config.avatars ? contact.avatarUrl : "", profileAvatarUrl: "", favourite: contact.favourite };
	}

	/// <summary>
	/// Fold a name for searching; same as Server/Roster.js.
	/// </summary>
	/// <param name="text">Name or search</param>
	/// <returns>Folded text</returns>
	function Fold(text)
	{
		return String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i").toLowerCase().replace(/\s+/g, " ").trim();
	}

	/// <summary>
	/// How well a name matches a folded search; same as Server/Roster.js.
	/// </summary>
	/// <param name="name">Name</param>
	/// <param name="query">Folded search</param>
	/// <returns>Rank, or -1</returns>
	function Rank(name, query)
	{
		const folded = Fold(name);
		const words = folded.split(" ");

		if (folded.startsWith(query))
		{
			return 0;
		}

		return query.split(" ").every((queryWord) => words.some((word) => word.startsWith(queryWord))) ? 1 : folded.includes(query) ? 2 : -1;
	}

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
		avatars: true,
		maxContacts: 250,
		maxAvatarUrlLength: 512,
		maxOfficialRecipients: 50,
		ui: { scale: 1 },
		languages: [],
		quietActivities: true,
	};

	let settings = { notificationSound: true, notificationVolume: 0.6, popups: true, sound: "", language: "", doNotDisturb: false, quietDuringActivities: true, showOriginalNames: false };
	let canPostOfficial = true;
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
	/// What the player calls an owl number, for the sent box: their correspondent's name, or "" for someone else.
	/// </summary>
	/// <param name="number">Owl number</param>
	/// <returns>Name, or ""</returns>
	function GetCorrespondentName(number)
	{
		const contact = contacts.find((entry) => entry.realNumber === number);
		return contact ? contact.name : "";
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
			recipients: box === "sent" ? letter.to.map(GetCorrespondentName) : [],
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
		case "mail.place":
			return { ok: true, data: { post: isAtPost ? post : null } };
		case "mail.search":
		{
			const query = Fold(data.query);

			if (query.length < 2)
			{
				return { ok: true, data: { query, owls: [], isComplete: false } };
			}

			const matches = roster.map((owl) => ({ owl, rank: Rank(owl.name, query) })).filter((match) => match.rank >= 0).sort((first, second) => first.rank - second.rank || Fold(first.owl.name).localeCompare(Fold(second.owl.name)));
			console.log(`ImmersiveMock: searched the roster for "${query}"`);
			return { ok: true, data: { query, owls: matches.slice(0, 12).map((match) => ({ number: match.owl.number, name: match.owl.name, online: match.owl.online })), isComplete: matches.length <= 12 } };
		}
		case "mail.send":
		case "mail.sendOfficial":
		{
			const isOfficial = action === "mail.sendOfficial";

			if (isOfficial && !canPostOfficial)
			{
				return { ok: false, errorKey: "error.mail.officialDenied" };
			}

			if (!isOfficial && config.writeMode === "postonly" && !isAtPost)
			{
				return { ok: false, errorKey: "error.mail.writeAtPost" };
			}

			if (isOfficial && data.everyone)
			{
				return { ok: true, data: { everyone: true, sent: 1, failed: [], clientKey: data.clientKey } };
			}

			// Number -> { name, saveAs, known }, as Server/Mail.js resolves them.
			const targets = new Map();

			if (data.replyToId)
			{
				const answered = letters.find((entry) => entry.id === data.replyToId);
				targets.set(answered.sender, { name: data.replyLabel || "", saveAs: answered.official ? "" : data.replyLabel || "", known: false });
			}

			for (const recipient of data.recipients || [])
			{
				const contact = recipient.contactId ? contacts.find((entry) => entry.id === recipient.contactId) : null;
				const character = contact ? null : roster.find((entry) => entry.number === recipient.number);

				if (!contact && !character)
				{
					return { ok: false, errorKey: "error.mail.unknownRecipient" };
				}

				targets.set(contact ? contact.realNumber : character.number, contact ? { name: contact.name, saveAs: "", known: contact.known } : { name: character.name, saveAs: character.name, known: true });
			}

			let sent = 0;
			const failed = [];
			const added = [];

			// Poppy has blocked Harriet in this mock, to show a letter that reaches only some of its recipients.
			for (const [number, target] of targets)
			{
				if (number === "20000004" && !isOfficial)
				{
					failed.push({ name: target.name, errorKey: "error.undeliverable" });
					continue;
				}

				++sent;

				if (isOfficial)
				{
					continue;
				}

				letters.push({ id: nextId++, sender: me.number, to: [number], text: data.body, sentAt: Date.now(), isRead: true });

				if (target.saveAs && !contacts.some((contact) => contact.realNumber === number))
				{
					const contact = { id: nextId++, realNumber: number, name: target.saveAs, known: target.known, favourite: false, avatarUrl: "" };
					contacts.push(contact);
					added.push(ToDesk(contact));
				}
			}

			return sent > 0 ? { ok: true, data: { everyone: false, sent, failed, contacts: added, clientKey: data.clientKey } } : { ok: false, errorKey: failed[0].errorKey };
		}
		case "mail.addCorrespondent":
		{
			const character = roster.find((entry) => entry.number === data.number);
			const existing = contacts.find((entry) => entry.realNumber === data.number);

			if (!character)
			{
				return { ok: false, errorKey: "error.mail.unknownRecipient" };
			}

			if (existing)
			{
				return existing.known ? { ok: false, errorKey: "error.contactNumberTaken", errorParams: { name: existing.name } } : { ok: false, errorKey: "error.mail.alreadyCorrespondent" };
			}

			const contact = { id: nextId++, realNumber: character.number, name: character.name, known: true, favourite: false, avatarUrl: "" };
			contacts.push(contact);
			return { ok: true, data: { contact: ToDesk(contact) } };
		}
		case "contacts.update":
		{
			const contact = contacts.find((entry) => entry.id === data.contactId);
			const name = String(data.name || "").trim();

			if (!contact)
			{
				return { ok: false, errorKey: "error.contactGone" };
			}

			if (!name)
			{
				return { ok: false, errorKey: "error.contactNameMissing" };
			}

			contact.name = name.slice(0, config.maxNameLength);

			if (data.avatarUrl !== undefined)
			{
				const url = String(data.avatarUrl || "").trim();

				if (url && !/^https:\/\//.test(url))
				{
					return { ok: false, errorKey: "error.pictureHttps" };
				}

				contact.avatarUrl = url;
			}

			return { ok: true, data: { contact: ToDesk(contact) } };
		}
		case "contacts.favourite":
		{
			const contact = contacts.find((entry) => entry.id === data.contactId);

			if (!contact)
			{
				return { ok: false, errorKey: "error.contactGone" };
			}

			contact.favourite = data.favourite === true;
			return { ok: true, data: { contactId: contact.id, favourite: contact.favourite } };
		}
		case "contacts.delete":
		{
			const index = contacts.findIndex((entry) => entry.id === data.contactId);

			if (index < 0)
			{
				return { ok: false, errorKey: "error.contactGone" };
			}

			contacts.splice(index, 1);
			return { ok: true, data: { contactId: data.contactId } };
		}
		case "mail.officialSenders":
			return canPostOfficial ? { ok: true, data: { senders: [{ number: "00000001", name: "Ministry of Magic" }, { number: "00000002", name: "Gringotts Wizarding Bank" }] } } : { ok: false, errorKey: "error.mail.officialDenied" };
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
					{ type: "state:reset", data: { me: { name: me.name, canPostOfficial }, settings, config, quiet: { active: false, label: "" }, unread, serverNow: Date.now() } },
					{ type: "contacts:chunk", data: { reset: true, contacts: contacts.map(ToDesk) } },
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

	/// <summary>
	/// Send the page its whole state again, as the server does after a mode or permission change.
	/// </summary>
	function Reload()
	{
		Push([{ type: "state:reset", data: { me: { name: me.name, canPostOfficial }, settings, config, quiet: { active: false, label: "" }, unread: 0, serverNow: Date.now() } }, { type: "contacts:chunk", data: { reset: true, contacts: contacts.map(ToDesk) } }, { type: "state:ready", data: {} }]);
	}

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
			Reload();
		},
		SetOfficial: (value = true) =>
		{
			canPostOfficial = value;
			Reload();
		},
		SetAvatars: (value = true) =>
		{
			config.avatars = value;
			Reload();
		},
		AddContact: (name = "Madam Malkin", known = true) =>
		{
			const character = { number: String(20000100 + nextId), name, online: false };
			roster.push(character);
			const contact = { id: nextId++, realNumber: character.number, name, known, favourite: false, avatarUrl: "" };
			contacts.push(contact);
			Push([{ type: "contact:upsert", data: { contact: ToDesk(contact) } }]);
		},
		AtPost: (value = true) =>
		{
			isAtPost = value;
			Push([{ type: "ui:open", data: { post: isAtPost ? post : null } }]);
		},
		PostHere: (id = "hogsmeade", isTaken = false) =>
		{
			const definition = { id, label: "Hogsmeade Owl Post", position: { x: 1234, y: -568, z: 90 }, areaId: "Overland", regionId: "HM_Village", radiusMetres: 3, yaw: 91.2 };

			if (!isOpen)
			{
				window.OwlsDev.Open();
			}

			Push([{ type: "admin:postDefinition", data: { id, json: JSON.stringify(definition, null, "	"), isTaken } }]);
		},
	};
})();
