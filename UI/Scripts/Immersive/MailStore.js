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
	const defaultSettings = Object.freeze({ notificationSound: true, notificationVolume: 0.6, popups: true, sound: "", language: "", doNotDisturb: false, quietDuringActivities: true });

	/// <summary>
	/// localStorage key of the letters being written, so a closed desk (or a reconnect) does not lose them, and how many are kept.
	/// Drafts stay in the page only and never reach the server, like the phone's.
	/// </summary>
	const draftStorageKey = "frantic-owls:letter-drafts";
	const maxDrafts = 10;

	const state =
	{
		isReady: false,
		me: { name: "" },
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
		state.isReady = false;
		state.me = { name: String(data.me && data.me.name || "") };
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
	/// <param name="data">{ reset, contacts: [{ id, number, name }] }</param>
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
	/// Add or replace one correspondent.
	/// </summary>
	/// <param name="contact">{ id, number, name }</param>
	function UpsertContact(contact)
	{
		if (!contact || !contact.number)
		{
			return;
		}

		const clean = { id: Number(contact.id) || 0, number: String(contact.number), name: String(contact.name || "") };
		const index = state.contacts.findIndex((entry) => entry.number === clean.number);

		if (index >= 0)
		{
			state.contacts[index] = clean;
		}
		else
		{
			state.contacts.push(clean);
		}

		state.contacts.sort((first, second) => Owls.Util.CompareNames(first.name, second.name));
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
	/// The name the player knows an owl number by, if it is one of their correspondents.
	/// </summary>
	/// <param name="number">Owl number</param>
	/// <returns>Name, or ""</returns>
	function GetContactName(number)
	{
		const contact = state.contacts.find((entry) => entry.number === number);
		return contact ? contact.name : "";
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
	/// <param name="key">"new" for a new letter, "reply:{id}" for an answer to a letter</param>
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

	return { state, Subscribe, Reset, Clear, SetReady, ApplyContactsChunk, UpsertContact, RemoveContact, GetContactName, ApplyPage, ApplyOpened, NoteArrival, NoteSent, SetPost, SetSettings, SetQuiet, CanWrite, UsesPosts, LoadDraft, SaveDraft };
})();
