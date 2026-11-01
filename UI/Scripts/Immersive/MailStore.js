// FranticDreamer 2026
"use strict";

window.Owls = window.Owls || {};

// ========================
// Mail Store
// ========================

/// <summary>
/// Everything the letter desk knows: the player, their settings, their correspondents and the letters listed so far.
///
/// <para>
/// NOTE: Correspondents are kept by contact ID, not owl number. One saved without knowing who they are (first reached by answering an unsigned letter) arrives without a number,
/// so the desk cannot match them to a character found by name; only correspondents with a number are matched, and left out of the names a search finds.
/// </para>
///
/// <para>
/// NOTE: Letters are fetched a page at a time and only as the server allows. A letter that may not be read where the player stands
/// arrives without its excerpt (isReadable false), and its text never arrives at all until it may be read.
/// The store therefore never guesses what a letter says; it shows what the server sent.
/// </para>
///
/// </summary>
Owls.MailStore = (() =>
{
	/// <summary>
	/// Player settings used until the server sends the saved ones. Same keys as the phone's, so both front ends share one row.
	/// </summary>
	const defaultSettings = Object.freeze({ notificationSound: true, notificationVolume: 0.6, popups: true, sound: "", language: "", doNotDisturb: false, quietDuringActivities: true, showOriginalNames: false });

	/// <summary>
	/// localStorage key of the letters being written, so a closed desk (or a reconnect) does not lose them, and how many are kept.
	/// Drafts stay in the page only and never reach the server, like the phone's.
	/// </summary>
	const draftStorageKey = "frantic-owls:letter-drafts";
	const maxDrafts = 10;

	const state =
	{
		isReady: false,
		me: { name: "", canPostOfficial: false },
		settings: { ...defaultSettings },
		config: {},
		quiet: { active: false, label: "" },
		unread: 0,
		contacts: [],
		post: null,
		boxes:
		{
			inbox: { letters: [], hasMore: false, isLoaded: false },
			sent: { letters: [], hasMore: false, isLoaded: false },
		},
	};

	const listeners = new Set();

	/// <summary>
	/// Parcel statuses pushed by the server, by letter ID, so a letter fetched before the push still shows the new one.
	/// </summary>
	const parcels = new Map();

	/// <summary>
	/// Tell every subscriber that something changed.
	/// </summary>
	/// <param name="reason">Short tag of what changed (e.g. "letters", "settings")</param>
	function Notify(reason)
	{
		for (const listener of listeners)
		{
			listener(reason);
		}
	}

	/// <summary>
	/// Listen for changes.
	/// </summary>
	/// <param name="listener">Function receiving the reason</param>
	/// <returns>Function that stops listening</returns>
	function Subscribe(listener)
	{
		listeners.add(listener);
		return () => listeners.delete(listener);
	}

	/// <summary>
	/// Take the state the server sends after a character loads.
	/// </summary>
	/// <param name="data">{ me, settings, config, quiet, unread }</param>
	function Reset(data)
	{
		const me = data.me || {};
		state.isReady = false;
		state.me = { name: String(me.name || ""), canPostOfficial: me.canPostOfficial === true };
		state.settings = { ...defaultSettings, ...(data.settings || {}) };
		state.config = data.config || {};
		state.quiet = data.quiet || { active: false, label: "" };
		state.unread = Math.max(0, Number(data.unread) || 0);
		state.contacts = [];
		state.post = null;
		state.boxes.inbox = { letters: [], hasMore: false, isLoaded: false };
		state.boxes.sent = { letters: [], hasMore: false, isLoaded: false };
		Owls.Bridge.SetTimeout(state.config.requestTimeoutMs);
		Notify("reset");
	}

	/// <summary>
	/// Forget everything, when the character unloads.
	/// </summary>
	function Clear()
	{
		Reset({});
	}

	/// <summary>
	/// Mark the state as complete.
	/// </summary>
	function SetReady()
	{
		state.isReady = true;
		Notify("ready");
	}

	/// <summary>
	/// Take one chunk of the correspondent list.
	/// </summary>
	/// <param name="data">{ reset, contacts: [{ id, number, name, originalName, avatarUrl, profileAvatarUrl, favourite }] }</param>
	function ApplyContactsChunk(data)
	{
		if (data.reset)
		{
			state.contacts = [];
		}

		for (const contact of Array.isArray(data.contacts) ? data.contacts : [])
		{
			UpsertContact(contact);
		}

		Notify("contacts");
	}

	/// <summary>
	/// Order correspondents for every list: favourites first, then by name.
	/// </summary>
	function SortContacts()
	{
		state.contacts.sort((first, second) => Number(second.favourite) - Number(first.favourite) || Owls.Util.CompareNames(first.name, second.name));
	}

	/// <summary>
	/// Add or replace one correspondent.
	/// </summary>
	/// <param name="contact">{ id, number, name, originalName, avatarUrl, profileAvatarUrl, favourite } where number is "" for a correspondent saved without knowing who they are</param>
	function UpsertContact(contact)
	{
		const id = Number(contact && contact.id) || 0;

		if (id <= 0)
		{
			return;
		}

		const clean =
		{
			id,
			number: String(contact.number || ""),
			name: String(contact.name || ""),
			originalName: String(contact.originalName || ""),
			avatarUrl: String(contact.avatarUrl || ""),
			profileAvatarUrl: String(contact.profileAvatarUrl || ""),
			favourite: contact.favourite === true,
		};
		const index = state.contacts.findIndex((entry) => entry.id === id);

		if (index >= 0)
		{
			state.contacts[index] = clean;
		}
		else
		{
			state.contacts.push(clean);
		}

		SortContacts();
	}

	/// <summary>
	/// Add or replace one correspondent and tell the screens.
	/// </summary>
	/// <param name="contact">Correspondent, as for UpsertContact</param>
	function SaveContact(contact)
	{
		UpsertContact(contact);
		Notify("contacts");
	}

	/// <summary>
	/// Forget a correspondent.
	/// </summary>
	/// <param name="contactId">Contact ID</param>
	function RemoveContact(contactId)
	{
		state.contacts = state.contacts.filter((contact) => contact.id !== contactId);
		Notify("contacts");
	}

	/// <summary>
	/// Find a correspondent by contact ID.
	/// </summary>
	/// <param name="contactId">Contact ID</param>
	/// <returns>Correspondent, or null</returns>
	function GetContact(contactId)
	{
		return state.contacts.find((contact) => contact.id === contactId) || null;
	}

	/// <summary>
	/// The owl numbers of correspondents whose characters the player knows, so a search can leave them out.
	/// </summary>
	/// <returns>Set of owl numbers</returns>
	function GetKnownNumbers()
	{
		return new Set(state.contacts.filter((contact) => contact.number).map((contact) => contact.number));
	}

	/// <summary>
	/// The name a correspondent is listed by: the name the player gave them, and, with showOriginalNames on, their character's own name in parentheses where it differs.
	/// </summary>
	/// <param name="contact">Correspondent</param>
	/// <returns>Label</returns>
	function GetContactLabel(contact)
	{
		const original = contact.originalName;
		return state.settings.showOriginalNames && original && original !== contact.name ? `${contact.name} (${original})` : contact.name;
	}

	/// <summary>
	/// The picture of a correspondent: the one the player set, otherwise the one they set for themselves, when the server allows pictures (immersivemode_avatars).
	/// </summary>
	/// <param name="contact">Correspondent</param>
	/// <returns>Picture link, or ""</returns>
	function GetContactPicture(contact)
	{
		return state.config.avatars ? contact.avatarUrl || contact.profileAvatarUrl : "";
	}

	/// <summary>
	/// Take one page of letters from the server.
	/// </summary>
	/// <param name="page">{ box, beforeId, letters, hasMore, post, unread }</param>
	function ApplyPage(page)
	{
		const box = state.boxes[page.box];

		if (!box)
		{
			return;
		}

		const letters = Array.isArray(page.letters) ? page.letters : [];

		// The newest page replaces the list (readability may have changed since); an older page is added below it.
		box.letters = Number(page.beforeId) > 0 ? [...box.letters.filter((letter) => !letters.some((fresh) => fresh.id === letter.id)), ...letters] : letters;
		box.hasMore = !!page.hasMore;
		box.isLoaded = true;
		state.post = page.post || null;
		state.unread = Math.max(0, Number(page.unread) || 0);
		Notify("letters");
	}

	/// <summary>
	/// Replace one listed letter with the fuller copy the server sent when it was opened.
	/// </summary>
	/// <param name="letter">Opened letter</param>
	/// <param name="unread">Unread count after opening it</param>
	function ApplyOpened(letter, unread)
	{
		const box = state.boxes[letter.box];

		if (box)
		{
			const index = box.letters.findIndex((entry) => entry.id === letter.id);

			if (index >= 0)
			{
				box.letters[index] = { ...box.letters[index], isUnread: false, isReadable: true, readProblem: "", excerpt: letter.excerpt || box.letters[index].excerpt };
			}
		}

		state.unread = Math.max(0, Number(unread) || 0);
		Notify("letters");
	}

	/// <summary>
	/// Note that a letter arrived. Its details come with the next page of the inbox.
	/// </summary>
	function NoteArrival()
	{
		state.unread += 1;
		state.boxes.inbox.isLoaded = false;
		Notify("arrived");
	}

	/// <summary>
	/// Note that letters were sent, so the sent box is fetched again when next shown.
	/// </summary>
	function NoteSent()
	{
		state.boxes.sent.isLoaded = false;
		Notify("sent");
	}

	/// <summary>
	/// Set the owl post the desk was opened at.
	/// </summary>
	/// <param name="post">{ id, label }, or null</param>
	function SetPost(post)
	{
		state.post = post && post.id ? { id: String(post.id), label: String(post.label || "") } : null;
		Notify("post");
	}

	/// <summary>
	/// Take the player's saved settings.
	/// </summary>
	/// <param name="settings">Full settings object</param>
	function SetSettings(settings)
	{
		state.settings = { ...defaultSettings, ...(settings || {}) };
		Notify("settings");
	}

	/// <summary>
	/// Take whether a quiet activity (a duel) is running.
	/// </summary>
	/// <param name="quiet">{ active, label }</param>
	function SetQuiet(quiet)
	{
		state.quiet = quiet || { active: false, label: "" };
		Notify("quiet");
	}

	/// <summary>
	/// Take a letter's parcel's new status (collected, or returned to the sender), wherever the desk lists or shows that letter.
	/// </summary>
	/// <param name="messageId">ID of the letter carrying it</param>
	/// <param name="parcel">{ galleons, status } or null</param>
	function SetParcel(messageId, parcel)
	{
		parcels.set(messageId, parcel);

		for (const box of Object.values(state.boxes))
		{
			for (const letter of box.letters)
			{
				if (letter.id === messageId)
				{
					letter.parcel = parcel;
				}
			}
		}

		Notify("parcel");
	}

	/// <summary>
	/// A letter's parcel as last heard of: a status pushed since the letter was fetched wins over the fetched one.
	/// </summary>
	/// <param name="letter">Letter as fetched or listed</param>
	/// <returns>{ galleons, status } or null</returns>
	function GetParcel(letter)
	{
		return parcels.has(letter.id) ? parcels.get(letter.id) : letter.parcel || null;
	}

	/// <summary>
	/// Take whether the player may write official letters, which the server checks again each time the desk opens.
	/// </summary>
	/// <param name="canPostOfficial">Whether they may</param>
	function SetCanPostOfficial(canPostOfficial)
	{
		if (state.me.canPostOfficial === canPostOfficial)
		{
			return;
		}

		state.me = { ...state.me, canPostOfficial };
		Notify("me");
	}

	/// <summary>
	/// Whether letters may be written where the player stands, as far as the page can tell. The server decides for certain.
	/// </summary>
	/// <returns>True when writing is allowed</returns>
	function CanWrite()
	{
		return state.config.writeMode !== "postonly" || !!state.post;
	}

	/// <summary>
	/// Whether the server ties reading or writing to owl posts at all, so the desk shows where the player stands.
	/// </summary>
	/// <returns>True when posts matter</returns>
	function UsesPosts()
	{
		return state.config.readMode !== "free" || state.config.writeMode !== "free";
	}

	/// <summary>
	/// Every saved draft, by key.
	/// </summary>
	/// <returns>Object of drafts (empty when there are none or storage is unavailable)</returns>
	function ReadDrafts()
	{
		// localStorage throws when the page has no storage (e.g. a private profile); a lost draft is a small loss.
		try
		{
			const raw = window.localStorage.getItem(draftStorageKey);
			const drafts = raw ? JSON.parse(raw) : null;
			return drafts && typeof drafts === "object" && !Array.isArray(drafts) ? drafts : {};
		}
		catch (error)
		{
			return {};
		}
	}

	/// <summary>
	/// A letter being written, as last saved.
	/// </summary>
	/// <param name="key">"new" for a new letter, "reply:{id}" for an answer to a letter, "official:{number}" for an official letter from that sender</param>
	/// <returns>Draft object, or null</returns>
	function LoadDraft(key)
	{
		const draft = ReadDrafts()[key];
		return draft && typeof draft === "object" ? draft : null;
	}

	/// <summary>
	/// Keep a letter being written, or forget it. Only the most recent drafts are kept.
	/// </summary>
	/// <param name="key">Draft key, as for LoadDraft</param>
	/// <param name="draft">Draft object, or null to forget it</param>
	function SaveDraft(key, draft)
	{
		const drafts = ReadDrafts();

		if (draft)
		{
			drafts[key] = draft;
		}
		else
		{
			delete drafts[key];
		}

		const kept = Object.entries(drafts).sort((first, second) => (Number(second[1].savedAt) || 0) - (Number(first[1].savedAt) || 0)).slice(0, maxDrafts);

		// See ReadDrafts.
		try
		{
			window.localStorage.setItem(draftStorageKey, JSON.stringify(Object.fromEntries(kept)));
		}
		catch (error)
		{
			// Nothing to do; the draft simply is not kept.
		}
	}

	return { state, Subscribe, Reset, Clear, SetReady, ApplyContactsChunk, UpsertContact, SaveContact, RemoveContact, GetContact, GetKnownNumbers, GetContactLabel, GetContactPicture, ApplyPage, ApplyOpened, NoteArrival, NoteSent, SetPost, SetSettings, SetQuiet, SetCanPostOfficial, SetParcel, GetParcel, CanWrite, UsesPosts, LoadDraft, SaveDraft };
})();
