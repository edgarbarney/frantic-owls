// FranticDreamer 2026
"use strict";

const { Ok, Fail, FailWith } = require("./Result.js");
const Lang = require("./Lang.js");
const { ClampInteger, maxOfficialRecipients } = require("./Config.js");
const { IsSenderNumber, MessageKind, ReadPoll } = require("./Database.js");
const { ParseLocation } = require("./Locations.js");
const { AddContactStatus } = require("./Contacts.js");

/// <summary>
/// Letter boxes immersive mode lists.
/// </summary>
const boxes = Object.freeze(["inbox", "sent"]);

/// <summary>
/// Longest line of a letter shown in the list of letters (its opening and its signature).
/// </summary>
const maxExcerptLength = 80;

/// <summary>
/// Most blank lines kept in a row. A letter keeps its spacing, but a page of nothing is not a letter.
/// </summary>
const maxBlankLines = 3;

/// <summary>
/// Spaces a tab becomes. The letter page has no tab stops, so a tab is written out as the spaces it would have looked like.
/// </summary>
const tabSpaces = "    ";

/// <summary>
/// Longest name kept for a correspondent first addressed by answering their letter.
/// </summary>
const maxReplyLabelLength = 64;

// ========================
// Letters
// ========================

/// <summary>
/// Clean a letter's text without changing how it looks: spaces, indents and blank lines are kept, unlike a phone owl's.
/// Control characters (and the invisible ones that reorder text) are removed, tabs become spaces, trailing spaces go,
/// and the letter is cut to its line and character limits.
/// </summary>
/// <param name="raw">Text as supplied</param>
/// <param name="maxLength">Longest allowed length</param>
/// <param name="maxLines">Most lines kept</param>
/// <returns>Cleaned text, possibly empty</returns>
function CleanLetter(raw, maxLength, maxLines)
{
	let text = String(raw ?? "").replace(/\r\n?/g, "\n").replace(/\t/g, tabSpaces);

	// Bidirectional overrides (U+202A-U+202E, U+2066-U+2069) would let a line draw differently from how it reads.
	text = text.replace(/[\u0000-\u0009\u000B-\u001F\u007F‪-‮⁦-⁩]/g, "");
	text = text.replace(/[  ]+$/gm, "");
	text = text.replace(new RegExp(`\\n{${maxBlankLines + 2},}`, "g"), "\n".repeat(maxBlankLines + 1));
	text = text.split("\n").slice(0, maxLines).join("\n");

	// Leading blank lines are dropped, but a first line's indent is kept.
	return text.replace(/^\n+/, "").replace(/\s+$/, "").slice(0, maxLength);
}

/// <summary>
/// Cut a line of a letter for the list of letters.
/// </summary>
/// <param name="line">Line, already trimmed</param>
/// <returns>The line, shortened with an ellipsis when too long</returns>
function Excerpt(line)
{
	return line.length > maxExcerptLength ? `${line.slice(0, maxExcerptLength - 1)}…` : line;
}

/// <summary>
/// The text a letter is read as. Written owls are their own text; location and poll owls from phone mode are written out in words.
/// </summary>
/// <param name="message">Message record</param>
/// <param name="language">Reader's language, for the words around a location or poll</param>
/// <returns>Letter text</returns>
function GetLetterText(message, language)
{
	if (message.kind === MessageKind.Location)
	{
		const location = ParseLocation(message.body);
		return Lang.Translate(language, "mail.letter.location", { place: location && location.place ? location.place : Lang.Translate(language, "mail.letter.unknownPlace") });
	}

	if (message.kind === MessageKind.Poll)
	{
		const poll = ReadPoll(message.body);
		return poll ? `${poll.question}\n\n${poll.options.map((option) => `• ${option}`).join("\n")}` : "";
	}

	return String(message.body || "");
}

/// <summary>
/// A contact as immersive mode's page gets it.
///
/// <para>
/// NOTE: A contact whose character the owner does not know (identityKnown false, e.g. first reached by answering an unsigned letter) is sent without its owl number or profile picture.
/// The page matches correspondents against characters found by name by their numbers; a number it never sees cannot show which character an anonymous writer is.
/// </para>
///
/// </summary>
/// <param name="contact">Contact record</param>
/// <param name="avatarsEnabled">Whether correspondents have pictures on this server (immersivemode_avatars)</param>
/// <returns>{ id, number, name, originalName, avatarUrl, profileAvatarUrl, favourite }</returns>
function ToDeskContact(contact, avatarsEnabled)
{
	const known = contact.identityKnown === true;

	return {
		id: contact.id,
		number: known ? contact.number : "",
		name: contact.name,
		originalName: contact.originalName || "",
		avatarUrl: avatarsEnabled ? contact.avatarUrl : "",
		profileAvatarUrl: avatarsEnabled && known ? contact.profileAvatarUrl : "",
		favourite: contact.favourite === true,
	};
}

// ========================
// Mail Service
// ========================

/// <summary>
/// Immersive mode's owl post: letters listed as an inbox and a sent box, read at a desk and written on parchment.
///
/// <para>
/// NOTE: A letter is an ordinary owl in the one-to-one chat of its writer and reader, so phone mode reads the same rows and a server can switch mode freely.
/// A letter to several owls is stored as one owl per recipient; nobody is ever put in a bulk owl by writing to several people at once.
/// </para>
///
/// <para>
/// NOTE: Readers are never told who wrote a letter (official senders aside). A writer may sign it however they like, or not at all,
/// and the letter's text is all the reader learns; the database still records the sender of every owl.
/// The list of letters therefore carries the first and last lines of a letter (its greeting and, usually, its signature) instead of a sender.
/// </para>
///
/// <para>
/// NOTE: Where letters may be read and written is the server's call (immersivemode_readmode and immersivemode_writemode).
/// A letter's text only leaves the server when it may be read where the reader stands, so a modified page learns nothing more than an honest one.
/// </para>
///
/// <para>
/// NOTE: A chat has one read marker per member, while letters are opened one at a time and in any order.
/// Letters opened ahead of an older unread one are remembered here until the older one is opened too, and the marker then moves past them all.
/// That memory lasts for the session; after a reconnect such letters simply show as unread again.
/// </para>
///
/// </summary>
class MailService
{
	/// <summary>
	/// OwlDatabase instance.
	/// </summary>
	#database;

	/// <summary>
	/// OwlDirectory instance, for owls online.
	/// </summary>
	#directory;

	/// <summary>
	/// ChatService instance, which stores and delivers each copy of a letter.
	/// </summary>
	#chats;

	/// <summary>
	/// ContactService instance, for the writer's correspondents.
	/// </summary>
	#contacts;

	/// <summary>
	/// PostService instance, for whether a player stands at an owl post.
	/// </summary>
	#posts;

	/// <summary>
	/// SenderRegistry instance, for official letters.
	/// </summary>
	#senders;

	/// <summary>
	/// OwlRoster instance: every character with an owl, by name.
	/// </summary>
	#roster;

	/// <summary>
	/// AuditLog instance, for official letters.
	/// </summary>
	#audit;

	/// <summary>
	/// Async function (player) => boolean: whether a player may send official letters (the announcement permission).
	/// </summary>
	#CanPostOfficial;

	/// <summary>
	/// ParcelService instance, for Galleons sent with a letter.
	/// </summary>
	#parcels;

	/// <summary>
	/// hmp-lib server import, for rate limits and text cleaning.
	/// </summary>
	#hmp;

	/// <summary>
	/// Full server configuration.
	/// </summary>
	#config;

	/// <summary>
	/// Per-owl limiter for sending letters, keyed by owl number. One letter counts once, however many owls it goes to.
	/// </summary>
	#sendLimiter;

	/// <summary>
	/// Letters opened ahead of an older unread letter of the same chat, by owl number: Set of message IDs.
	/// </summary>
	#opened = new Map();

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
	/// Whether a letter in an owl's inbox still counts as unread for them.
	/// </summary>
	/// <param name="entry">Directory entry of the reader</param>
	/// <param name="letter">Letter record with lastRead</param>
	/// <returns>True when unread</returns>
	#IsUnread(entry, letter)
	{
		const opened = this.#opened.get(entry.number);
		return letter.sender !== entry.number && letter.id > letter.lastRead && !(opened && opened.has(letter.id));
	}

	/// <summary>
	/// Why a letter may not be read where its reader stands, if it may not.
	/// </summary>
	/// <param name="isUnread">Whether the letter is still unread</param>
	/// <param name="post">Owl post the reader stands at, or null</param>
	/// <returns>Text key of the reason, or null when it may be read</returns>
	#GetReadProblem(isUnread, post)
	{
		switch (this.#config.immersivemode_readmode)
		{
		case "postonly":
			return post ? null : "error.mail.readAtPost";
		case "postonly_freeunread":
			return post || isUnread ? null : "error.mail.readOldAtPost";
		default:
			return null;
		}
	}

	/// <summary>
	/// Why letters may not be written where the writer stands, if they may not.
	/// </summary>
	/// <param name="post">Owl post the writer stands at, or null</param>
	/// <returns>Text key of the reason, or null when writing is allowed</returns>
	#GetWriteProblem(post)
	{
		return this.#config.immersivemode_writemode === "postonly" && !post ? "error.mail.writeAtPost" : null;
	}

	/// <summary>
	/// Whether a letter in an owl's inbox can be answered.
	/// </summary>
	/// <param name="letter">Letter record with chatKind</param>
	/// <returns>True when a reply could be sent</returns>
	#CanReply(letter)
	{
		if (letter.chatKind === "channel")
		{
			return false;
		}

		if (IsSenderNumber(letter.sender))
		{
			const sender = this.#senders.GetByNumber(letter.sender);
			return !!(sender && sender.onReply);
		}

		return true;
	}

	/// <summary>
	/// A letter as the list of letters shows it. Its excerpt is only filled in when the letter may be read where the viewer stands.
	/// </summary>
	/// <param name="entry">Directory entry of the viewer</param>
	/// <param name="letter">Letter record from the database</param>
	/// <param name="post">Owl post the viewer stands at, or null</param>
	/// <param name="names">Owl number to correspondent name, for a sent letter's recipients (see #GetCorrespondentNames)</param>
	/// <returns>{ id, box, sentAt, arrivedAt, isUnread, isReadable, readProblem, official, groupTitle, recipients, excerpt, canReply, parcel }</returns>
	#Summarise(entry, letter, post, names)
	{
		const box = letter.sender === entry.number ? "sent" : "inbox";
		const isUnread = box === "inbox" && this.#IsUnread(entry, letter);
		const readProblem = this.#GetReadProblem(isUnread, post);
		let excerpt = null;

		if (!readProblem)
		{
			const lines = GetLetterText(letter, entry.settings.language).split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
			excerpt = { first: Excerpt(lines[0] || ""), second: Excerpt(lines[1] || ""), last: lines.length > 2 ? Excerpt(lines[lines.length - 1]) : "" };
		}

		const senderName = box === "inbox" && IsSenderNumber(letter.sender) ? this.#senders.GetName(letter.sender) : "";

		return {
			id: letter.id,
			box,
			sentAt: letter.sentAt,
			arrivedAt: Math.max(letter.sentAt, letter.deliverAt),
			isUnread,
			isReadable: !readProblem,
			readProblem: readProblem || "",
			official: senderName ? { name: senderName } : null,
			groupTitle: letter.chatKind === "group" ? letter.chatTitle : "",
			recipients: box === "sent" ? (letter.members || []).map((number) => names.get(number) || "") : [],
			excerpt,
			canReply: box === "inbox" && this.#CanReply(letter),
			// A parcel shows only on a letter that can be read where the player stands, like its text: it is collected from the letter itself.
			parcel: readProblem ? null : letter.parcel || null,
		};
	}

	/// <summary>
	/// Remember that an owl opened a letter, and move its chat's read marker past every letter opened in a row from the oldest unread one.
	/// </summary>
	/// <param name="entry">Directory entry of the reader</param>
	/// <param name="letter">Letter just opened, which was unread</param>
	async #MarkOpened(entry, letter)
	{
		let opened = this.#opened.get(entry.number);

		if (!opened)
		{
			opened = new Set();
			this.#opened.set(entry.number, opened);
		}

		opened.add(letter.id);

		const unread = await this.#database.ListUnreadLetterIds(letter.chatId, entry.number);

		if (!unread)
		{
			return;
		}

		let marker = 0;

		for (const id of unread)
		{
			if (!opened.has(id))
			{
				break;
			}

			marker = id;
		}

		if (marker > 0 && await this.#database.MarkRead(letter.chatId, entry.number, marker) >= 0)
		{
			for (const id of unread)
			{
				if (id <= marker)
				{
					opened.delete(id);
				}
			}
		}
	}

	/// <summary>
	/// What the writer calls each of their correspondents, so the sent box can say who a letter went to.
	///
	/// <para>
	/// NOTE: Only the writer's own names for people are used, never the characters' names: a correspondent first reached by answering an unsigned letter is named the way the writer named them.
	/// A letter to someone no longer among the writer's correspondents says only that it went to someone.
	/// </para>
	///
	/// </summary>
	/// <param name="number">Writer's owl number</param>
	/// <returns>Map of owl number to name (empty on failure)</returns>
	async #GetCorrespondentNames(number)
	{
		const list = await this.#contacts.List(number) || [];
		return new Map(list.map((contact) => [contact.number, contact.name]));
	}

	/// <summary>
	/// Work out who a letter goes to from the recipients the page picked: correspondents by contact ID, anyone else by the owl number a search found.
	/// </summary>
	/// <param name="entry">Directory entry of the writer</param>
	/// <param name="raw">Client-supplied [{ contactId } | { number }]</param>
	/// <param name="limit">Most recipients allowed</param>
	/// <param name="allowSelf">True when the writer may address themselves (official letters)</param>
	/// <param name="targets">Map to fill: owl number to { name, saveAs, identityKnown } where saveAs is the name to save a new correspondent under ("" to save none)</param>
	/// <returns>Text key (or Lang.Problem) of the first problem, or null</returns>
	async #ResolveRecipients(entry, raw, limit, allowSelf, targets)
	{
		const requested = Array.isArray(raw) ? raw.slice(0, limit + 1) : [];

		for (const recipient of requested)
		{
			const source = recipient && typeof recipient === "object" ? recipient : {};
			const contactId = this.#ReadId(source.contactId);
			let number = "";
			let target = null;

			if (contactId > 0)
			{
				const contact = await this.#database.GetContact(entry.number, contactId);

				if (!contact)
				{
					return "error.mail.unknownRecipient";
				}

				number = contact.number;
				target = { name: contact.name, saveAs: "", identityKnown: contact.identityKnown };
			}
			else
			{
				number = String(source.number || "");

				// The roster holds every live character; one online is on it too, but is checked directly in case the roster could not be read.
				const online = /^\d{8}$/.test(number) && !IsSenderNumber(number) ? this.#directory.GetByNumber(number) : null;
				const name = online ? online.characterName : this.#roster.GetName(number);

				if (!name)
				{
					return "error.mail.unknownRecipient";
				}

				target = { name, saveAs: name, identityKnown: true };
			}

			if (number === entry.number && !allowSelf)
			{
				return "error.selfOwl";
			}

			if (!targets.has(number))
			{
				targets.set(number, target);
			}
		}

		return targets.size > limit ? Lang.Problem("error.mail.tooManyRecipients", { count: limit }) : null;
	}

	/// <summary>
	/// Constructor.
	/// </summary>
	/// <param name="services">{ database, directory, chats, contacts, posts, senders, roster, audit, hmp, config, CanPostOfficial, parcels }</param>
	constructor(services)
	{
		this.#database = services.database;
		this.#directory = services.directory;
		this.#chats = services.chats;
		this.#contacts = services.contacts;
		this.#posts = services.posts;
		this.#senders = services.senders;
		this.#roster = services.roster;
		this.#audit = services.audit;
		this.#CanPostOfficial = services.CanPostOfficial;
		this.#parcels = services.parcels;
		this.#hmp = services.hmp;
		this.#config = services.config;
		this.#sendLimiter = this.#hmp.rateLimit.create({ limit: this.#config.messages.rateLimitCount, windowMs: this.#config.messages.rateLimitWindowMs });
	}

	/// <summary>
	/// Drop rate-limit buckets nobody has used for a while. Call from a maintenance tick.
	/// </summary>
	Sweep()
	{
		this.#sendLimiter.sweep(this.#config.messages.rateLimitWindowMs * 4);
	}

	/// <summary>
	/// Forget the letters an owl opened out of order, once it goes offline.
	/// </summary>
	/// <param name="number">Owl number</param>
	Forget(number)
	{
		this.#opened.delete(number);
	}

	/// <summary>
	/// The owl post a player stands at, as the page shows it.
	/// </summary>
	/// <param name="player">Player handle</param>
	/// <returns>{ id, label }, or null</returns>
	GetPost(player)
	{
		const post = this.#posts.GetPostAt(player);
		return post ? { id: post.id, label: post.label } : null;
	}

	/// <summary>
	/// How many letters an owl has not read yet.
	/// </summary>
	/// <param name="number">Owl number</param>
	/// <returns>Count, 0 on failure</returns>
	async CountUnread(number)
	{
		return Math.max(0, await this.#database.CountUnreadLetters(number));
	}

	// ========================
	// Player Requests
	// ========================

	/// <summary>
	/// One page of an owl's inbox or sent box.
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <param name="data">{ box, beforeId } where beforeId 0 means the newest page</param>
	/// <returns>Result carrying { box, beforeId, letters, hasMore, post, unread, serverNow }</returns>
	async List(entry, data)
	{
		const box = boxes.includes(data.box) ? data.box : "inbox";
		const beforeId = this.#ReadId(data.beforeId);
		const page = await this.#database.ListLetters(entry.number, box, beforeId, this.#config.messages.pageSize);

		if (!page)
		{
			return Fail("error.mail.listFailed");
		}

		const post = this.#posts.GetPostAt(entry.player);
		const unread = await this.CountUnread(entry.number);
		const names = box === "sent" ? await this.#GetCorrespondentNames(entry.number) : new Map();
		const letters = page.letters.map((letter) => this.#Summarise(entry, letter, post, names));

		return Ok({ box, beforeId, letters, hasMore: page.hasMore, post: post ? { id: post.id, label: post.label } : null, unread, serverNow: Date.now() });
	}

	/// <summary>
	/// Open a letter to read it, if it may be read where the reader stands. An unread letter counts as read from then on.
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <param name="data">{ messageId }</param>
	/// <returns>Result carrying { letter } with the list entry's fields plus text</returns>
	async Open(entry, data)
	{
		const messageId = this.#ReadId(data.messageId);
		const letter = messageId > 0 ? await this.#database.GetLetter(entry.number, messageId) : null;

		if (letter === undefined)
		{
			return Fail("error.mail.openFailed");
		}

		if (!letter)
		{
			return Fail("error.mail.gone");
		}

		const post = this.#posts.GetPostAt(entry.player);
		const names = letter.sender === entry.number ? await this.#GetCorrespondentNames(entry.number) : new Map();
		const summary = this.#Summarise(entry, letter, post, names);

		if (summary.readProblem)
		{
			return Fail(summary.readProblem);
		}

		if (summary.isUnread)
		{
			await this.#MarkOpened(entry, letter);
		}

		return Ok({ letter: { ...summary, isUnread: false, text: GetLetterText(letter, entry.settings.language) }, unread: await this.CountUnread(entry.number) });
	}

	/// <summary>
	/// The owl post the player stands at, for a page that has just opened a screen where it matters.
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <returns>Result carrying { post }</returns>
	GetPlace(entry)
	{
		return Ok({ post: this.GetPost(entry.player) });
	}

	/// <summary>
	/// Collect the Galleons sent with a letter, if it may be read where the reader stands (a parcel is taken from the letter itself).
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <param name="data">{ messageId }</param>
	/// <returns>Result carrying { messageId, parcel }</returns>
	async Collect(entry, data)
	{
		const messageId = this.#ReadId(data.messageId);
		const letter = messageId > 0 ? await this.#database.GetLetter(entry.number, messageId) : null;

		if (letter === undefined)
		{
			return Fail("error.mail.openFailed");
		}

		if (!letter || letter.sender === entry.number)
		{
			return Fail("error.parcel.gone");
		}

		const readProblem = this.#GetReadProblem(this.#IsUnread(entry, letter), this.#posts.GetPostAt(entry.player));

		if (readProblem)
		{
			return Fail(readProblem);
		}

		return this.#parcels.Collect(entry, { chatId: letter.chatId, messageId });
	}

	/// <summary>
	/// Find characters to write to by a part of their name, online or not.
	///
	/// <para>
	/// NOTE: The roster is searched in memory, so typing a name costs the database nothing; the page waits for a pause in typing and asks at most once per pause.
	/// isComplete tells the page every match was sent, so it can narrow a longer search itself without asking again.
	/// The page puts the player's own correspondents first and leaves out the characters it already knows them as.
	/// </para>
	///
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <param name="data">{ query }</param>
	/// <returns>Result carrying { query, owls: [{ number, name, online }], isComplete }</returns>
	Search(entry, data)
	{
		const query = String(data.query || "").slice(0, 64);
		const found = this.#roster.Search(query, entry.number);
		const owls = found.owls.map((owl) => ({ ...owl, online: !!this.#directory.GetByNumber(owl.number) }));
		return Ok({ query, owls, isComplete: found.isComplete });
	}

	/// <summary>
	/// Save a character found by name as a correspondent, without writing to them.
	///
	/// <para>
	/// NOTE: If the character already is a correspondent saved without knowing who it is (an anonymous writer answered), the refusal does not name that correspondent.
	/// It still tells the player one of their unnamed correspondents is this character, which cannot be helped without letting one character be saved twice.
	/// </para>
	///
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <param name="data">{ number }</param>
	/// <returns>Result carrying { contact } as ToDeskContact makes it</returns>
	async AddCorrespondent(entry, data)
	{
		const targets = new Map();
		const problem = await this.#ResolveRecipients(entry, [{ number: data.number }], 1, false, targets);

		if (problem)
		{
			return Fail(problem);
		}

		const [number, target] = [...targets][0];
		const result = await this.#contacts.AddOnBehalf(entry.number, number, target.saveAs, true);

		switch (result.status)
		{
		case AddContactStatus.Added:
			return Ok({ contact: ToDeskContact(result.contact, this.#config.immersivemode_avatars) });
		case AddContactStatus.AlreadyKnown:
			return result.contact.identityKnown ? Fail(Lang.Problem("error.contactNumberTaken", { name: result.contact.name })) : Fail("error.mail.alreadyCorrespondent");
		case AddContactStatus.Full:
			return Fail("error.contactsFull");
		default:
			return Fail("error.contactSaveFailed");
		}
	}

	/// <summary>
	/// Send a letter: one copy to each recipient, each in the one-to-one chat the writer shares with them.
	/// Every recipient becomes one of the writer's correspondents (a contact); the recipients are not given the writer in return.
	///
	/// <para>
	/// NOTE: A letter can go to any character with an owl: a correspondent (by contact ID), anyone found by name (by owl number), or the writer of the letter being answered.
	/// Answering does not tell the page who it is answering: it names the letter, and the server finds its writer.
	/// The writer's page may name that correspondent itself (replyLabel), which is what they are saved as; nothing the server knows about them is used.
	/// </para>
	///
	/// <para>
	/// NOTE: The reply only says how many copies went and, for any that did not, the name the writer picked; it carries no owl numbers, for the reason ToDeskContact gives.
	/// </para>
	///
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <param name="data">{ recipients: [{ contactId } | { number }], replyToId, replyLabel, body, clientKey }</param>
	/// <returns>Result carrying { sent, failed: [{ name, errorKey }], contacts, clientKey }</returns>
	async Send(entry, data)
	{
		const clientKey = String(data.clientKey || "").slice(0, 64).replace(/[^A-Za-z0-9_-]/g, "");
		const letters = this.#config.immersivemode_letters;

		if (!this.#sendLimiter.allow(entry.number))
		{
			return Fail("error.owlsTired", { clientKey });
		}

		const writeProblem = this.#GetWriteProblem(this.#posts.GetPostAt(entry.player));

		if (writeProblem)
		{
			return Fail(writeProblem, { clientKey });
		}

		const body = CleanLetter(data.body, letters.maxLength, letters.maxLines);

		if (body.length === 0)
		{
			return Fail("error.emptyOwl", { clientKey });
		}

		const targets = new Map();
		const replyToId = this.#ReadId(data.replyToId);

		if (replyToId > 0)
		{
			const answered = await this.#database.GetLetter(entry.number, replyToId);

			if (!answered || answered.sender === entry.number || !this.#CanReply(answered))
			{
				return Fail("error.mail.cannotAnswer", { clientKey });
			}

			const label = this.#hmp.text.clean(data.replyLabel, maxReplyLabelLength).replace(/\s+/g, " ").trim();
			const isOfficial = IsSenderNumber(answered.sender);
			targets.set(answered.sender, { name: isOfficial ? this.#senders.GetName(answered.sender) : label, saveAs: isOfficial ? "" : label, identityKnown: false });
		}

		const problem = await this.#ResolveRecipients(entry, data.recipients, letters.maxRecipients, false, targets);

		if (problem)
		{
			return Fail(problem, { clientKey });
		}

		if (targets.size === 0)
		{
			return Fail("error.mail.noRecipients", { clientKey });
		}

		// Each copy carries its own parcel of the same Galleons, so the writer needs enough for every recipient before any copy goes. Items go to one recipient only.
		const request = this.#parcels.ReadRequest(data.parcel);
		let plan = null;

		if (request === undefined)
		{
			return Fail("error.parcel.invalid", { clientKey });
		}

		if (request)
		{
			const { problem, items } = await this.#parcels.Check(entry, request, targets.size);

			if (problem)
			{
				return FailWith(problem, { clientKey });
			}

			plan = { galleons: request.galleons, items };
		}

		let sent = 0;
		const failed = [];
		const added = [];

		for (const [number, target] of targets)
		{
			const result = await this.#chats.SendLetter(entry, number, body, plan);

			if (result.error)
			{
				failed.push({ name: target.name, errorKey: result.error });
				continue;
			}

			++sent;

			if (target.saveAs)
			{
				const saved = await this.#contacts.AddOnBehalf(entry.number, number, target.saveAs, target.identityKnown);

				if (saved.status === AddContactStatus.Added)
				{
					added.push(ToDeskContact(saved.contact, this.#config.immersivemode_avatars));
				}
			}
		}

		if (sent === 0)
		{
			return Fail(failed[0] ? failed[0].errorKey : "error.sendFailed", { clientKey, failed });
		}

		return Ok({ sent, failed, contacts: added, clientKey, serverNow: Date.now() });
	}

	// ========================
	// Official Letters
	// ========================

	/// <summary>
	/// The official senders a player may write as (the Ministry, and any other resource's sender that is running), if they may write official letters at all.
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <returns>Result carrying { senders: [{ number, name }] }</returns>
	async ListOfficialSenders(entry)
	{
		if (!await this.#CanPostOfficial(entry.player))
		{
			return Fail("error.mail.officialDenied");
		}

		const senders = this.#senders.GetClientList().filter((sender) => this.#senders.GetByNumber(sender.number)).map((sender) => ({ number: sender.number, name: sender.name }));
		return Ok({ senders });
	}

	/// <summary>
	/// Send an official letter as a system sender: to everyone, as an announcement, or one copy to each character named.
	///
	/// <para>
	/// NOTE: Official letters are not tied to owl posts and do not add anyone to the writer's correspondents, since it is the sender writing, not the character.
	/// Readers see the sender's name, as with any official owl, and cannot answer unless the sender's resource takes replies.
	/// </para>
	///
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <param name="data">{ sender: number, everyone, recipients: [{ contactId } | { number }], body, clientKey }</param>
	/// <returns>Result carrying { everyone, sent, failed: [{ name, errorKey }], clientKey }</returns>
	async SendOfficial(entry, data)
	{
		const clientKey = String(data.clientKey || "").slice(0, 64).replace(/[^A-Za-z0-9_-]/g, "");
		const letters = this.#config.immersivemode_letters;

		if (!await this.#CanPostOfficial(entry.player))
		{
			return Fail("error.mail.officialDenied", { clientKey });
		}

		if (!this.#sendLimiter.allow(entry.number))
		{
			return Fail("error.owlsTired", { clientKey });
		}

		const sender = this.#senders.GetByNumber(String(data.sender || ""));

		if (!sender)
		{
			return Fail("error.mail.senderGone", { clientKey });
		}

		const body = CleanLetter(data.body, letters.maxLength, letters.maxLines);

		if (body.length === 0)
		{
			return Fail("error.emptyOwl", { clientKey });
		}

		const writer = `${entry.characterName} (${entry.number}, player ${entry.playerId})`;

		if (data.everyone === true)
		{
			const result = await this.#chats.DeliverAnnouncement(sender, body);

			if (!result.ok)
			{
				return Fail("error.mail.officialFailed", { clientKey });
			}

			this.#audit.Log("announcements", "Official letter to everyone", `${writer} wrote to everyone as ${sender.name}.`);
			return Ok({ everyone: true, sent: 1, failed: [], clientKey });
		}

		const targets = new Map();
		const problem = await this.#ResolveRecipients(entry, data.recipients, maxOfficialRecipients, true, targets);

		if (problem)
		{
			return Fail(problem, { clientKey });
		}

		if (targets.size === 0)
		{
			return Fail("error.mail.noRecipients", { clientKey });
		}

		let sent = 0;
		const failed = [];

		for (const [number, target] of targets)
		{
			const result = await this.#chats.DeliverFromSender(sender, number, body, 0);

			if (result.ok)
			{
				++sent;
			}
			else
			{
				failed.push({ name: target.name, errorKey: "error.mail.officialFailed" });
			}
		}

		if (sent === 0)
		{
			return Fail("error.mail.officialFailed", { clientKey, failed });
		}

		this.#audit.Log("announcements", "Official letter", `${writer} wrote to ${sent} character(s) as ${sender.name}.`);
		return Ok({ everyone: false, sent, failed, clientKey });
	}
}

module.exports = { MailService, CleanLetter, ToDeskContact };
