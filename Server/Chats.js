// FranticDreamer 2026
"use strict";

const { Ok, Fail } = require("./Result.js");
const { Problem } = require("./Lang.js");
const { ClampInteger } = require("./Config.js");
const { Logger } = require("./Logger.js");
const { invalidId, IsSenderNumber, MessageKind, MemberRole, ToQuote, ReadPoll } = require("./Database.js");
const { CheckAvatarUrl } = require("./Avatars.js");

/// <summary>
/// How long a typing indicator lasts on other phones unless the typist keeps typing.
/// The page repeats its "typing" ping more often than this while the player types.
/// </summary>
const typingDurationMs = 5000;

/// <summary>
/// Message kinds that are owls someone sent (as opposed to notes about the chat).
/// </summary>
const owlKinds = Object.freeze([MessageKind.Text, MessageKind.Location, MessageKind.Poll]);

/// <summary>
/// Message kinds that can be forwarded. A poll belongs to the bulk owl it asks; a copy elsewhere would count other votes.
/// </summary>
const forwardKinds = Object.freeze([MessageKind.Text, MessageKind.Location]);

/// <summary>
/// Shortest and longest text searched for inside a chat, and the most results sent back.
/// </summary>
const minSearchLength = 2;
const maxSearchLength = 64;
const maxSearchResults = 30;

/// <summary>
/// Longest accepted client-generated key for matching a sent owl to its optimistic bubble.
/// </summary>
const maxClientKeyLength = 64;

/// <summary>
/// Most line breaks kept in one message, so a single owl cannot push a whole chat off screen.
/// </summary>
const maxMessageLines = 30;

/// <summary>
/// muted_until value meaning "until unmuted" (31 December 9999).
/// </summary>
const mutedForever = 253402300799000;

/// <summary>
/// Mute lengths the page offers, in minutes. 0 unmutes; -1 mutes until unmuted.
/// </summary>
const muteChoices = Object.freeze([0, 60, 480, 1440, -1]);

// ========================
// Chat Service
// ========================

/// <summary>
/// Owns chats ("owls") and their messages: listing, opening, creating, sending, muting, leaving and read markers.
/// Every request is checked against chat membership on the server; a client never names a chat it is not part of.
///
/// <para>
/// NOTE: Player owls, owls from other resources and Ministry announcements all end in #Publish, so flight time,
/// block filtering, the Discord log and the "frantic-owls:sent" event behave the same for every kind of owl.
/// Kinds of chat: "direct" (exactly one per pair of owls), "group" (a bulk owl) and "channel"
/// (a system sender's broadcast to every character, read-only, with no member list sent to pages).
/// </para>
///
/// </summary>
class ChatService
{
	/// <summary>
	/// OwlDatabase instance.
	/// </summary>
	#database;

	/// <summary>
	/// OwlDirectory instance, to find which members are online.
	/// </summary>
	#directory;

	/// <summary>
	/// Outbox instance, for pushing new messages to online members.
	/// </summary>
	#outbox;

	/// <summary>
	/// hmp-lib server import, for text cleaning.
	/// </summary>
	#hmp;

	/// <summary>
	/// Full server configuration.
	/// </summary>
	#config;

	/// <summary>
	/// BlockService instance.
	/// </summary>
	#blocks;

	/// <summary>
	/// SenderRegistry instance.
	/// </summary>
	#senders;

	/// <summary>
	/// FlightPlanner instance.
	/// </summary>
	#flight;

	/// <summary>
	/// AuditLog instance.
	/// </summary>
	#audit;

	/// <summary>
	/// { Describe(number) => label, OnSent(info) } supplied by Main.
	/// </summary>
	#hooks;

	/// <summary>
	/// LocationService instance, for reading where a sender stands.
	/// </summary>
	#locations;

	/// <summary>
	/// SettingsService instance, for who shares read receipts and typing indicators.
	/// </summary>
	#settings;

	/// <summary>
	/// Per-owl message rate limiter, keyed by owl number.
	/// </summary>
	#sendLimiter;

	/// <summary>
	/// Per-owl limiter for typing pings, keyed by owl number. Generous enough for an honest page, which pings every few seconds.
	/// </summary>
	#typingLimiter;

	/// <summary>
	/// Per-owl limiter for group administration, keyed by owl number.
	/// </summary>
	#adminLimiter;

	/// <summary>
	/// Per-owl limiters for searching a chat and for poll votes, keyed by owl number.
	/// </summary>
	#searchLimiter;
	#voteLimiter;

	/// <summary>
	/// NumberDialler instance, for chats opened by typing in a number.
	/// </summary>
	#dialler;

	/// <summary>
	/// Landing timers of owls in flight, by message ID.
	/// </summary>
	#flights = new Map();

	/// <summary>
	/// Build the unique key of the one direct chat two owls share, independent of who started it.
	/// </summary>
	/// <param name="first">One owl number</param>
	/// <param name="second">The other owl number</param>
	/// <returns>"lower:higher"</returns>
	#GetDirectKey(first, second)
	{
		return first < second ? `${first}:${second}` : `${second}:${first}`;
	}

	/// <summary>
	/// Read a positive integer ID out of client data.
	/// </summary>
	/// <param name="value">Client-supplied value</param>
	/// <returns>The ID, or 0 if it is not a positive integer</returns>
	#ReadId(value)
	{
		return ClampInteger(value, 0, Number.MAX_SAFE_INTEGER, 0);
	}

	/// <summary>
	/// Clean an owl's text.
	/// </summary>
	/// <param name="raw">Text as supplied</param>
	/// <param name="maxLength">Longest allowed length</param>
	/// <returns>Cleaned text, possibly empty</returns>
	#CleanBody(raw, maxLength)
	{
		return this.#hmp.text.clean(raw, { maxLength, multiline: true, maxLines: maxMessageLines }).trim();
	}

	/// <summary>
	/// Queue an item for every online member of a chat, except one.
	/// </summary>
	/// <param name="members">Member owl numbers</param>
	/// <param name="exceptNumber">Owl number to skip (usually the one who caused the update)</param>
	/// <param name="type">Outbox item type</param>
	/// <param name="data">Payload, identical for every member</param>
	#PushToMembers(members, exceptNumber, type, data)
	{
		for (const member of members)
		{
			if (member === exceptNumber)
			{
				continue;
			}

			const target = this.#directory.GetByNumber(member);

			if (target)
			{
				this.#outbox.Push(target.player, type, data);
			}
		}
	}

	/// <summary>
	/// The one-to-one chat between two owls, created the first time.
	/// </summary>
	/// <param name="first">Owl number that starts it</param>
	/// <param name="second">The other owl number</param>
	/// <returns>Chat ID, or a value of 0 or less on failure</returns>
	async #EnsureDirectChat(first, second)
	{
		const directKey = this.#GetDirectKey(first, second);
		let chatId = await this.#database.FindDirectChat(directKey);

		if (chatId === 0)
		{
			chatId = await this.#database.CreateChat("direct", directKey, "", first, [first, second]);

			// Both owls may have opened the chat at the same moment; the loser of that race finds the winner's row.
			if (chatId === invalidId)
			{
				chatId = await this.#database.FindDirectChat(directKey);
			}
		}

		return chatId;
	}

	/// <summary>
	/// Deliver a stored message to everyone who should see it, when it lands.
	/// Members who blocked the sender are skipped; a channel goes to every owl online.
	/// </summary>
	/// <param name="chat">{ id, kind, title, avatarUrl, createdBy, createdAt, members, admins }</param>
	/// <param name="message">Stored message record</param>
	/// <param name="includeSender">Also deliver it to its sender's phone (for notes, which the page does not draw optimistically)</param>
	async #Publish(chat, message, includeSender = false)
	{
		const isChannel = chat.kind === "channel";
		const candidates = (isChannel ? this.#directory.All().map((entry) => entry.number) : chat.members).filter((number) => includeSender || number !== message.sender);
		const blockers = IsSenderNumber(message.sender) || !owlKinds.includes(message.kind) ? new Set() : await this.#blocks.ListBlockersAmong(message.sender, candidates);
		const audience = candidates.filter((number) => !blockers.has(number));

		// Recipients may not have this chat yet (e.g. the first owl of a direct chat), so the descriptor travels with the message.
		const descriptor = { ...this.#GetChatPatch(chat), createdAt: chat.createdAt, lastActivityAt: Math.max(message.sentAt, message.deliverAt) };

		const land = () =>
		{
			this.#flights.delete(message.id);

			// A letter's text is only handed out when it may be read (see Mail.js), so immersive pages are told that one arrived and nothing more.
			// Notes about bulk owls mean nothing there and are not sent at all.
			if (this.#config.mode === "immersive")
			{
				if (owlKinds.includes(message.kind))
				{
					this.#PushToMembers(audience, "", "mail:arrived", { id: message.id });
				}

				return;
			}

			this.#PushToMembers(audience, "", "message:new", { chat: descriptor, message });

			const author = message.deliverAt > 0 ? this.#directory.GetByNumber(message.sender) : null;

			if (author)
			{
				this.#outbox.Push(author.player, "message:landed", { chatId: chat.id, messageId: message.id });
			}
		};

		const delay = message.deliverAt - Date.now();

		if (delay > 0)
		{
			this.#flights.set(message.id, setTimeout(land, delay));
			return;
		}

		land();
	}

	/// <summary>
	/// The facts about a chat every member's page keeps in step: title, picture, members and admins.
	/// </summary>
	/// <param name="chat">Chat record</param>
	/// <returns>{ id, kind, title, avatarUrl, createdBy, members, admins }</returns>
	#GetChatPatch(chat)
	{
		const isChannel = chat.kind === "channel";
		return { id: chat.id, kind: chat.kind, title: chat.title, avatarUrl: chat.avatarUrl || "", createdBy: chat.createdBy, members: isChannel ? [] : chat.members, admins: isChannel ? [] : chat.admins || [] };
	}

	/// <summary>
	/// Record a note about a group or chat (someone added, a rename, a pin) and show it to every member, the one who did it included.
	/// </summary>
	/// <param name="chat">Chat record, already updated</param>
	/// <param name="actor">Owl number of who did it</param>
	/// <param name="kind">MessageKind of the note</param>
	/// <param name="details">Details stored as the note's JSON body</param>
	async #PostNote(chat, actor, kind, details = {})
	{
		const message = await this.#database.InsertMessage(chat.id, actor, JSON.stringify(details), 0, kind);

		if (message)
		{
			await this.#Publish(chat, message, true);
		}
	}

	/// <summary>
	/// Read a chat fresh and push its title, picture, members and admins to every member online.
	/// </summary>
	/// <param name="chatId">Chat ID</param>
	/// <returns>The fresh chat record, or null if it could not be read</returns>
	async #RefreshMembers(chatId)
	{
		const chat = await this.#database.GetChat(chatId);

		if (chat)
		{
			this.#PushToMembers(chat.members, "", "chat:update", { chat: this.#GetChatPatch(chat) });
		}

		return chat || null;
	}

	/// <summary>
	/// Check that an owl may administer a group: it is a group, and they are one of its admins.
	/// A group left without any admin (made before admins existed) first gets one.
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <param name="chatId">Client-supplied chat ID</param>
	/// <returns>{ chat, error } with the chat record when allowed, otherwise null and the error's text key</returns>
	async #GetAdministeredGroup(entry, chatId)
	{
		const id = this.#ReadId(chatId);

		if (!this.#adminLimiter.allow(entry.number))
		{
			return { chat: null, error: "error.slowDown" };
		}

		let chat = id > 0 ? await this.#database.GetChat(id) : null;

		if (!chat || !chat.members.includes(entry.number))
		{
			return { chat: null, error: "error.chatGone" };
		}

		if (chat.kind !== "group")
		{
			return { chat: null, error: "error.onlyBulkAdmins" };
		}

		if (chat.admins.length === 0 && await this.#database.EnsureGroupAdmin(chat.id))
		{
			chat = await this.#RefreshMembers(chat.id) || chat;
		}

		if (!chat.admins.includes(entry.number))
		{
			return { chat: null, error: "error.adminsOnly" };
		}

		return { chat, error: null };
	}

	/// <summary>
	/// Whether read receipts or typing indicators are on for an owl: on for the server and in the owl's own settings.
	/// </summary>
	/// <param name="settings">The owl's settings</param>
	/// <param name="key">"readReceipts" or "typingIndicators"</param>
	/// <returns>True when shared</returns>
	#IsShared(settings, key)
	{
		return this.#config.phonemode_privacy[key] === true && !!settings && settings[key] !== false;
	}

	/// <summary>
	/// Tell the Discord log and other resources that an owl was sent.
	/// </summary>
	/// <param name="chat">Chat it was sent to</param>
	/// <param name="message">Stored message record</param>
	/// <param name="origin">"player", "system" or "announcement"</param>
	#Record(chat, message, origin)
	{
		const describe = this.#hooks.Describe;
		const recipients = chat.kind === "channel" ? [] : chat.members.filter((number) => number !== message.sender);
		const flightSeconds = message.deliverAt > 0 ? Math.round((message.deliverAt - message.sentAt) / 1000) : 0;
		const target = chat.kind === "direct" ? describe(recipients[0] || "") : chat.kind === "group" ? `bulk owl "${chat.title || "untitled"}" (#${chat.id}, ${chat.members.length} members)` : "everyone";
		const category = origin === "announcement" ? "announcements" : origin === "system" ? "system" : "messages";
		const isLocation = message.kind === MessageKind.Location;
		const poll = message.kind === MessageKind.Poll ? ReadPoll(message.body) : null;
		const label = isLocation ? " (location)" : poll ? " (poll)" : "";
		const title = origin === "announcement" ? "Announcement" : origin === "system" ? "Official owl" : `${chat.kind === "group" ? "Bulk owl" : "Owl"}${message.forwarded ? " (forwarded)" : ""}${label}`;
		const value = poll ? `${poll.question}\n${poll.options.map((option) => `• ${option}`).join("\n")}` : message.body;
		const fields = this.#audit.ShouldIncludeBodies() ? [{ name: isLocation ? "Location" : poll ? "Poll" : "Message", value }] : [];

		this.#audit.Log(category, title, `${describe(message.sender)} → ${target}${flightSeconds > 0 ? `\nLands in ${flightSeconds}s` : ""}`, fields);

		this.#hooks.OnSent
		({
			chatId: chat.id,
			chatKind: chat.kind,
			messageId: message.id,
			kind: message.kind,
			sender: message.sender,
			origin,
			recipients,
			body: message.body,
			forwarded: message.forwarded === true,
			sentAt: message.sentAt,
			deliverAt: message.deliverAt,
		});
	}

	/// <summary>
	/// Read the owl a new one answers, if any.
	/// </summary>
	/// <param name="entry">Directory entry of the writing owl</param>
	/// <param name="chatId">Chat the answer goes to</param>
	/// <param name="rawId">Client-supplied ID of the answered owl (0 or missing for none)</param>
	/// <returns>The answered message, null for no reply, or undefined when it cannot be answered (gone, unsent, a note or in another chat)</returns>
	async #ReadQuoted(entry, chatId, rawId)
	{
		const replyToId = this.#ReadId(rawId);

		if (replyToId === 0)
		{
			return null;
		}

		const quoted = await this.#database.GetVisibleMessage(chatId, entry.number, replyToId);
		return quoted && owlKinds.includes(quoted.kind) && quoted.unsentAt === 0 ? quoted : undefined;
	}

	/// <summary>
	/// Check that an owl may write to a chat it belongs to: not a channel, not a blocked one-to-one, and not an official sender that takes no replies.
	/// </summary>
	/// <param name="entry">Directory entry of the writing owl</param>
	/// <param name="chat">Chat the owl is a member of</param>
	/// <returns>{ error, replyTo } where error is null when writing is allowed (otherwise a text key) and replyTo is the system sender being answered, if any</returns>
	async #CheckWritable(entry, chat)
	{
		if (chat.kind === "channel")
		{
			return { error: "error.announcementsReadOnly", replyTo: null };
		}

		if (chat.kind !== "direct")
		{
			return { error: null, replyTo: null };
		}

		const other = chat.members.find((member) => member !== entry.number) || "";

		if (IsSenderNumber(other))
		{
			const replyTo = this.#senders.GetByNumber(other);
			return replyTo && replyTo.onReply ? { error: null, replyTo } : { error: "error.cannotAnswer", replyTo: null };
		}

		if ((await this.#database.ListRetiredAmong([other])).has(other))
		{
			return { error: "error.retired", replyTo: null };
		}

		const [isBlockedByThem, haveBlockedThem] = await Promise.all([this.#blocks.HasBlocked(other, entry.number), this.#blocks.HasBlocked(entry.number, other)]);

		if (isBlockedByThem === null || haveBlockedThem === null)
		{
			return { error: "error.sendFailed", replyTo: null };
		}

		// Deliberately vague: the sender is not told that they were blocked.
		if (isBlockedByThem)
		{
			return { error: "error.undeliverable", replyTo: null };
		}

		if (haveBlockedThem)
		{
			return { error: "error.youBlocked", replyTo: null };
		}

		return { error: null, replyTo: null };
	}

	/// <summary>
	/// Constructor.
	/// </summary>
	/// <param name="services">{ database, directory, outbox, hmp, config, blocks, senders, flight, audit, hooks, locations, settings, dialler }</param>
	constructor(services)
	{
		this.#database = services.database;
		this.#directory = services.directory;
		this.#outbox = services.outbox;
		this.#hmp = services.hmp;
		this.#config = services.config;
		this.#blocks = services.blocks;
		this.#senders = services.senders;
		this.#flight = services.flight;
		this.#audit = services.audit;
		this.#hooks = services.hooks;
		this.#locations = services.locations;
		this.#settings = services.settings;
		this.#dialler = services.dialler;
		this.#sendLimiter = this.#hmp.rateLimit.create({ limit: this.#config.messages.rateLimitCount, windowMs: this.#config.messages.rateLimitWindowMs });
		this.#typingLimiter = this.#hmp.rateLimit.create({ limit: 3, windowMs: 3000 });
		this.#adminLimiter = this.#hmp.rateLimit.create({ limit: 10, windowMs: 10000 });
		this.#searchLimiter = this.#hmp.rateLimit.create({ limit: 10, windowMs: 10000 });
		this.#voteLimiter = this.#hmp.rateLimit.create({ limit: 10, windowMs: 10000 });
	}

	/// <summary>
	/// Drop rate-limit buckets nobody has used for a while. Call from a maintenance tick.
	/// </summary>
	Sweep()
	{
		this.#sendLimiter.sweep(this.#config.messages.rateLimitWindowMs * 4);
		this.#typingLimiter.sweep(12000);
		this.#adminLimiter.sweep(40000);
		this.#searchLimiter.sweep(40000);
		this.#voteLimiter.sweep(40000);
	}

	// ========================
	// Flights
	// ========================

	/// <summary>
	/// Re-arm the landing of owls that were still in the air when the resource last stopped.
	/// </summary>
	async RestoreFlights()
	{
		const inFlight = await this.#database.ListInFlight(Date.now());

		for (const message of inFlight)
		{
			const chat = await this.#database.GetChat(message.chatId);

			if (chat)
			{
				await this.#Publish(chat, message);
			}
		}

		if (inFlight.length > 0)
		{
			Logger.LogMessage("Chats", `${inFlight.length} owl(s) still in flight from before the restart.`);
		}
	}

	/// <summary>
	/// Cancel every landing timer. The owls stay stored; recipients see them once they have landed.
	/// </summary>
	StopFlights()
	{
		for (const timer of this.#flights.values())
		{
			clearTimeout(timer);
		}

		this.#flights.clear();
	}

	// ========================
	// Player Requests
	// ========================

	/// <summary>
	/// The chat list of an owl, most recently active first.
	/// </summary>
	/// <param name="number">Owl number</param>
	/// <returns>Chat summaries, or null on failure</returns>
	async List(number)
	{
		return this.#database.ListChats(number, this.#config.messages.maxChatsListed);
	}

	/// <summary>
	/// Open the one-to-one chat with a contact, creating it the first time.
	/// Starting a "new" owl to someone you already talk to lands in the existing chat.
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <param name="data">{ contactId }</param>
	/// <returns>Result carrying the chat summary</returns>
	async OpenDirect(entry, data)
	{
		const contactId = this.#ReadId(data.contactId);
		const contact = contactId > 0 ? await this.#database.GetContact(entry.number, contactId) : null;

		if (!contact)
		{
			return Fail("error.contactGone");
		}

		if (contact.number === entry.number)
		{
			return Fail("error.selfOwl");
		}

		const chatId = await this.#EnsureDirectChat(entry.number, contact.number);
		const chat = chatId > 0 ? await this.#database.GetChatForMember(chatId, entry.number) : null;

		if (!chat)
		{
			return Fail("error.chatOpenFailed");
		}

		return Ok({ chat });
	}

	/// <summary>
	/// Open the one-to-one chat with an owl by its number: one it already knows (from a call or an earlier chat),
	/// or, with phonemode_numbers.dialling on, any live owl whose number was typed in.
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <param name="data">{ number }</param>
	/// <returns>Result carrying the chat summary</returns>
	async OpenNumber(entry, data)
	{
		const typed = this.#dialler.Normalise(data.number);

		if (!typed)
		{
			return Fail("error.numberInvalid");
		}

		if (typed === entry.number)
		{
			return Fail("error.selfOwl");
		}

		const related = await this.#database.AreRelated(entry.number, typed);

		if (related === null)
		{
			return Fail("error.chatOpenFailed");
		}

		// Owls it already knows cost nothing against the dialling limit; only strangers are looked up.
		const target = related ? { number: typed, error: "" } : await this.#dialler.Resolve(entry, typed);

		if (target.error)
		{
			return Fail(target.error);
		}

		const chatId = await this.#EnsureDirectChat(entry.number, target.number);
		const chat = chatId > 0 ? await this.#database.GetChatForMember(chatId, entry.number) : null;
		return chat ? Ok({ chat }) : Fail("error.chatOpenFailed");
	}

	/// <summary>
	/// Create a group chat ("bulk owl") with several contacts.
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <param name="data">{ contactIds: number[], title }</param>
	/// <returns>Result carrying the new chat summary</returns>
	async CreateGroup(entry, data)
	{
		const maxOthers = this.#config.phonemode_groups.maxMembers - 1;
		const requested = Array.isArray(data.contactIds) ? data.contactIds.slice(0, maxOthers + 1).map((id) => this.#ReadId(id)).filter((id) => id > 0) : [];

		if (requested.length > maxOthers)
		{
			return Fail(Problem("error.bulkTooMany", { count: maxOthers }));
		}

		const contacts = await this.#database.ListContacts(entry.number);

		if (!contacts)
		{
			return Fail("error.contactsReadFailed");
		}

		const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
		const retired = await this.#database.ListRetiredAmong(contacts.map((contact) => contact.number));
		const numbers = new Set();

		for (const id of requested)
		{
			const contact = contactsById.get(id);

			if (contact && contact.number !== entry.number && !IsSenderNumber(contact.number) && !retired.has(contact.number))
			{
				numbers.add(contact.number);
			}
		}

		if (numbers.size < 2)
		{
			return Fail("error.bulkTooFew");
		}

		const title = this.#hmp.text.clean(data.title, this.#config.phonemode_groups.maxTitleLength).replace(/\s+/g, " ").trim();
		const members = [entry.number, ...numbers];
		const chatId = await this.#database.CreateChat("group", null, title, entry.number, members);
		const chat = chatId > 0 ? await this.#database.GetChatForMember(chatId, entry.number) : null;

		if (!chat)
		{
			return Fail("error.bulkCreateFailed");
		}

		this.#PushToMembers(chat.members, entry.number, "chat:upsert", { chat: { ...chat, unread: 0, mutedUntil: 0 } });
		this.#audit.Log("groups", "Bulk owl created", `${this.#hooks.Describe(entry.number)} created "${title || "untitled"}" (#${chat.id}) with ${members.map(this.#hooks.Describe).join(", ")}`);
		return Ok({ chat });
	}

	/// <summary>
	/// Read one page of a chat's history.
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <param name="data">{ chatId, beforeId } where beforeId 0 means the newest page</param>
	/// <returns>Result carrying { chatId, messages, hasMore, serverNow }</returns>
	async History(entry, data)
	{
		const chatId = this.#ReadId(data.chatId);
		const beforeId = this.#ReadId(data.beforeId);
		const chat = chatId > 0 ? await this.#database.GetChatForMember(chatId, entry.number) : null;

		if (!chat)
		{
			return Fail("error.chatGone");
		}

		const page = await this.#database.ListMessages(chatId, entry.number, beforeId, this.#config.messages.pageSize);

		if (!page)
		{
			return Fail("error.historyFailed");
		}

		// Read markers come with the newest page only; after that they arrive live as "chat:read".
		const reads = beforeId === 0 ? await this.#ListReads(entry, chat) : [];
		return Ok({ chatId, beforeId, messages: page.messages, hasMore: page.hasMore, reads, serverNow: Date.now() });
	}

	/// <summary>
	/// How far the other members of a chat have read, for the members who share read receipts, if the viewer shares them too.
	/// </summary>
	/// <param name="entry">Directory entry of the viewer</param>
	/// <param name="chat">Chat summary</param>
	/// <returns>[{ number, messageId }]; empty when receipts are off for the server or the viewer, or for a channel</returns>
	async #ListReads(entry, chat)
	{
		if (chat.kind === "channel" || !this.#IsShared(entry.settings, "readReceipts"))
		{
			return [];
		}

		const states = await this.#database.ListMemberStates(chat.id);
		const others = states ? states.filter((state) => state.number !== entry.number && !IsSenderNumber(state.number)) : [];

		if (others.length === 0)
		{
			return [];
		}

		const settings = await this.#settings.GetMany(others.map((state) => state.number));
		return others.filter((state) => this.#IsShared(settings.get(state.number), "readReceipts")).map((state) => ({ number: state.number, messageId: state.lastRead }));
	}

	/// <summary>
	/// Send an owl (message) to a chat. It lands at once, or after its flight time when owl flight is on.
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <param name="data">{ chatId, body, clientKey, replyToId } where clientKey matches the reply to the page's pending bubble and replyToId (optional) names the owl answered</param>
	/// <returns>Result carrying { message, clientKey, serverNow }</returns>
	async Send(entry, data)
	{
		const clientKey = String(data.clientKey || "").slice(0, maxClientKeyLength).replace(/[^A-Za-z0-9_-]/g, "");

		if (!this.#sendLimiter.allow(entry.number))
		{
			return Fail("error.owlsTired", { clientKey });
		}

		const chatId = this.#ReadId(data.chatId);
		const body = this.#CleanBody(data.body, this.#config.phonemode_messages.maxLength);

		if (body.length === 0)
		{
			return Fail("error.emptyOwl", { clientKey });
		}

		const chat = chatId > 0 ? await this.#database.GetChatForMember(chatId, entry.number) : null;

		if (!chat)
		{
			return Fail("error.chatGone", { clientKey });
		}

		const { error, replyTo } = await this.#CheckWritable(entry, chat);

		if (error)
		{
			return Fail(error, { clientKey });
		}

		const quoted = await this.#ReadQuoted(entry, chatId, data.replyToId);

		if (quoted === undefined)
		{
			return Fail("error.replyGone", { clientKey });
		}

		// Replies to a system sender go to a callback, not across the map, so they never fly.
		const deliverAt = replyTo ? 0 : this.#flight.GetDeliverAt(entry, chat);
		const message = await this.#database.InsertMessage(chatId, entry.number, body, deliverAt, MessageKind.Text, quoted);

		if (!message)
		{
			return Fail("error.sendFailed", { clientKey });
		}

		await this.#Publish(chat, message);
		this.#Record(chat, message, "player");

		if (replyTo)
		{
			this.#PassReply(replyTo, entry, message);
		}

		return Ok({ message, clientKey, serverNow: Date.now() });
	}

	/// <summary>
	/// Hand an owl written to a system sender to the reply handler of the resource behind it.
	/// </summary>
	/// <param name="replyTo">Live sender registration with an onReply handler</param>
	/// <param name="entry">Directory entry of the writing owl</param>
	/// <param name="message">Stored message record</param>
	#PassReply(replyTo, entry, message)
	{
		const reply = { sender: replyTo.key, fromNumber: entry.number, characterId: entry.characterId, characterName: entry.characterName, playerId: entry.playerId, body: message.body, chatId: message.chatId, messageId: message.id };

		// The callback belongs to another resource; whatever it does, it must not break this owl.
		Promise.resolve().then(() => replyTo.onReply(reply)).catch((error) => Logger.LogError("Chats", `The reply handler of sender "${replyTo.key}" (${replyTo.resource}) failed: ${Logger.Describe(error)}`));
	}

	/// <summary>
	/// Send one copy of an immersive-mode letter to one owl, in the one-to-one chat the two share.
	/// A letter to several owls is one call per recipient, so each copy is an ordinary owl of its own and never a bulk owl.
	///
	/// <para>
	/// NOTE: The body arrives already cleaned by Mail.js, which keeps a letter's spacing; Send's cleaning would squeeze it.
	/// Blocks, retired owls and system senders are checked exactly as for a phone owl, so a letter cannot reach anyone a phone owl could not.
	/// </para>
	///
	/// </summary>
	/// <param name="entry">Directory entry of the writing owl</param>
	/// <param name="toNumber">Owl number of the recipient, already checked to be one the writer may address</param>
	/// <param name="body">Letter text, already cleaned</param>
	/// <returns>{ error, message } where error is null on success (otherwise a text key) and message the stored record</returns>
	async SendLetter(entry, toNumber, body)
	{
		const chatId = await this.#EnsureDirectChat(entry.number, toNumber);
		const chat = chatId > 0 ? await this.#database.GetChatForMember(chatId, entry.number) : null;

		if (!chat)
		{
			return { error: "error.chatOpenFailed", message: null };
		}

		const { error, replyTo } = await this.#CheckWritable(entry, chat);

		if (error)
		{
			return { error, message: null };
		}

		// Letters to a system sender go to a callback, not across the map, so they never fly.
		const deliverAt = replyTo ? 0 : this.#flight.GetDeliverAt(entry, chat);
		const message = await this.#database.InsertMessage(chatId, entry.number, body, deliverAt, MessageKind.Text);

		if (!message)
		{
			return { error: "error.sendFailed", message: null };
		}

		await this.#Publish(chat, message);
		this.#Record(chat, message, "player");

		if (replyTo)
		{
			this.#PassReply(replyTo, entry, message);
		}

		return { error: null, message };
	}

	/// <summary>
	/// Clean a one-line text such as a poll's question or one of its answers.
	/// </summary>
	/// <param name="raw">Text as supplied</param>
	/// <param name="maxLength">Longest allowed length</param>
	/// <returns>Cleaned text, possibly empty</returns>
	#CleanLine(raw, maxLength)
	{
		return this.#hmp.text.clean(String(raw ?? ""), maxLength).replace(/\s+/g, " ").trim();
	}

	/// <summary>
	/// Find the owls of a chat that contain some text. Only what the member can see is searched.
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <param name="data">{ chatId, query }</param>
	/// <returns>Result carrying { chatId, query, messages, hasMore } with the newest match first</returns>
	async Search(entry, data)
	{
		const chatId = this.#ReadId(data.chatId);
		const query = String(data.query ?? "").replace(/\s+/g, " ").trim().slice(0, maxSearchLength);

		if (query.length < minSearchLength)
		{
			return Fail(Problem("error.searchShort", { count: minSearchLength }));
		}

		if (!this.#searchLimiter.allow(entry.number))
		{
			return Fail("error.slowDown");
		}

		const chat = chatId > 0 ? await this.#database.GetChatForMember(chatId, entry.number) : null;

		if (!chat)
		{
			return Fail("error.chatGone");
		}

		const page = await this.#database.SearchMessages(chatId, entry.number, query, maxSearchResults);

		if (!page)
		{
			return Fail("error.searchFailed");
		}

		// A poll's body is JSON, which LIKE also matches on its field names; keep the polls whose question or answers say it.
		const needle = query.toLocaleLowerCase();
		const messages = page.messages.filter((message) =>
		{
			const poll = message.kind === MessageKind.Poll ? ReadPoll(message.body) : null;
			return message.kind !== MessageKind.Poll || (!!poll && [poll.question, ...poll.options].some((text) => text.toLocaleLowerCase().includes(needle)));
		});

		return Ok({ chatId, query, messages, hasMore: page.hasMore });
	}

	/// <summary>
	/// Forward one owl to other chats and contacts: each gets a copy marked "forwarded", sent by the forwarding owl.
	/// Every copy flies, is blocked and counts against the send rate limit like an owl written there.
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <param name="data">{ chatId, messageId, chatIds, contactIds } naming the owl and where its copies go</param>
	/// <returns>Result carrying { messages, chats, failures, serverNow } where failures lists { chatId, contactId, errorKey } for targets that were refused</returns>
	async Forward(entry, data)
	{
		const limit = this.#config.phonemode_messages.maxForwardTargets;

		if (limit === 0)
		{
			return Fail("error.forwardOff");
		}

		const ReadIds = (list) => (Array.isArray(list) ? [...new Set(list.slice(0, limit + 1).map((id) => this.#ReadId(id)).filter((id) => id > 0))] : []);
		const chatIds = ReadIds(data.chatIds);
		const contactIds = ReadIds(data.contactIds);

		if (chatIds.length + contactIds.length === 0)
		{
			return Fail("error.forwardNoTarget");
		}

		if (chatIds.length + contactIds.length > limit)
		{
			return Fail(Problem("error.forwardTooMany", { count: limit }));
		}

		const chatId = this.#ReadId(data.chatId);
		const messageId = this.#ReadId(data.messageId);
		const message = chatId > 0 && messageId > 0 ? await this.#database.GetVisibleMessage(chatId, entry.number, messageId) : null;

		if (!message || !forwardKinds.includes(message.kind) || message.unsentAt > 0)
		{
			return Fail("error.cannotForward");
		}

		if (message.kind === MessageKind.Location && !this.#config.phonemode_locations.enabled)
		{
			return Fail("error.locationsOff");
		}

		const targets = new Map();
		const failures = [];

		for (const id of chatIds)
		{
			const chat = await this.#database.GetChatForMember(id, entry.number);

			if (chat)
			{
				targets.set(chat.id, chat);
			}
			else
			{
				failures.push({ chatId: id, contactId: 0, errorKey: "error.chatGone" });
			}
		}

		for (const id of contactIds)
		{
			const contact = await this.#database.GetContact(entry.number, id);
			const directId = contact && contact.number !== entry.number ? await this.#EnsureDirectChat(entry.number, contact.number) : 0;
			const chat = directId > 0 ? await this.#database.GetChatForMember(directId, entry.number) : null;

			if (chat)
			{
				targets.set(chat.id, chat);
			}
			else
			{
				failures.push({ chatId: 0, contactId: id, errorKey: contact ? "error.chatOpenFailed" : "error.contactGone" });
			}
		}

		const sent = [];

		for (const chat of targets.values())
		{
			const { error, replyTo } = await this.#CheckWritable(entry, chat);
			const refusal = error || (replyTo && message.kind !== MessageKind.Text ? "error.writtenRepliesOnly" : "") || (!this.#sendLimiter.allow(entry.number) ? "error.owlsTired" : "");

			if (refusal)
			{
				failures.push({ chatId: chat.id, contactId: 0, errorKey: refusal });
				continue;
			}

			const copy = await this.#database.InsertMessage(chat.id, entry.number, message.body, replyTo ? 0 : this.#flight.GetDeliverAt(entry, chat), message.kind, null, true);

			if (!copy)
			{
				failures.push({ chatId: chat.id, contactId: 0, errorKey: "error.sendFailed" });
				continue;
			}

			await this.#Publish(chat, copy);
			this.#Record(chat, copy, "player");

			if (replyTo)
			{
				this.#PassReply(replyTo, entry, copy);
			}

			sent.push({ chat, message: copy });
		}

		if (sent.length === 0)
		{
			return Fail(failures.length > 0 ? failures[0].errorKey : "error.sendFailed");
		}

		return Ok({ messages: sent.map((item) => item.message), chats: sent.map((item) => item.chat), failures, serverNow: Date.now() });
	}

	// ========================
	// Polls
	// ========================

	/// <summary>
	/// Ask a bulk owl a question with answers to vote on. It flies, lands and counts as unread like a written owl.
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <param name="data">{ chatId, question, options, multiple } where multiple lets each member pick more than one answer</param>
	/// <returns>Result carrying { message, serverNow }</returns>
	async SendPoll(entry, data)
	{
		const polls = this.#config.phonemode_polls;

		if (!polls.enabled)
		{
			return Fail("error.pollsOff");
		}

		if (!this.#sendLimiter.allow(entry.number))
		{
			return Fail("error.owlsTired");
		}

		const chatId = this.#ReadId(data.chatId);
		const chat = chatId > 0 ? await this.#database.GetChatForMember(chatId, entry.number) : null;

		if (!chat)
		{
			return Fail("error.chatGone");
		}

		if (chat.kind !== "group")
		{
			return Fail("error.pollsOnlyBulk");
		}

		const question = this.#CleanLine(data.question, polls.maxQuestionLength);
		const raw = Array.isArray(data.options) ? data.options.slice(0, polls.maxOptions + 1) : [];
		const options = raw.map((option) => this.#CleanLine(option, polls.maxOptionLength)).filter((option) => option.length > 0);

		if (question.length === 0)
		{
			return Fail("error.pollQuestionMissing");
		}

		if (options.length > polls.maxOptions)
		{
			return Fail(Problem("error.pollTooMany", { count: polls.maxOptions }));
		}

		if (options.length < 2)
		{
			return Fail("error.pollTooFew");
		}

		if (new Set(options.map((option) => option.toLocaleLowerCase())).size !== options.length)
		{
			return Fail("error.pollDuplicate");
		}

		const body = JSON.stringify({ question, options, multiple: data.multiple === true });
		const message = await this.#database.InsertMessage(chatId, entry.number, body, this.#flight.GetDeliverAt(entry, chat), MessageKind.Poll);

		if (!message)
		{
			return Fail("error.sendFailed");
		}

		message.votes = [];
		await this.#Publish(chat, message);
		this.#Record(chat, message, "player");
		return Ok({ message, serverNow: Date.now() });
	}

	/// <summary>
	/// Vote in a poll, change the vote or take it back (an empty list). Every member online sees the new count at once.
	/// </summary>
	/// <param name="entry">Directory entry of the voting owl</param>
	/// <param name="data">{ chatId, messageId, options } where options are the indexes of the chosen answers</param>
	/// <returns>Result carrying { chatId, messageId, votes } with every vote in the poll</returns>
	async Vote(entry, data)
	{
		if (!this.#voteLimiter.allow(entry.number))
		{
			return Fail("error.slowDown");
		}

		const chatId = this.#ReadId(data.chatId);
		const messageId = this.#ReadId(data.messageId);
		const chat = chatId > 0 ? await this.#database.GetChatForMember(chatId, entry.number) : null;

		if (!chat || chat.kind !== "group")
		{
			return Fail("error.chatGone");
		}

		const message = messageId > 0 ? await this.#database.GetVisibleMessage(chatId, entry.number, messageId) : null;
		const poll = message && message.kind === MessageKind.Poll && message.unsentAt === 0 ? ReadPoll(message.body) : null;

		if (!poll)
		{
			return Fail("error.pollGone");
		}

		const requested = Array.isArray(data.options) ? data.options.slice(0, poll.options.length).map(Number) : [];
		const options = [...new Set(requested)].filter((index) => Number.isInteger(index) && index >= 0 && index < poll.options.length).sort((first, second) => first - second);

		if (options.length !== requested.length)
		{
			return Fail("error.pollChoice");
		}

		if (!poll.multiple && options.length > 1)
		{
			return Fail("error.pollOneAnswer");
		}

		if (!await this.#database.SetPollVotes(messageId, entry.number, options))
		{
			return Fail("error.voteFailed");
		}

		const votes = await this.#database.ListPollVotes(messageId) || [];
		this.#PushToMembers(chat.members, entry.number, "poll:votes", { chatId, messageId, votes });
		return Ok({ chatId, messageId, votes });
	}

	/// <summary>
	/// Send an owl carrying where its sender stands right now. The position is read on the server, never taken from the page.
	/// It flies, lands, counts as unread and is blocked exactly like a written owl.
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <param name="data">{ chatId }</param>
	/// <returns>Result carrying { message, serverNow }</returns>
	async SendLocation(entry, data)
	{
		if (!this.#config.phonemode_locations.enabled)
		{
			return Fail("error.locationsOff");
		}

		if (!this.#sendLimiter.allow(entry.number))
		{
			return Fail("error.owlsTired");
		}

		const chatId = this.#ReadId(data.chatId);
		const chat = chatId > 0 ? await this.#database.GetChatForMember(chatId, entry.number) : null;

		if (!chat)
		{
			return Fail("error.chatGone");
		}

		const { error, replyTo } = await this.#CheckWritable(entry, chat);

		if (error)
		{
			return Fail(error);
		}

		// Official senders' reply handlers take written answers only.
		if (replyTo)
		{
			return Fail("error.writtenRepliesOnly");
		}

		const location = this.#locations.Capture(entry);

		if (!location)
		{
			return Fail("error.positionUnknown");
		}

		const message = await this.#database.InsertMessage(chatId, entry.number, JSON.stringify(location), this.#flight.GetDeliverAt(entry, chat), MessageKind.Location);

		if (!message)
		{
			return Fail("error.sendFailed");
		}

		await this.#Publish(chat, message);
		this.#Record(chat, message, "player");
		return Ok({ message, serverNow: Date.now() });
	}

	/// <summary>
	/// Leave a group chat ("bulk owl"). Its history goes with the leaver's membership; the others see a "left" note.
	/// One-to-one chats cannot be left: there is exactly one per pair, and starting a new owl lands back in it.
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <param name="data">{ chatId }</param>
	/// <returns>Result carrying { chatId }</returns>
	async Leave(entry, data)
	{
		const chatId = this.#ReadId(data.chatId);
		const chat = chatId > 0 ? await this.#database.GetChatForMember(chatId, entry.number) : null;

		if (!chat)
		{
			return Fail("error.chatGone");
		}

		if (chat.kind !== "group")
		{
			return Fail("error.onlyBulkLeave");
		}

		const result = await this.#database.LeaveChat(chatId, entry.number);

		if (!result)
		{
			return Fail("error.leaveFailed");
		}

		await this.#AnnounceDeparture(chat, entry.number, result);
		this.#audit.Log("groups", "Left a bulk owl", `${this.#hooks.Describe(entry.number)} left "${chat.title || "untitled"}" (#${chat.id}); ${result.members.length} member(s) remain.`);

		return Ok({ chatId });
	}

	/// <summary>
	/// Tell the members left behind that someone is gone from a bulk owl, and who took over if the last admin went.
	/// </summary>
	/// <param name="chat">Group as it was before they went</param>
	/// <param name="number">Owl number that went</param>
	/// <param name="result">What OwlDatabase.LeaveChat returned</param>
	async #AnnounceDeparture(chat, number, result)
	{
		// The note carries the shrunken member list, so the others' headers update without another request.
		const remaining = { ...chat, members: result.members, admins: [...chat.admins.filter((admin) => admin !== number && result.members.includes(admin)), ...(result.promoted ? [result.promoted] : [])] };
		await this.#Publish(remaining, result.message);

		// The last admin went, so the longest-standing member took over.
		if (result.promoted)
		{
			this.#PushToMembers(remaining.members, "", "chat:update", { chat: this.#GetChatPatch(remaining) });
			await this.#PostNote(remaining, result.promoted, MessageKind.Promoted, { target: result.promoted });
		}
	}

	/// <summary>
	/// Take the owl of a deleted character out of every bulk owl it was in, each with a note for the others.
	/// Its one-to-one chats stay, so the other owl can still read them; they just cannot write there any more.
	/// </summary>
	/// <param name="number">Retired owl number</param>
	/// <returns>How many bulk owls it left, or -1 when its chats could not be read</returns>
	async RetireOwl(number)
	{
		const memberships = await this.#database.ListChatsOf(number);

		if (!memberships)
		{
			return -1;
		}

		let left = 0;

		for (const membership of memberships.filter((candidate) => candidate.kind === "group"))
		{
			const chat = await this.#database.GetChat(membership.id);
			const result = chat ? await this.#database.LeaveChat(chat.id, number, MessageKind.Retired) : null;

			if (result)
			{
				await this.#AnnounceDeparture(chat, number, result);
				++left;
			}
		}

		return left;
	}

	/// <summary>
	/// Silence a chat's notifications for a while, for good, or turn them back on. Unread counts keep working either way.
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <param name="data">{ chatId, minutes } where minutes is 0 (unmute), 60, 480, 1440 or -1 (until unmuted)</param>
	/// <returns>Result carrying { chatId, mutedUntil }</returns>
	async Mute(entry, data)
	{
		const chatId = this.#ReadId(data.chatId);
		const minutes = Number(data.minutes);

		if (!muteChoices.includes(minutes))
		{
			return Fail("error.muteChoice");
		}

		const mutedUntil = minutes === 0 ? 0 : minutes < 0 ? mutedForever : Date.now() + minutes * 60000;

		if (chatId === 0 || !await this.#database.SetMuted(chatId, entry.number, mutedUntil))
		{
			return Fail("error.chatGone");
		}

		return Ok({ chatId, mutedUntil });
	}

	/// <summary>
	/// Move an owl's read marker in a chat forward.
	/// Membership is enforced by the update itself: a non-member's marker does not exist to move.
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <param name="data">{ chatId, messageId }</param>
	/// <returns>Result with no payload</returns>
	async MarkRead(entry, data)
	{
		const chatId = this.#ReadId(data.chatId);
		const messageId = this.#ReadId(data.messageId);

		if (chatId === 0 || messageId === 0)
		{
			return Fail("error.nothingToRead");
		}

		const marker = await this.#database.MarkRead(chatId, entry.number, messageId);

		if (marker <= 0)
		{
			return Fail("error.readFailed");
		}

		if (this.#IsShared(entry.settings, "readReceipts"))
		{
			await this.#PushRead(entry, chatId, marker);
		}

		return Ok({ chatId, messageId: marker });
	}

	/// <summary>
	/// Tell the other members online who share read receipts how far an owl has read a chat.
	/// </summary>
	/// <param name="entry">Directory entry of the reader</param>
	/// <param name="chatId">Chat ID</param>
	/// <param name="messageId">The reader's read marker</param>
	async #PushRead(entry, chatId, messageId)
	{
		const others = this.#directory.All().filter((other) => other.number !== entry.number && this.#IsShared(other.settings, "readReceipts"));

		if (others.length === 0)
		{
			return;
		}

		// Channels hold every character on the server and have no receipts; GetChat gives them no members.
		const chat = await this.#database.GetChat(chatId);

		if (!chat || chat.kind === "channel")
		{
			return;
		}

		for (const other of others)
		{
			if (chat.members.includes(other.number))
			{
				this.#outbox.Push(other.player, "chat:read", { chatId, number: entry.number, messageId });
			}
		}
	}

	/// <summary>
	/// Show the other members of a chat that an owl is typing. Nothing is stored.
	/// Shown only to members online who share typing indicators and have not blocked the typist, and only if the typist shares them too.
	/// </summary>
	/// <param name="entry">Directory entry of the typist</param>
	/// <param name="data">{ chatId }</param>
	/// <returns>Result with no payload; it succeeds quietly even when nobody is told</returns>
	async Typing(entry, data)
	{
		const chatId = this.#ReadId(data.chatId);

		if (chatId === 0 || !this.#IsShared(entry.settings, "typingIndicators") || !this.#typingLimiter.allow(entry.number))
		{
			return Ok();
		}

		const audience = this.#directory.All().filter((other) => other.number !== entry.number && this.#IsShared(other.settings, "typingIndicators"));

		if (audience.length === 0)
		{
			return Ok();
		}

		const chat = await this.#database.GetChat(chatId);

		if (!chat || chat.kind === "channel" || !chat.members.includes(entry.number))
		{
			return Ok();
		}

		const listeners = audience.filter((other) => chat.members.includes(other.number));
		const blockers = listeners.length > 0 ? await this.#blocks.ListBlockersAmong(entry.number, listeners.map((other) => other.number)) : new Set();

		for (const other of listeners)
		{
			if (blockers && !blockers.has(other.number))
			{
				this.#outbox.Push(other.player, "chat:typing", { chatId, number: entry.number, durationMs: typingDurationMs });
			}
		}

		return Ok();
	}

	// ========================
	// Message Actions
	// ========================

	/// <summary>
	/// Take back an owl you sent, within phonemode_messages.unsendSeconds of sending it. Its text is wiped for everyone.
	/// An owl still in flight never lands.
	/// </summary>
	/// <param name="entry">Directory entry of the sender</param>
	/// <param name="data">{ chatId, messageId }</param>
	/// <returns>Result carrying { chatId, messageId, unsentAt }</returns>
	async Unsend(entry, data)
	{
		const seconds = this.#config.phonemode_messages.unsendSeconds;

		if (seconds <= 0)
		{
			return Fail("error.unsendOff");
		}

		const chatId = this.#ReadId(data.chatId);
		const messageId = this.#ReadId(data.messageId);
		const chat = chatId > 0 ? await this.#database.GetChat(chatId) : null;

		if (!chat || chat.kind === "channel" || !chat.members.includes(entry.number))
		{
			return Fail("error.chatGone");
		}

		const unsentAt = messageId > 0 ? await this.#database.UnsendMessage(chatId, messageId, entry.number, Date.now() - seconds * 1000) : 0;

		if (unsentAt < 0)
		{
			return Fail("error.unsendFailed");
		}

		if (unsentAt === 0)
		{
			return Fail(seconds >= 120 ? Problem("error.unsendWindowMinutes", { count: Math.round(seconds / 60) }) : Problem("error.unsendWindowSeconds", { count: seconds }));
		}

		const timer = this.#flights.get(messageId);

		if (timer !== undefined)
		{
			clearTimeout(timer);
			this.#flights.delete(messageId);
		}

		this.#PushToMembers(chat.members, entry.number, "message:unsent", { chatId, messageId, unsentAt });
		this.#audit.Log("messages", "Owl unsent", `${this.#hooks.Describe(entry.number)} unsent owl #${messageId} in chat #${chatId}.`);
		return Ok({ chatId, messageId, unsentAt });
	}

	/// <summary>
	/// Delete an owl from your own phone only. Everyone else keeps it.
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <param name="data">{ chatId, messageId }</param>
	/// <returns>Result carrying { chatId, messageId }</returns>
	async Hide(entry, data)
	{
		const chatId = this.#ReadId(data.chatId);
		const messageId = this.#ReadId(data.messageId);
		const message = chatId > 0 && messageId > 0 ? await this.#database.GetVisibleMessage(chatId, entry.number, messageId) : null;

		if (!message || !await this.#database.HideMessage(entry.number, chatId, messageId))
		{
			return Fail("error.owlGone");
		}

		return Ok({ chatId, messageId });
	}

	/// <summary>
	/// Pin an owl at the top of a chat for every member, or take the pin down. In a bulk owl only admins may; in a one-to-one chat either owl may.
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <param name="data">{ chatId, messageId } where messageId 0 unpins</param>
	/// <returns>Result carrying { chatId, pinnedMessage }</returns>
	async PinMessage(entry, data)
	{
		const chatId = this.#ReadId(data.chatId);
		const messageId = this.#ReadId(data.messageId);
		const summary = chatId > 0 ? await this.#database.GetChatForMember(chatId, entry.number) : null;

		if (!summary || summary.kind === "channel")
		{
			return Fail("error.chatGone");
		}

		if (summary.kind === "group" && !summary.admins.includes(entry.number))
		{
			return Fail("error.pinAdminsOnly");
		}

		const message = messageId > 0 ? await this.#database.GetVisibleMessage(chatId, entry.number, messageId) : null;

		if (messageId > 0 && (!message || !owlKinds.includes(message.kind) || message.unsentAt > 0))
		{
			return Fail("error.cannotPin");
		}

		if (!summary.pinnedMessage && messageId === 0)
		{
			return Ok({ chatId, pinnedMessage: null });
		}

		if (!await this.#database.SetPinnedMessage(chatId, messageId))
		{
			return Fail("error.pinFailed");
		}

		const chat = await this.#database.GetChat(chatId);
		const pinnedMessage = message ? { ...ToQuote(message), sentAt: message.sentAt } : null;

		if (chat)
		{
			this.#PushToMembers(chat.members, "", "chat:update", { chat: { id: chatId, pinnedMessage } });
			await this.#PostNote(chat, entry.number, message ? MessageKind.Pinned : MessageKind.Unpinned);
		}

		return Ok({ chatId, pinnedMessage });
	}

	/// <summary>
	/// Pin a chat to the top of your own chat list, or unpin it.
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <param name="data">{ chatId, pinned }</param>
	/// <returns>Result carrying { chatId, pinnedAt }</returns>
	async PinChat(entry, data)
	{
		const chatId = this.#ReadId(data.chatId);
		const pinned = data.pinned === true;
		const limit = this.#config.phonemode_messages.maxPinnedChats;

		if (pinned)
		{
			const count = await this.#database.CountPinnedChats(entry.number);

			if (count < 0)
			{
				return Fail("error.chatPinFailed");
			}

			if (count >= limit)
			{
				return Fail(limit === 0 ? "error.chatPinsOff" : Problem("error.chatPinLimit", { count: limit }));
			}
		}

		const pinnedAt = pinned ? Date.now() : 0;

		if (chatId === 0 || !await this.#database.SetChatPinned(chatId, entry.number, pinnedAt))
		{
			return Fail("error.chatGone");
		}

		return Ok({ chatId, pinnedAt });
	}

	// ========================
	// Group Administration
	// ========================

	/// <summary>
	/// Rename a bulk owl. Admins only.
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <param name="data">{ chatId, title }</param>
	/// <returns>Result carrying { chatId, title }</returns>
	async Rename(entry, data)
	{
		const { chat, error } = await this.#GetAdministeredGroup(entry, data.chatId);

		if (!chat)
		{
			return Fail(error);
		}

		const title = this.#hmp.text.clean(data.title, this.#config.phonemode_groups.maxTitleLength).replace(/\s+/g, " ").trim();

		if (title === chat.title)
		{
			return Ok({ chatId: chat.id, title });
		}

		if (!await this.#database.SetChatTitle(chat.id, title))
		{
			return Fail("error.renameFailed");
		}

		const updated = await this.#RefreshMembers(chat.id) || { ...chat, title };
		await this.#PostNote(updated, entry.number, MessageKind.Renamed, { title });
		this.#audit.Log("groups", "Bulk owl renamed", `${this.#hooks.Describe(entry.number)} renamed #${chat.id} from "${chat.title || "untitled"}" to "${title || "untitled"}".`);
		return Ok({ chatId: chat.id, title });
	}

	/// <summary>
	/// Change or clear a bulk owl's picture. Admins only.
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <param name="data">{ chatId, avatarUrl } where an empty link clears it</param>
	/// <returns>Result carrying { chatId, avatarUrl }</returns>
	async SetPicture(entry, data)
	{
		const { chat, error } = await this.#GetAdministeredGroup(entry, data.chatId);

		if (!chat)
		{
			return Fail(error);
		}

		const avatar = CheckAvatarUrl(data.avatarUrl, this.#config.avatars);

		if (!avatar.ok)
		{
			return Fail(avatar.error);
		}

		if (avatar.url === chat.avatarUrl)
		{
			return Ok({ chatId: chat.id, avatarUrl: avatar.url });
		}

		if (!await this.#database.SetChatAvatar(chat.id, avatar.url))
		{
			return Fail("error.pictureFailed");
		}

		const updated = await this.#RefreshMembers(chat.id) || { ...chat, avatarUrl: avatar.url };
		await this.#PostNote(updated, entry.number, MessageKind.Picture, { cleared: avatar.url === "" });
		return Ok({ chatId: chat.id, avatarUrl: avatar.url });
	}

	/// <summary>
	/// Add contacts to a bulk owl. Admins only. Owls that blocked the admin are skipped without saying why.
	/// New members see the bulk owl's history from the moment they were added.
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <param name="data">{ chatId, contactIds }</param>
	/// <returns>Result carrying { chatId, added } where added counts the owls added</returns>
	async AddMembers(entry, data)
	{
		const { chat, error } = await this.#GetAdministeredGroup(entry, data.chatId);

		if (!chat)
		{
			return Fail(error);
		}

		const room = this.#config.phonemode_groups.maxMembers - chat.members.length;
		const requested = Array.isArray(data.contactIds) ? data.contactIds.slice(0, this.#config.phonemode_groups.maxMembers).map((id) => this.#ReadId(id)).filter((id) => id > 0) : [];
		const contacts = await this.#database.ListContacts(entry.number);

		if (!contacts)
		{
			return Fail("error.contactsReadFailed");
		}

		const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
		const retired = await this.#database.ListRetiredAmong(contacts.map((contact) => contact.number));
		const candidates = [...new Set(requested.map((id) => contactsById.get(id)).filter((contact) => contact && !IsSenderNumber(contact.number) && !retired.has(contact.number) && !chat.members.includes(contact.number)).map((contact) => contact.number))];

		if (candidates.length === 0)
		{
			return Fail("error.addNoneNew");
		}

		if (candidates.length > room)
		{
			return Fail(room <= 0 ? "error.bulkFull" : Problem("error.bulkRoom", { count: room }));
		}

		const blockers = await this.#blocks.ListBlockersAmong(entry.number, candidates);
		const allowed = candidates.filter((number) => blockers && !blockers.has(number));
		const added = allowed.length > 0 ? await this.#database.AddMembers(chat.id, allowed) : [];

		if (added === null)
		{
			return Fail("error.addFailed");
		}

		const updated = await this.#RefreshMembers(chat.id);

		if (updated)
		{
			for (const number of added)
			{
				const target = this.#directory.GetByNumber(number);
				const summary = target ? await this.#database.GetChatForMember(chat.id, number) : null;

				if (summary)
				{
					this.#outbox.Push(target.player, "chat:upsert", { chat: summary });
				}

				await this.#PostNote(updated, entry.number, MessageKind.Added, { target: number });
			}
		}

		if (added.length > 0)
		{
			this.#audit.Log("groups", "Added to a bulk owl", `${this.#hooks.Describe(entry.number)} added ${added.map(this.#hooks.Describe).join(", ")} to "${chat.title || "untitled"}" (#${chat.id}).`);
		}

		return Ok({ chatId: chat.id, added: added.length, skipped: candidates.length - added.length });
	}

	/// <summary>
	/// Remove someone from a bulk owl. Admins only; nobody can remove its creator, and you leave rather than remove yourself.
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <param name="data">{ chatId, number }</param>
	/// <returns>Result carrying { chatId, number }</returns>
	async RemoveMember(entry, data)
	{
		const { chat, error } = await this.#GetAdministeredGroup(entry, data.chatId);

		if (!chat)
		{
			return Fail(error);
		}

		const number = String(data.number || "");

		if (!chat.members.includes(number) || number === entry.number)
		{
			return Fail(number === entry.number ? "error.leaveInstead" : "error.notMember");
		}

		if (number === chat.createdBy)
		{
			return Fail("error.creatorStays");
		}

		const result = await this.#database.RemoveMember(chat.id, number);

		if (!result || !result.removed)
		{
			return Fail("error.removeFailed");
		}

		const target = this.#directory.GetByNumber(number);

		if (target)
		{
			this.#outbox.Push(target.player, "chat:removed", { chatId: chat.id, title: chat.title });
		}

		const updated = await this.#RefreshMembers(chat.id);

		if (updated)
		{
			await this.#PostNote(updated, entry.number, MessageKind.Removed, { target: number });
		}

		this.#audit.Log("groups", "Removed from a bulk owl", `${this.#hooks.Describe(entry.number)} removed ${this.#hooks.Describe(number)} from "${chat.title || "untitled"}" (#${chat.id}).`);
		return Ok({ chatId: chat.id, number });
	}

	/// <summary>
	/// Make a member an admin of a bulk owl, or take it away. Admins only; the creator always stays an admin and nobody changes their own role.
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <param name="data">{ chatId, number, admin }</param>
	/// <returns>Result carrying { chatId, number, admin }</returns>
	async SetAdmin(entry, data)
	{
		const { chat, error } = await this.#GetAdministeredGroup(entry, data.chatId);

		if (!chat)
		{
			return Fail(error);
		}

		const number = String(data.number || "");
		const admin = data.admin === true;

		if (!chat.members.includes(number) || number === entry.number)
		{
			return Fail(number === entry.number ? "error.ownRole" : "error.notMember");
		}

		if (!admin && number === chat.createdBy)
		{
			return Fail("error.creatorAdmin");
		}

		if (chat.admins.includes(number) === admin)
		{
			return Ok({ chatId: chat.id, number, admin });
		}

		if (!await this.#database.SetMemberRole(chat.id, number, admin ? MemberRole.Admin : MemberRole.Member))
		{
			return Fail("error.roleFailed");
		}

		const updated = await this.#RefreshMembers(chat.id);

		if (updated)
		{
			await this.#PostNote(updated, entry.number, admin ? MessageKind.Promoted : MessageKind.Demoted, { target: number });
		}

		this.#audit.Log("groups", admin ? "Bulk owl admin added" : "Bulk owl admin removed", `${this.#hooks.Describe(entry.number)} ${admin ? "made" : "took admin from"} ${this.#hooks.Describe(number)}${admin ? " an admin of" : " in"} "${chat.title || "untitled"}" (#${chat.id}).`);
		return Ok({ chatId: chat.id, number, admin });
	}

	// ========================
	// System Senders
	// ========================

	/// <summary>
	/// Send a one-to-one owl from a system sender to one character's owl.
	/// </summary>
	/// <param name="sender">Live sender registration</param>
	/// <param name="toNumber">Recipient's owl number</param>
	/// <param name="rawBody">Message text</param>
	/// <param name="delaySeconds">Flight time in seconds; 0 lands at once</param>
	/// <returns>{ ok, error, chatId, messageId }</returns>
	async SendFromSender(sender, toNumber, rawBody, delaySeconds)
	{
		return this.DeliverFromSender(sender, toNumber, this.#CleanBody(rawBody, this.#config.announcements.maxLength), delaySeconds);
	}

	/// <summary>
	/// Send an owl from a system sender whose text is already cleaned, such as an official letter from immersive mode (see Mail.CleanLetter).
	/// </summary>
	/// <param name="sender">Live sender registration</param>
	/// <param name="toNumber">Recipient's owl number</param>
	/// <param name="body">Cleaned message text</param>
	/// <param name="delaySeconds">Flight time in seconds; 0 lands at once</param>
	/// <returns>{ ok, error, chatId, messageId }</returns>
	async DeliverFromSender(sender, toNumber, body, delaySeconds)
	{
		if (body.length === 0)
		{
			return { ok: false, error: "An owl needs a message.", chatId: 0, messageId: 0 };
		}

		if (!/^\d{8}$/.test(toNumber) || IsSenderNumber(toNumber))
		{
			return { ok: false, error: "That is not a character's owl.", chatId: 0, messageId: 0 };
		}

		if ((await this.#database.ListRetiredAmong([toNumber])).has(toNumber))
		{
			return { ok: false, error: "That owl no longer flies; its character was deleted.", chatId: 0, messageId: 0 };
		}

		const chatId = await this.#EnsureDirectChat(sender.number, toNumber);
		const chat = chatId > 0 ? await this.#database.GetChat(chatId) : null;

		if (!chat)
		{
			return { ok: false, error: "The chat could not be opened.", chatId: 0, messageId: 0 };
		}

		const delay = Math.min(3600, Math.max(0, Number(delaySeconds) || 0));
		const message = await this.#database.InsertMessage(chatId, sender.number, body, delay > 0 ? Date.now() + Math.round(delay * 1000) : 0);

		if (!message)
		{
			return { ok: false, error: "The owl could not be stored.", chatId, messageId: 0 };
		}

		await this.#Publish(chat, message);
		this.#Record(chat, message, "system");
		return { ok: true, error: "", chatId, messageId: message.id };
	}

	/// <summary>
	/// Post an announcement to a system sender's channel, which every character with an owl belongs to.
	/// </summary>
	/// <param name="sender">Live sender registration</param>
	/// <param name="rawBody">Message text</param>
	/// <returns>{ ok, error, chatId, messageId }</returns>
	async Broadcast(sender, rawBody)
	{
		return this.DeliverAnnouncement(sender, this.#CleanBody(rawBody, this.#config.announcements.maxLength));
	}

	/// <summary>
	/// Post an announcement whose text is already cleaned, such as an official letter to everyone from immersive mode.
	/// </summary>
	/// <param name="sender">Live sender registration</param>
	/// <param name="body">Cleaned message text</param>
	/// <returns>{ ok, error, chatId, messageId }</returns>
	async DeliverAnnouncement(sender, body)
	{
		if (body.length === 0)
		{
			return { ok: false, error: "An announcement needs a message.", chatId: 0, messageId: 0 };
		}

		const chatId = await this.#database.EnsureChannel(sender.number, sender.name);

		if (chatId <= 0 || !await this.#database.JoinEveryoneToChannel(chatId))
		{
			return { ok: false, error: "The announcement channel could not be prepared.", chatId: 0, messageId: 0 };
		}

		const chat = await this.#database.GetChat(chatId);
		const message = chat ? await this.#database.InsertMessage(chatId, sender.number, body, 0) : null;

		if (!message)
		{
			return { ok: false, error: "The announcement could not be stored.", chatId, messageId: 0 };
		}

		await this.#Publish(chat, message);
		this.#Record(chat, message, "announcement");
		return { ok: true, error: "", chatId, messageId: message.id };
	}
}

module.exports = { ChatService };
