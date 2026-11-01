// FranticDreamer 2026
"use strict";

window.Owls = window.Owls || {};

// ========================
// Store
// ========================

/// <summary>
/// The page's copy of the player's owl state: contacts, chats, loaded histories and unsent owls.
/// The server is the authority; this mirrors what it sent, plus optimistic pending messages.
/// Screens read from here and subscribe to change notifications instead of tracking state themselves.
/// </summary>
Owls.Store = (() =>
{
	const T = Owls.Lang.T;

	/// <summary>
	/// Default settings, used until the server's arrive.
	/// </summary>
	const defaultSettings = Object.freeze({ notificationSound: true, notificationVolume: 0.6, popups: true, sound: "", ringtone: "", ringtoneVolume: 0.8, callVolume: 1, readReceipts: true, typingIndicators: true, theme: "", layout: null, language: "", doNotDisturb: false, quietDuringActivities: true, wallpaperUrl: "", colourScheme: "default", animations: true, lockScreen: true, soundEffects: true, effectsVolume: 0.5, showOriginalNames: false });

	/// <summary>
	/// Delay that gathers unknown chat members into one profile lookup.
	/// </summary>
	const profileLookupDelayMs = 150;

	/// <summary>
	/// Browser storage key prefix of the drafts; the owl number follows, so each character keeps their own.
	/// </summary>
	const draftStorageKey = "frantic-owls:drafts:";

	/// <summary>
	/// Delay that gathers keystrokes into one write of the drafts to browser storage.
	/// </summary>
	const draftSaveDelayMs = 400;

	const state =
	{
		isReady: false,
		me: { number: "", name: "", avatarUrl: "" },
		config: {},
		settings: { ...defaultSettings },
		contacts: new Map(),
		contactsByNumber: new Map(),
		chats: new Map(),
		histories: new Map(),
		profiles: new Map(),
		profilesKnown: new Set(),
		blocked: new Set(),
		retired: new Set(),
		quiet: { active: false, label: "" },
		senders: new Map(),
		informRequests: new Map(),
		reads: new Map(),
		typing: new Map(),
		call: null,
		callEnd: null,
		callLog: [],
		shownLocation: null,
		drafts: new Map(),
		serverOffsetMs: 0,
	};

	const listeners = new Set();
	const profilesToLookUp = new Set();
	let profileLookupTimer = null;
	let draftSaveTimer = null;

	/// <summary>
	/// Tell every subscriber that something changed.
	/// </summary>
	/// <param name="reason">What changed (e.g. "contacts", "chats", "history:12"); subscribers may ignore reasons they do not draw</param>
	function Notify(reason)
	{
		for (const listener of listeners)
		{
			listener(reason);
		}
	}

	/// <summary>
	/// Rebuild the number lookup after the contact list changed.
	/// </summary>
	function ReindexContacts()
	{
		state.contactsByNumber.clear();

		for (const contact of state.contacts.values())
		{
			state.contactsByNumber.set(contact.number, contact);
		}
	}

	/// <summary>
	/// History record of a chat, created empty on first use.
	/// </summary>
	/// <param name="chatId">Chat ID</param>
	/// <returns>{ messages, pending, hasMore, isLoaded }</returns>
	function GetHistory(chatId)
	{
		if (!state.histories.has(chatId))
		{
			state.histories.set(chatId, { messages: [], pending: [], hasMore: false, isLoaded: false });
		}

		return state.histories.get(chatId);
	}

	// ========================
	// Lifecycle
	// ========================

	/// <summary>
	/// Start over with a fresh state from the server (character loaded or phone re-synced).
	/// </summary>
	/// <param name="data">{ me, settings, config }</param>
	function Reset(data)
	{
		const isSameOwl = state.me.number === (data.me && data.me.number);

		if (!isSameOwl)
		{
			SaveDraftsNow();
		}

		state.me = { number: "", name: "", avatarUrl: "", ...(data.me || {}) };
		state.config = data.config || {};
		state.settings = { ...defaultSettings, ...(data.settings || {}) };
		state.isReady = false;

		state.profiles.clear();
		state.profilesKnown.clear();
		state.blocked = new Set(data.blocks || []);
		state.retired = new Set(data.retired || []);
		state.quiet = { active: !!(data.quiet && data.quiet.active), label: String(data.quiet && data.quiet.label || "") };
		SetSenders(data.senders || []);
		SetServerTime(data.serverNow);

		// Keep unsent owls across a re-sync of the same character; drop everything for a different one.
		if (!isSameOwl)
		{
			state.histories.clear();
			LoadDrafts();
		}
		else
		{
			for (const history of state.histories.values())
			{
				history.messages = [];
				history.isLoaded = false;
				history.hasMore = false;
			}
		}

		Notify("reset");
	}

	/// <summary>
	/// Forget everything (character unloaded).
	/// </summary>
	function Clear()
	{
		// Written while the owl number is still known, since it names where the drafts are kept.
		SaveDraftsNow();
		state.isReady = false;
		state.me = { number: "", name: "", avatarUrl: "" };
		state.profiles.clear();
		state.profilesKnown.clear();
		state.contacts.clear();
		state.contactsByNumber.clear();
		state.chats.clear();
		state.histories.clear();
		state.informRequests.clear();
		state.reads.clear();
		state.typing.clear();
		state.retired.clear();
		state.call = null;
		state.callEnd = null;
		state.callLog = [];
		state.shownLocation = null;
		state.quiet = { active: false, label: "" };
		state.drafts.clear();
		Notify("reset");
	}

	/// <summary>
	/// Mark the initial sync as complete.
	/// </summary>
	function SetReady()
	{
		// The bootstrap carried the picture of every related owl that has one, so the rest are known to have none.
		for (const contact of state.contacts.values())
		{
			state.profilesKnown.add(contact.number);
		}

		for (const chat of state.chats.values())
		{
			for (const member of chat.members)
			{
				state.profilesKnown.add(member);
			}
		}

		state.isReady = true;
		Notify("ready");
	}

	// ========================
	// Drafts
	// ========================

	/// <summary>
	/// Read the current owl's drafts back from browser storage.
	///
	/// <para>
	/// NOTE: Drafts never leave this machine. They live in the page while it runs and in browser storage between sessions,
	/// which the game's browser may or may not keep; losing them only costs an unfinished owl, so nothing is sent to the server.
	/// </para>
	///
	/// </summary>
	function LoadDrafts()
	{
		state.drafts.clear();

		if (!state.me.number)
		{
			return;
		}

		// Storage can be switched off or full of something unreadable; the drafts then simply start empty.
		try
		{
			const saved = JSON.parse(window.localStorage.getItem(draftStorageKey + state.me.number) || "{}");

			for (const [chatId, text] of Object.entries(saved && typeof saved === "object" ? saved : {}))
			{
				if (Number(chatId) > 0 && typeof text === "string" && text.trim().length > 0)
				{
					state.drafts.set(Number(chatId), text);
				}
			}
		}
		catch (error)
		{
			state.drafts.clear();
		}

		Notify("drafts");
	}

	/// <summary>
	/// Write the current owl's drafts to browser storage at once, instead of waiting for the next quiet moment.
	/// </summary>
	function SaveDraftsNow()
	{
		clearTimeout(draftSaveTimer);
		draftSaveTimer = null;

		if (!state.me.number)
		{
			return;
		}

		// See LoadDrafts: without storage, drafts last as long as the page does.
		try
		{
			const key = draftStorageKey + state.me.number;

			if (state.drafts.size === 0)
			{
				window.localStorage.removeItem(key);
			}
			else
			{
				window.localStorage.setItem(key, JSON.stringify(Object.fromEntries(state.drafts)));
			}
		}
		catch (error)
		{
			return;
		}
	}

	/// <summary>
	/// Keep what the player has written but not sent in a chat, or forget it with an empty text.
	/// </summary>
	/// <param name="chatId">Chat ID</param>
	/// <param name="text">Composer text</param>
	function SetDraft(chatId, text)
	{
		const draft = String(text || "");
		const hadDraft = state.drafts.has(chatId);

		if (draft.trim().length === 0)
		{
			state.drafts.delete(chatId);
		}
		else
		{
			state.drafts.set(chatId, draft);
		}

		clearTimeout(draftSaveTimer);
		draftSaveTimer = setTimeout(SaveDraftsNow, draftSaveDelayMs);

		// The chat list only needs to hear when a chat gains or loses its draft, not about every keystroke.
		if (hadDraft !== state.drafts.has(chatId))
		{
			Notify("drafts");
		}
	}

	/// <summary>
	/// The unsent text kept for a chat.
	/// </summary>
	/// <param name="chatId">Chat ID</param>
	/// <returns>Draft text, or ""</returns>
	function GetDraft(chatId)
	{
		return state.drafts.get(chatId) || "";
	}

	// ========================
	// Server Time
	// ========================

	/// <summary>
	/// Remember how far the server's clock is from this machine's, so flight times are judged on the server's clock.
	/// </summary>
	/// <param name="serverNow">Server time in epoch milliseconds (ignored when missing)</param>
	function SetServerTime(serverNow)
	{
		if (Number(serverNow) > 0)
		{
			state.serverOffsetMs = Number(serverNow) - Date.now();
		}
	}

	/// <summary>
	/// Current time on the server's clock.
	/// </summary>
	/// <returns>Epoch milliseconds</returns>
	function GetServerNow()
	{
		return Date.now() + state.serverOffsetMs;
	}

	/// <summary>
	/// Whether an owl is still flying to its recipients.
	/// </summary>
	/// <param name="message">Message record</param>
	/// <returns>True until it lands</returns>
	function IsInFlight(message)
	{
		return Number(message.deliverAt) > GetServerNow();
	}

	// ========================
	// Message Kinds
	// ========================

	/// <summary>
	/// Whether a message is a note the server recorded about the chat (someone leaving) rather than an owl someone sent.
	/// </summary>
	/// <param name="message">Message record</param>
	/// <returns>True for notes</returns>
	function IsNote(message)
	{
		return !!message.kind && message.kind !== "text" && message.kind !== "location" && message.kind !== "poll";
	}

	/// <summary>
	/// Read the question and answers a poll carries.
	/// </summary>
	/// <param name="message">Message with kind "poll"</param>
	/// <returns>{ question, options, multiple }, or null if the body is not a usable poll (quotes and pins carry only the question)</returns>
	function ParsePoll(message)
	{
		// The body is JSON the server wrote; a damaged row should show as "unavailable", not break the chat.
		try
		{
			const raw = JSON.parse(String(message.body || ""));
			return raw && typeof raw.question === "string" && Array.isArray(raw.options) ? { question: raw.question, options: raw.options.map(String), multiple: raw.multiple === true } : null;
		}
		catch (error)
		{
			return null;
		}
	}

	/// <summary>
	/// Record the votes of a poll, as the server last counted them.
	/// </summary>
	/// <param name="chatId">Chat ID</param>
	/// <param name="messageId">Poll message ID</param>
	/// <param name="votes">[{ number, options }]</param>
	function SetPollVotes(chatId, messageId, votes)
	{
		const history = state.histories.get(chatId);
		const message = history ? history.messages.find((candidate) => candidate.id === messageId) : null;

		if (message)
		{
			message.votes = Array.isArray(votes) ? votes : [];
			Notify(`history:${chatId}`);
		}
	}

	/// <summary>
	/// Read the place a location owl carries.
	/// </summary>
	/// <param name="message">Message with kind "location"</param>
	/// <returns>{ place }, or null if the body is not a usable location</returns>
	function ParseLocation(message)
	{
		// The body is JSON the server wrote; a damaged row should show as "unavailable", not break the chat.
		try
		{
			const raw = JSON.parse(String(message.body || ""));
			return raw && typeof raw === "object" && [raw.x, raw.y, raw.z].every((value) => Number.isFinite(Number(value))) ? { place: String(raw.place || "") } : null;
		}
		catch (error)
		{
			return null;
		}
	}

	/// <summary>
	/// Remember which location owl is on the player's map. Each player has at most one.
	/// </summary>
	/// <param name="chatId">Chat ID of the location owl, or 0 when none is shown</param>
	/// <param name="messageId">Message ID of the location owl, or 0 when none is shown</param>
	function SetShownLocation(chatId, messageId)
	{
		state.shownLocation = chatId > 0 && messageId > 0 ? { chatId, messageId } : null;
		Notify("location");
	}

	/// <summary>
	/// Check whether a location owl is the one on the player's map.
	/// </summary>
	/// <param name="chatId">Chat ID</param>
	/// <param name="messageId">Message ID</param>
	/// <returns>True if it is shown</returns>
	function IsLocationShown(chatId, messageId)
	{
		return !!state.shownLocation && state.shownLocation.chatId === chatId && state.shownLocation.messageId === messageId;
	}

	/// <summary>
	/// What a message says in one line, for chat previews, search and pop-ups.
	/// </summary>
	/// <param name="message">Message record</param>
	/// <returns>Its text, a description of a location, or a note's line</returns>
	function GetMessageText(message)
	{
		if (Number(message.unsentAt) > 0)
		{
			return message.sender === state.me.number ? T("message.unsentPreview.you") : T("message.unsentPreview");
		}

		if (message.kind === "location")
		{
			const location = ParseLocation(message);
			return location && location.place ? `\u{1F4CD} ${T("message.locationPreviewPlace", { place: location.place })}` : `\u{1F4CD} ${T("message.locationPreview")}`;
		}

		// A whole poll is JSON; a quote or pin of one carries only its question.
		if (message.kind === "poll")
		{
			const poll = ParsePoll(message);
			return `\u{1F4CA} ${T("message.pollPreview", { question: poll ? poll.question : String(message.body || "") })}`;
		}

		return IsNote(message) ? GetNoteText(message) : String(message.body || "");
	}

	// ========================
	// Read Receipts & Typing
	// ========================

	/// <summary>
	/// Whether read receipts or typing indicators are on: for the server and in the player's settings.
	/// Turning one off also hides other owls', as the server stops sending them.
	/// </summary>
	/// <param name="key">"readReceipts" or "typingIndicators"</param>
	/// <returns>True when on</returns>
	function IsShared(key)
	{
		return state.config[key] !== false && state.settings[key] !== false;
	}

	/// <summary>
	/// Replace how far the other members of a chat have read (from the newest history page).
	/// </summary>
	/// <param name="chatId">Chat ID</param>
	/// <param name="reads">[{ number, messageId }]</param>
	function SetReads(chatId, reads)
	{
		state.reads.set(chatId, new Map(reads.map((read) => [read.number, Number(read.messageId)])));
		Notify(`history:${chatId}`);
	}

	/// <summary>
	/// Move one member's read marker forward.
	/// </summary>
	/// <param name="chatId">Chat ID</param>
	/// <param name="number">Member who read</param>
	/// <param name="messageId">Newest owl they have seen</param>
	function SetRead(chatId, number, messageId)
	{
		if (!state.reads.has(chatId))
		{
			state.reads.set(chatId, new Map());
		}

		const reads = state.reads.get(chatId);
		reads.set(number, Math.max(reads.get(number) || 0, Number(messageId)));
		Notify(`history:${chatId}`);
	}

	/// <summary>
	/// The other members known to have read an owl.
	/// </summary>
	/// <param name="chatId">Chat ID</param>
	/// <param name="messageId">Message ID</param>
	/// <returns>Owl numbers</returns>
	function GetReadBy(chatId, messageId)
	{
		const reads = state.reads.get(chatId);
		return reads ? [...reads].filter(([, read]) => read >= messageId).map(([number]) => number) : [];
	}

	/// <summary>
	/// Show that a member is typing for a while. Each new ping extends it.
	/// </summary>
	/// <param name="chatId">Chat ID</param>
	/// <param name="number">Typist</param>
	/// <param name="durationMs">How long it lasts without another ping</param>
	function SetTyping(chatId, number, durationMs)
	{
		if (!state.typing.has(chatId))
		{
			state.typing.set(chatId, new Map());
		}

		const expiresAt = Date.now() + Math.min(15000, Math.max(1000, Number(durationMs) || 5000));
		state.typing.get(chatId).set(number, expiresAt);
		setTimeout(() => Notify(`typing:${chatId}`), expiresAt - Date.now() + 50);
		Notify(`typing:${chatId}`);
	}

	/// <summary>
	/// Stop showing a member as typing (their owl arrived).
	/// </summary>
	/// <param name="chatId">Chat ID</param>
	/// <param name="number">Typist</param>
	function ClearTyping(chatId, number)
	{
		const typing = state.typing.get(chatId);

		if (typing && typing.delete(number))
		{
			Notify(`typing:${chatId}`);
		}
	}

	/// <summary>
	/// Who is typing in a chat right now.
	/// </summary>
	/// <param name="chatId">Chat ID</param>
	/// <returns>Owl numbers</returns>
	function GetTyping(chatId)
	{
		const typing = state.typing.get(chatId);

		if (!typing || !IsShared("typingIndicators"))
		{
			return [];
		}

		const now = Date.now();
		return [...typing].filter(([, expiresAt]) => expiresAt > now).map(([number]) => number);
	}

	/// <summary>
	/// "Bram is typing...", "Bram and Ada are typing..." or "3 owls are typing...".
	/// </summary>
	/// <param name="chatId">Chat ID</param>
	/// <param name="withNames">Name the typists (groups); a one-to-one chat just says "typing..."</param>
	/// <returns>Line, or "" when nobody is typing</returns>
	function GetTypingText(chatId, withNames)
	{
		const typists = GetTyping(chatId);

		if (typists.length === 0)
		{
			return "";
		}

		if (!withNames)
		{
			return T("typing.direct");
		}

		const names = typists.map(GetDisplayName);
		return typists.length === 1 ? T("typing.one", { name: names[0] }) : typists.length === 2 ? T("typing.two", { first: names[0], second: names[1] }) : T("typing.many", { count: typists.length });
	}

	// ========================
	// Inform Requests
	// ========================

	/// <summary>
	/// Replace the informs waiting for this owl's answer (sent with the bootstrap).
	/// </summary>
	/// <param name="list">Requests: { id, name, avatarUrl, expiresAt, canExchange }</param>
	function SetInformRequests(list)
	{
		state.informRequests.clear();

		for (const request of list)
		{
			state.informRequests.set(Number(request.id), request);
		}

		Notify("informs");
	}

	/// <summary>
	/// Add an inform that just arrived.
	/// </summary>
	/// <param name="request">Request record</param>
	function AddInformRequest(request)
	{
		state.informRequests.set(Number(request.id), request);
		Notify("informs");
	}

	/// <summary>
	/// Forget an answered or expired inform.
	/// </summary>
	/// <param name="id">Request ID</param>
	function RemoveInformRequest(id)
	{
		if (state.informRequests.delete(Number(id)))
		{
			Notify("informs");
		}
	}

	/// <summary>
	/// Informs still waiting for an answer, oldest first. Expired ones are dropped on the way.
	/// </summary>
	/// <returns>Request records</returns>
	function GetInformRequests()
	{
		const now = GetServerNow();

		for (const [id, request] of state.informRequests)
		{
			if (Number(request.expiresAt) <= now)
			{
				state.informRequests.delete(id);
			}
		}

		return [...state.informRequests.values()];
	}

	// ========================
	// Calls
	// ========================

	/// <summary>
	/// Record the call the player is in, as the server last described it, or that they are in none.
	/// </summary>
	/// <param name="call">{ id, number, direction, state, startedAt, answeredAt, expiresAt }, or null</param>
	function SetCall(call)
	{
		state.call = call && call.id ? { ...call } : null;

		if (state.call)
		{
			state.callEnd = null;

			if (state.isReady)
			{
				EnsureProfiles([state.call.number]);
			}
		}

		Notify("call");
	}

	/// <summary>
	/// Record that a call ended, so the call screen can say how before it closes.
	/// </summary>
	/// <param name="data">{ callId, outcome, endedBy, entry } from the server, or { callId, errorText } for a call that never got going</param>
	function EndCall(data)
	{
		const call = state.call && state.call.id === data.callId ? state.call : null;
		const entry = data.entry || null;
		const answeredAt = entry ? entry.answeredAt : call ? call.answeredAt : 0;
		const endedAt = entry ? entry.endedAt : GetServerNow();

		state.callEnd =
		{
			callId: data.callId,
			outcome: String(data.outcome || ""),
			isMine: data.endedBy === state.me.number,
			errorText: String(data.errorText || ""),
			durationMs: answeredAt > 0 ? endedAt - answeredAt : 0,
		};

		if (call || data.callId === 0)
		{
			state.call = null;
		}

		Notify("call");
	}

	/// <summary>
	/// Apply one chunk of the call log.
	/// </summary>
	/// <param name="data">{ reset, entries }</param>
	function ApplyCallsChunk(data)
	{
		if (data.reset)
		{
			state.callLog = [];
		}

		for (const entry of data.entries || [])
		{
			state.callLog.push(entry);
		}

		state.callLog.sort((first, second) => second.id - first.id);
		Notify("calls");
	}

	/// <summary>
	/// Add a call that just ended to the top of the log. A call already listed is ignored.
	/// </summary>
	/// <param name="entry">{ id, number, direction, outcome, startedAt, answeredAt, endedAt, isNew }</param>
	function AddCallEntry(entry)
	{
		if (!entry || state.callLog.some((known) => known.id === entry.id))
		{
			return;
		}

		state.callLog.unshift(entry);
		state.callLog.sort((first, second) => second.id - first.id);
		Notify("calls");
	}

	/// <summary>
	/// Take one call, or every call, out of the log.
	/// </summary>
	/// <param name="callId">Call log ID, or 0 for all</param>
	function RemoveCallEntries(callId)
	{
		state.callLog = callId > 0 ? state.callLog.filter((entry) => entry.id !== callId) : [];
		Notify("calls");
	}

	/// <summary>
	/// Clear the "new" mark of every missed call (the player looked at the log).
	/// </summary>
	function MarkCallsSeen()
	{
		for (const entry of state.callLog)
		{
			entry.isNew = false;
		}

		Notify("calls");
	}

	/// <summary>
	/// Missed calls the player has not looked at yet, for the badge on the Calls app.
	/// </summary>
	/// <returns>Count</returns>
	function GetMissedCallCount()
	{
		return state.callLog.filter((entry) => entry.isNew).length;
	}

	/// <summary>
	/// Whether the player can call an owl, and why not when they cannot. The server checks again; this only keeps hopeless buttons away.
	/// </summary>
	/// <param name="number">Owl number</param>
	/// <returns>{ canCall, reason }</returns>
	function GetCallState(number)
	{
		if (state.config.callsEnabled === false)
		{
			return { canCall: false, reason: T("error.callsOff") };
		}

		if (!number || number === state.me.number)
		{
			return { canCall: false, reason: T("error.callSelf") };
		}

		if (GetSender(number))
		{
			return { canCall: false, reason: T("error.callOfficial") };
		}

		if (IsRetired(number))
		{
			return { canCall: false, reason: T("error.retired") };
		}

		if (IsBlocked(number))
		{
			return { canCall: false, reason: T("error.callYouBlocked") };
		}

		return { canCall: true, reason: "" };
	}

	// ========================
	// Blocks, Mutes & Senders
	// ========================

	/// <summary>
	/// Whether this owl has blocked another.
	/// </summary>
	/// <param name="number">Owl number</param>
	/// <returns>True when blocked</returns>
	function IsBlocked(number)
	{
		return state.blocked.has(number);
	}

	/// <summary>
	/// Record a block or unblock confirmed by the server.
	/// </summary>
	/// <param name="number">Owl number</param>
	/// <param name="blocked">True when now blocked</param>
	function SetBlocked(number, blocked)
	{
		if (blocked)
		{
			state.blocked.add(number);
		}
		else
		{
			state.blocked.delete(number);
		}

		Notify("blocks");
	}

	/// <summary>
	/// Whether an owl's character was deleted, so it can never be owled again.
	/// </summary>
	/// <param name="number">Owl number</param>
	/// <returns>True for a retired owl</returns>
	function IsRetired(number)
	{
		return state.retired.has(number);
	}

	/// <summary>
	/// Record that an owl's character was deleted.
	/// </summary>
	/// <param name="number">Owl number</param>
	function SetRetired(number)
	{
		state.retired.add(number);
		Notify("retired");
	}

	/// <summary>
	/// Record whether a quiet activity (a duel, by default) is running for the player.
	/// </summary>
	/// <param name="quiet">{ active, label }</param>
	function SetQuiet(quiet)
	{
		state.quiet = { active: !!quiet.active, label: String(quiet.label || "") };
		Notify("quiet");
	}

	/// <summary>
	/// Whether the phone should stay silent right now: Do Not Disturb, or a quiet activity the player lets silence it.
	/// </summary>
	/// <returns>True while notifications are held back</returns>
	function IsQuiet()
	{
		return !!state.settings.doNotDisturb || (state.quiet.active && state.settings.quietDuringActivities !== false);
	}

	/// <summary>
	/// Replace the list of system senders (the Ministry and senders of other resources).
	/// </summary>
	/// <param name="list">[{ number, name, avatarUrl, acceptsReplies }]</param>
	function SetSenders(list)
	{
		state.senders = new Map(list.map((sender) => [sender.number, sender]));
		Notify("senders");
	}

	/// <summary>
	/// A system sender by owl number.
	/// </summary>
	/// <param name="number">Owl number</param>
	/// <returns>{ number, name, avatarUrl, acceptsReplies }, or null for a character's owl</returns>
	function GetSender(number)
	{
		return state.senders.get(number) || (String(number).startsWith("0") ? { number, name: T("sender.unknown"), avatarUrl: "", acceptsReplies: false } : null);
	}

	/// <summary>
	/// Whether a chat's notifications are silenced right now.
	/// </summary>
	/// <param name="chat">Chat summary</param>
	/// <returns>True while muted</returns>
	function IsMuted(chat)
	{
		return Number(chat.mutedUntil) > GetServerNow();
	}

	/// <summary>
	/// Record a chat's new mute time.
	/// </summary>
	/// <param name="chatId">Chat ID</param>
	/// <param name="mutedUntil">Epoch milliseconds on the server's clock; 0 when unmuted</param>
	function SetMuted(chatId, mutedUntil)
	{
		const chat = state.chats.get(chatId);

		if (chat)
		{
			chat.mutedUntil = mutedUntil;
			Notify("chats");
		}
	}

	/// <summary>
	/// Whether the player can write in a chat: not in channels, and only to system senders that take replies.
	/// </summary>
	/// <param name="chat">Chat summary</param>
	/// <returns>{ canWrite, reason } where reason explains a read-only chat</returns>
	function GetWriteState(chat)
	{
		if (chat.kind === "channel")
		{
			return { canWrite: false, reason: T("error.announcementsReadOnly") };
		}

		if (chat.kind === "direct")
		{
			const other = GetOtherMember(chat);
			const sender = GetSender(other);

			if (sender && !sender.acceptsReplies)
			{
				return { canWrite: false, reason: T("chat.officialReadOnly") };
			}

			if (IsRetired(other))
			{
				return { canWrite: false, reason: T("chat.retiredReadOnly") };
			}
		}

		return { canWrite: true, reason: "" };
	}

	// ========================
	// Profile Pictures
	// ========================

	/// <summary>
	/// Apply one chunk of the visible profile pictures.
	/// </summary>
	/// <param name="data">{ reset, profiles: [{ number, avatarUrl }] }</param>
	function ApplyProfilesChunk(data)
	{
		if (data.reset)
		{
			state.profiles.clear();
		}

		for (const profile of data.profiles || [])
		{
			state.profiles.set(profile.number, profile.avatarUrl);
			state.profilesKnown.add(profile.number);
		}

		Notify("profiles");
	}

	/// <summary>
	/// Record an owl's own picture (an empty link means they have none).
	/// </summary>
	/// <param name="number">Owl number</param>
	/// <param name="avatarUrl">Their picture link</param>
	function SetProfile(number, avatarUrl)
	{
		if (number === state.me.number)
		{
			state.me.avatarUrl = avatarUrl;
		}

		state.profiles.set(number, avatarUrl);
		state.profilesKnown.add(number);
		Notify("profiles");
	}

	/// <summary>
	/// Ask the server for the pictures of owls this page has never heard of, e.g. members of a chat that started after loading.
	/// Requests are gathered for a moment so a new group costs one lookup.
	/// </summary>
	/// <param name="numbers">Owl numbers</param>
	function EnsureProfiles(numbers)
	{
		for (const number of numbers)
		{
			// System senders' pictures come with the sender list, not from profiles.
			if (number !== state.me.number && !number.startsWith("0") && !state.profilesKnown.has(number))
			{
				state.profilesKnown.add(number);
				profilesToLookUp.add(number);
			}
		}

		if (profilesToLookUp.size === 0 || profileLookupTimer !== null)
		{
			return;
		}

		profileLookupTimer = setTimeout(async () =>
		{
			profileLookupTimer = null;
			const batch = [...profilesToLookUp];
			profilesToLookUp.clear();

			const result = await Owls.Bridge.Request("profiles.lookup", { numbers: batch });

			if (result.ok)
			{
				for (const profile of result.data.profiles || [])
				{
					state.profiles.set(profile.number, profile.avatarUrl);
				}

				Notify("profiles");
			}
		}, profileLookupDelayMs);
	}

	/// <summary>
	/// The picture an owl chose for themselves, ignoring any override.
	/// </summary>
	/// <param name="number">Owl number</param>
	/// <returns>Picture link, or an empty string when they have none</returns>
	function GetProfileAvatarUrl(number)
	{
		if (number === state.me.number)
		{
			return state.me.avatarUrl || "";
		}

		const sender = GetSender(number);

		if (sender)
		{
			return sender.avatarUrl || "";
		}

		// A live update (profiles map) is newer than the copy that came with the contact record.
		if (state.profiles.has(number))
		{
			return state.profiles.get(number);
		}

		const contact = state.contactsByNumber.get(number);
		return contact ? contact.profileAvatarUrl || "" : "";
	}

	/// <summary>
	/// The picture to show for an owl: your override for that contact, otherwise the picture they chose for themselves.
	/// </summary>
	/// <param name="number">Owl number</param>
	/// <returns>Picture link, or an empty string for initials</returns>
	function GetAvatarUrl(number)
	{
		const contact = state.contactsByNumber.get(number);

		if (contact && contact.avatarUrl && number !== state.me.number)
		{
			return contact.avatarUrl;
		}

		return GetProfileAvatarUrl(number);
	}

	/// <summary>
	/// The theme in effect: the player's choice, or the server default when they have not chosen.
	/// </summary>
	/// <returns>"muggle" or "parchment"</returns>
	function GetTheme()
	{
		const ui = state.config.ui || {};
		return state.settings.theme || ui.defaultTheme || "muggle";
	}

	/// <summary>
	/// The Muggle Phone theme's colour scheme in effect.
	/// </summary>
	/// <returns>"default", "gryffindor", "slytherin", "ravenclaw" or "hufflepuff"</returns>
	function GetColourScheme()
	{
		return state.settings.colourScheme || "default";
	}

	// ========================
	// Contacts
	// ========================

	/// <summary>
	/// Apply one chunk of the contact list.
	/// </summary>
	/// <param name="data">{ reset, contacts }</param>
	function ApplyContactsChunk(data)
	{
		if (data.reset)
		{
			state.contacts.clear();
		}

		for (const contact of data.contacts || [])
		{
			state.contacts.set(contact.id, contact);
		}

		ReindexContacts();
		Notify("contacts");
	}

	/// <summary>
	/// Add or replace one contact.
	/// </summary>
	/// <param name="contact">Contact record</param>
	function UpsertContact(contact)
	{
		state.contacts.set(contact.id, contact);
		ReindexContacts();
		Notify("contacts");
	}

	/// <summary>
	/// Remove one contact.
	/// </summary>
	/// <param name="contactId">Contact ID</param>
	function RemoveContact(contactId)
	{
		state.contacts.delete(contactId);
		ReindexContacts();
		Notify("contacts");
	}

	/// <summary>
	/// Contacts sorted alphabetically, optionally filtered by a search query.
	/// </summary>
	/// <param name="query">Search query (optional)</param>
	/// <returns>Contact records</returns>
	function GetSortedContacts(query = "")
	{
		return [...state.contacts.values()].filter((contact) => Owls.Util.Matches(contact.name, query) || (!!contact.originalName && Owls.Util.Matches(contact.originalName, query))).sort((first, second) => Owls.Util.CompareNames(first.name, second.name));
	}

	/// <summary>
	/// The name a contact is shown by: the name the player saved, and, with showOriginalNames on, the character's own name in parentheses where it differs.
	/// The server only sends originalName for contacts whose character the player knows (an Inform, or another resource introducing them), never for a typed-in number.
	/// </summary>
	/// <param name="contact">Contact record</param>
	/// <returns>Label</returns>
	function GetContactLabel(contact)
	{
		const original = contact.originalName;
		return state.settings.showOriginalNames && original && original !== contact.name ? `${contact.name} (${original})` : contact.name;
	}

	/// <summary>
	/// Favourite contacts, alphabetically, optionally filtered by a search query.
	/// </summary>
	/// <param name="query">Search query (optional)</param>
	/// <returns>Contact records</returns>
	function GetFavouriteContacts(query = "")
	{
		return GetSortedContacts(query).filter((contact) => contact.favourite);
	}

	// ========================
	// Chats
	// ========================

	/// <summary>
	/// Apply one chunk of the chat list.
	/// </summary>
	/// <param name="data">{ reset, chats }</param>
	function ApplyChatsChunk(data)
	{
		if (data.reset)
		{
			state.chats.clear();
		}

		for (const chat of data.chats || [])
		{
			state.chats.set(chat.id, chat);
		}

		Notify("chats");
	}

	/// <summary>
	/// Add a chat or update the descriptive fields of a known one, keeping its unread count and last message.
	/// </summary>
	/// <param name="chat">Full summary or descriptor ({ id, kind, title, members, ... })</param>
	/// <returns>The stored chat</returns>
	function UpsertChat(chat)
	{
		const known = state.chats.get(chat.id);
		const merged =
		{
			unread: 0,
			lastMessage: null,
			...(known || {}),
			...chat,
		};

		if (known && chat.unread === undefined)
		{
			merged.unread = known.unread;
		}

		if (known && chat.lastMessage === undefined)
		{
			merged.lastMessage = known.lastMessage;
		}

		merged.lastActivityAt = Math.max(Number(known ? known.lastActivityAt : 0), Number(chat.lastActivityAt || 0));
		state.chats.set(chat.id, merged);

		if (state.isReady)
		{
			EnsureProfiles(merged.members);
		}

		Notify("chats");
		return merged;
	}

	/// <summary>
	/// Forget a chat and its history (e.g. after leaving a bulk owl).
	/// </summary>
	/// <param name="chatId">Chat ID</param>
	function RemoveChat(chatId)
	{
		state.chats.delete(chatId);
		state.histories.delete(chatId);
		state.reads.delete(chatId);
		state.typing.delete(chatId);

		if (state.drafts.has(chatId))
		{
			SetDraft(chatId, "");
		}

		Notify("chats");
	}

	/// <summary>
	/// Record that a chat was pinned to the top of the list, or unpinned.
	/// </summary>
	/// <param name="chatId">Chat ID</param>
	/// <param name="pinnedAt">Epoch milliseconds; 0 when unpinned</param>
	function SetChatPinned(chatId, pinnedAt)
	{
		const chat = state.chats.get(chatId);

		if (chat)
		{
			chat.pinnedAt = Number(pinnedAt) || 0;
			Notify("chats");
		}
	}

	/// <summary>
	/// Whether the player is an admin of a bulk owl.
	/// </summary>
	/// <param name="chat">Chat summary</param>
	/// <returns>True for admins of groups</returns>
	function IsAdmin(chat)
	{
		return chat.kind === "group" && (chat.admins || []).includes(state.me.number);
	}

	/// <summary>
	/// The line shown for a note the server recorded about a chat, as opposed to an owl someone wrote.
	///
	/// <para>
	/// NOTE: Each note has its own wording for "you did it" (".you") and "it was done to you" (".toYou"),
	/// because many languages cannot build those by dropping "you" into the general sentence.
	/// </para>
	///
	/// </summary>
	/// <param name="message">Message with a kind other than "text"</param>
	/// <returns>Note text (e.g. "Bram Bones left.")</returns>
	function GetNoteText(message)
	{
		let details = {};

		// A note's body is JSON the server wrote; an unreadable one still gets its line, just without details.
		try
		{
			details = JSON.parse(message.body || "{}") || {};
		}
		catch (error)
		{
			details = {};
		}

		const isMine = message.sender === state.me.number;
		const isTargetMe = !!details.target && details.target === state.me.number;
		const params = { actor: GetDisplayName(message.sender), target: details.target ? GetDisplayName(details.target) : T("note.someone"), title: String(details.title || "") };

		// Pick the wording for who did it to whom.
		const Pick = (base, hasTarget) => (isMine ? `${base}.you` : hasTarget && isTargetMe ? `${base}.toYou` : base);

		switch (message.kind)
		{
		case "left":
			return T(Pick("note.left", false), params);
		case "retired":
			return T("note.retired", params);
		case "added":
			return T(Pick("note.added", true), params);
		case "removed":
			return T(Pick("note.removed", true), params);
		case "renamed":
			return T(Pick(details.title ? "note.renamed" : "note.renameCleared", false), params);
		case "promoted":
			return details.target === message.sender ? T(isMine ? "note.nowAdmin.you" : "note.nowAdmin", params) : T(Pick("note.promoted", true), params);
		case "demoted":
			return T(Pick("note.demoted", true), params);
		case "picture":
			return T(Pick(details.cleared ? "note.pictureCleared" : "note.pictureChanged", false), params);
		case "pinned":
			return T(Pick("note.pinned", false), params);
		case "unpinned":
			return T(Pick("note.unpinned", false), params);
		default:
			return "";
		}
	}

	/// <summary>
	/// Chats sorted with the most recent activity on top, optionally filtered by title or last message.
	/// </summary>
	/// <param name="query">Search query (optional)</param>
	/// <returns>Chat summaries</returns>
	function GetSortedChats(query = "")
	{
		// Pinned chats come first, most recently pinned on top; the rest follow by their latest owl.
		return [...state.chats.values()].filter((chat) => Owls.Util.Matches(GetChatTitle(chat), query) || (chat.lastMessage && Owls.Util.Matches(GetMessageText(chat.lastMessage), query))).sort((first, second) => (Number(second.pinnedAt) || 0) - (Number(first.pinnedAt) || 0) || second.lastActivityAt - first.lastActivityAt);
	}

	/// <summary>
	/// The direct chat already open with an owl number, if any.
	/// </summary>
	/// <param name="number">Other owl's number</param>
	/// <returns>Chat summary or null</returns>
	function FindDirectChat(number)
	{
		for (const chat of state.chats.values())
		{
			if (chat.kind === "direct" && chat.members.includes(number))
			{
				return chat;
			}
		}

		return null;
	}

	/// <summary>
	/// Total unread owls, for the badge on the home screen.
	/// </summary>
	/// <returns>Unread count</returns>
	function GetTotalUnread()
	{
		let total = 0;

		for (const chat of state.chats.values())
		{
			total += chat.unread || 0;
		}

		return total;
	}

	/// <summary>
	/// Set a chat's unread count (e.g. 0 when opened).
	/// </summary>
	/// <param name="chatId">Chat ID</param>
	/// <param name="unread">New count</param>
	function SetUnread(chatId, unread)
	{
		const chat = state.chats.get(chatId);

		if (chat && chat.unread !== unread)
		{
			chat.unread = unread;
			Notify("chats");
		}
	}

	// ========================
	// Names & Pictures
	// ========================

	/// <summary>
	/// Format an owl number for display, when the server allows numbers to be seen.
	/// </summary>
	/// <param name="number">8-digit number</param>
	/// <returns>"1234 5678"</returns>
	function FormatNumber(number)
	{
		return `${number.slice(0, 4)} ${number.slice(4)}`;
	}

	/// <summary>
	/// What to call an owl: your contact name for them, or "Unknown Owl".
	/// Numbers stay hidden unless the server enables numbers.visible.
	/// </summary>
	/// <param name="number">Owl number</param>
	/// <returns>Display name</returns>
	function GetDisplayName(number)
	{
		if (number === state.me.number)
		{
			return T("common.you");
		}

		const sender = GetSender(number);

		if (sender)
		{
			return sender.name;
		}

		const contact = state.contactsByNumber.get(number);

		if (contact)
		{
			return GetContactLabel(contact);
		}

		return state.config.numbersVisible ? T("owl.numbered", { number: FormatNumber(number) }) : T("owl.unknown");
	}

	/// <summary>
	/// The other owl of a direct chat.
	/// </summary>
	/// <param name="chat">Chat summary</param>
	/// <returns>Their owl number, or an empty string</returns>
	function GetOtherMember(chat)
	{
		return chat.members.find((member) => member !== state.me.number) || "";
	}

	/// <summary>
	/// Title shown for a chat: the contact's name for direct chats, the group title or member names for groups.
	/// </summary>
	/// <param name="chat">Chat summary</param>
	/// <returns>Title</returns>
	function GetChatTitle(chat)
	{
		if (chat.kind === "direct")
		{
			return GetDisplayName(GetOtherMember(chat));
		}

		if (chat.kind === "channel")
		{
			const sender = GetSender(chat.createdBy);
			return sender ? sender.name : chat.title || T("chat.announcements");
		}

		if (chat.title)
		{
			return chat.title;
		}

		const others = chat.members.filter((member) => member !== state.me.number).map(GetDisplayName);
		return others.length > 3 ? T("common.listAndMore", { list: others.slice(0, 3).join(T("common.listSeparator")), count: others.length - 3 }) : others.join(T("common.listSeparator"));
	}

	/// <summary>
	/// Build the avatar of a chat: the contact's picture for direct chats, a group icon otherwise.
	/// </summary>
	/// <param name="chat">Chat summary</param>
	/// <param name="sizeClass">Avatar size class</param>
	/// <returns>Avatar element</returns>
	function CreateChatAvatar(chat, sizeClass = "")
	{
		if (chat.kind === "channel")
		{
			const sender = GetSender(chat.createdBy);
			return Owls.Util.CreateAvatar("", sender ? sender.avatarUrl : "", `sender-${chat.createdBy}`, sizeClass, Owls.Icons.official);
		}

		if (chat.kind !== "direct")
		{
			return Owls.Util.CreateAvatar("", chat.avatarUrl || "", `group-${chat.id}`, sizeClass, Owls.Icons.group);
		}

		const number = GetOtherMember(chat);

		if (GetSender(number))
		{
			return Owls.Util.CreateAvatar("", GetProfileAvatarUrl(number), `sender-${number}`, sizeClass, Owls.Icons.official);
		}

		const contact = state.contactsByNumber.get(number);
		const avatarUrl = GetAvatarUrl(number);
		return contact ? Owls.Util.CreateAvatar(contact.name, avatarUrl, number, sizeClass) : Owls.Util.CreateAvatar("", avatarUrl, number, sizeClass, Owls.Icons.owl);
	}

	// ========================
	// Messages
	// ========================

	/// <summary>
	/// Record a delivered message: append it to a loaded history and update the chat's preview.
	/// Duplicates (the same ID arriving twice) are ignored.
	/// </summary>
	/// <param name="message">{ id, chatId, sender, body, sentAt }</param>
	/// <returns>True if the message was new</returns>
	function AddMessage(message)
	{
		const history = GetHistory(message.chatId);
		const chat = state.chats.get(message.chatId);

		if (history.messages.some((known) => known.id === message.id) || (chat && chat.lastMessage && chat.lastMessage.id === message.id))
		{
			return false;
		}

		if (history.isLoaded)
		{
			history.messages.push(message);
			history.messages.sort((first, second) => first.id - second.id);
		}

		if (chat && (!chat.lastMessage || chat.lastMessage.id <= message.id))
		{
			chat.lastMessage = message;
			chat.lastActivityAt = Math.max(chat.lastActivityAt || 0, message.sentAt);
		}

		Notify(`history:${message.chatId}`);
		Notify("chats");
		return true;
	}

	/// <summary>
	/// Store a page of history fetched from the server.
	/// </summary>
	/// <param name="page">{ chatId, beforeId, messages, hasMore }</param>
	function ApplyHistoryPage(page)
	{
		const history = GetHistory(page.chatId);
		const known = new Set(history.messages.map((message) => message.id));
		const fresh = (page.messages || []).filter((message) => !known.has(message.id));

		history.messages = page.beforeId > 0 ? [...fresh, ...history.messages] : [...history.messages, ...fresh];
		history.messages.sort((first, second) => first.id - second.id);
		history.hasMore = !!page.hasMore;
		history.isLoaded = true;

		if (!page.beforeId)
		{
			state.reads.set(page.chatId, new Map((page.reads || []).map((read) => [read.number, Number(read.messageId)])));
		}

		Notify(`history:${page.chatId}`);
	}

	/// <summary>
	/// Wipe an owl its sender took back, wherever the page shows it: history, preview and pin.
	/// </summary>
	/// <param name="chatId">Chat ID</param>
	/// <param name="messageId">Message ID</param>
	/// <param name="unsentAt">When it was unsent</param>
	function MarkUnsent(chatId, messageId, unsentAt)
	{
		const chat = state.chats.get(chatId);
		const history = state.histories.get(chatId);

		for (const message of history ? history.messages : [])
		{
			if (message.id === messageId)
			{
				message.body = "";
				message.unsentAt = unsentAt;
			}

			// Quotes of it lose their text too.
			if (message.replyTo && message.replyTo.id === messageId)
			{
				message.replyTo = { ...message.replyTo, body: "", unsent: true };
			}
		}

		if (chat && chat.lastMessage && chat.lastMessage.id === messageId)
		{
			chat.lastMessage = { ...chat.lastMessage, body: "", unsentAt };
		}

		if (chat && chat.pinnedMessage && chat.pinnedMessage.id === messageId)
		{
			chat.pinnedMessage = null;
		}

		Notify(`history:${chatId}`);
		Notify("chats");
	}

	/// <summary>
	/// Take an owl off this phone only ("delete for me").
	/// </summary>
	/// <param name="chatId">Chat ID</param>
	/// <param name="messageId">Message ID</param>
	function RemoveMessage(chatId, messageId)
	{
		const chat = state.chats.get(chatId);
		const history = state.histories.get(chatId);

		if (history)
		{
			history.messages = history.messages.filter((message) => message.id !== messageId);
		}

		// The preview falls back to the owl before it, when the page has it.
		if (chat && chat.lastMessage && chat.lastMessage.id === messageId)
		{
			chat.lastMessage = history && history.messages.length > 0 ? history.messages[history.messages.length - 1] : null;
		}

		Notify(`history:${chatId}`);
		Notify("chats");
	}

	/// <summary>
	/// Add an optimistic bubble for an owl that is on its way.
	/// </summary>
	/// <param name="chatId">Chat ID</param>
	/// <param name="clientKey">Key matching the server's reply</param>
	/// <param name="body">Message text</param>
	/// <param name="replyTo">Quote of the owl it answers, or null</param>
	/// <param name="parcel">{ request, display } of the parcel it carries, kept for a retry; null for none</param>
	function AddPending(chatId, clientKey, body, replyTo = null, parcel = null)
	{
		GetHistory(chatId).pending.push({ clientKey, chatId, body, replyTo, parcel, sentAt: Date.now(), status: "pending" });
		Notify(`history:${chatId}`);
	}

	/// <summary>
	/// Show a parcel's new status (collected, or returned to the sender) on its owl.
	/// </summary>
	/// <param name="chatId">Chat ID; 0 when the server did not say, and every loaded chat is searched</param>
	/// <param name="messageId">Message ID of the owl carrying it</param>
	/// <param name="parcel">{ galleons, status } or null</param>
	function SetParcel(chatId, messageId, parcel)
	{
		for (const [id, history] of state.histories)
		{
			if (chatId > 0 && id !== chatId)
			{
				continue;
			}

			for (const message of history.messages)
			{
				if (message.id === messageId)
				{
					message.parcel = parcel;
					Notify(`history:${id}`);
				}
			}
		}
	}

	/// <summary>
	/// Remove an optimistic bubble once the real message is known, or before a retry.
	/// </summary>
	/// <param name="chatId">Chat ID</param>
	/// <param name="clientKey">Key of the pending owl</param>
	function RemovePending(chatId, clientKey)
	{
		const history = GetHistory(chatId);
		history.pending = history.pending.filter((pending) => pending.clientKey !== clientKey);
		Notify(`history:${chatId}`);
	}

	/// <summary>
	/// Mark an optimistic bubble as not delivered, so the player can tap to retry.
	/// </summary>
	/// <param name="chatId">Chat ID</param>
	/// <param name="clientKey">Key of the pending owl</param>
	/// <param name="error">Reason shown under the bubble</param>
	function FailPending(chatId, clientKey, error)
	{
		const pending = GetHistory(chatId).pending.find((entry) => entry.clientKey === clientKey);

		if (pending)
		{
			pending.status = "failed";
			pending.error = error;
			Notify(`history:${chatId}`);
		}
	}

	// ========================
	// Settings
	// ========================

	/// <summary>
	/// Replace the stored settings with the server's saved copy.
	/// </summary>
	/// <param name="settings">Settings object</param>
	function SetSettings(settings)
	{
		state.settings = { ...defaultSettings, ...settings };
		Notify("settings");
	}

	/// <summary>
	/// Subscribe to change notifications.
	/// </summary>
	/// <param name="listener">Function receiving the change reason</param>
	/// <returns>Function that unsubscribes</returns>
	function Subscribe(listener)
	{
		listeners.add(listener);
		return () => listeners.delete(listener);
	}

	return {
		state,
		Reset, Clear, SetReady,
		NotifyChanged: Notify,
		ApplyProfilesChunk, SetProfile, EnsureProfiles, GetProfileAvatarUrl, GetAvatarUrl, GetTheme, GetColourScheme,
		SetDraft, GetDraft,
		SetServerTime, GetServerNow, IsInFlight, IsNote, ParseLocation, ParsePoll, SetPollVotes, SetParcel, SetShownLocation, IsLocationShown, GetMessageText,
		IsShared, SetReads, SetRead, GetReadBy, SetTyping, ClearTyping, GetTyping, GetTypingText,
		SetInformRequests, AddInformRequest, RemoveInformRequest, GetInformRequests,
		SetCall, EndCall, ApplyCallsChunk, AddCallEntry, RemoveCallEntries, MarkCallsSeen, GetMissedCallCount, GetCallState,
		IsBlocked, SetBlocked, IsRetired, SetRetired, SetQuiet, IsQuiet, SetSenders, GetSender, IsMuted, SetMuted, GetWriteState,
		ApplyContactsChunk, UpsertContact, RemoveContact, GetSortedContacts, GetFavouriteContacts, GetContactLabel,
		ApplyChatsChunk, UpsertChat, RemoveChat, SetChatPinned, IsAdmin, GetNoteText, GetSortedChats, FindDirectChat, GetTotalUnread, SetUnread,
		FormatNumber, GetDisplayName, GetOtherMember, GetChatTitle, CreateChatAvatar,
		GetHistory, AddMessage, ApplyHistoryPage, MarkUnsent, RemoveMessage, AddPending, RemovePending, FailPending,
		SetSettings, Subscribe,
	};
})();
