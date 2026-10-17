// FranticDreamer 2026
"use strict";

const { Logger } = require("./Logger.js");

/// <summary>
/// Returned by every ID-producing call that failed. Database IDs start at 1, so this never collides with a real row.
/// </summary>
const invalidId = -1;

// ========================
// Schema
// ========================

/// <summary>
/// Versioned schema for hmp-mysql's migration ledger.
/// Applied migrations are checksummed, so never edit a published version; append a new one instead.
///
/// <para>
/// NOTE: Owl numbers, not character IDs, are the identity used by contacts, chats, messages and calls.
/// That keeps the door open for players typing a number in by hand later without touching these tables.
/// Times are stored as epoch milliseconds (BIGINT) so ordering never depends on the database's time zone.
/// </para>
///
/// <para>
/// NOTE: Version 1 is the whole schema of the first release, gathered from the versions it was built up in during development.
/// Its statements are all CREATE TABLE IF NOT EXISTS, so a first start that fails half-way can simply run again.
/// Every version after it holds one statement: DDL commits implicitly, so a version that fails half-way could not be rerun safely.
/// </para>
///
/// </summary>
const migrations =
[
	{
		version: 1,
		name: "create owl tables",
		statements:
		[
			`CREATE TABLE IF NOT EXISTS frantic_owls_numbers (
				character_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
				owl_number CHAR(8) NOT NULL,
				created_at BIGINT NOT NULL,
				UNIQUE KEY uq_frantic_owls_numbers_number (owl_number)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
			`CREATE TABLE IF NOT EXISTS frantic_owls_retired_numbers (
				owl_number CHAR(8) NOT NULL PRIMARY KEY,
				character_id BIGINT UNSIGNED NOT NULL,
				retired_at BIGINT NOT NULL,
				KEY idx_frantic_owls_retired_numbers_character (character_id)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
			`CREATE TABLE IF NOT EXISTS frantic_owls_contacts (
				id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
				owner_number CHAR(8) NOT NULL,
				contact_number CHAR(8) NOT NULL,
				display_name VARCHAR(64) NOT NULL,
				avatar_url VARCHAR(2048) NOT NULL DEFAULT '',
				created_at BIGINT NOT NULL,
				updated_at BIGINT NOT NULL,
				favourite TINYINT(1) NOT NULL DEFAULT 0,
				UNIQUE KEY uq_frantic_owls_contacts_pair (owner_number, contact_number)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
			`CREATE TABLE IF NOT EXISTS frantic_owls_chats (
				id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
				kind VARCHAR(8) NOT NULL,
				direct_key CHAR(17) NULL,
				title VARCHAR(64) NOT NULL DEFAULT '',
				created_by CHAR(8) NOT NULL,
				created_at BIGINT NOT NULL,
				last_message_id BIGINT UNSIGNED NULL,
				last_message_at BIGINT NOT NULL DEFAULT 0,
				avatar_url VARCHAR(2048) NOT NULL DEFAULT '',
				pinned_message_id BIGINT UNSIGNED NULL,
				closed_at BIGINT NOT NULL DEFAULT 0,
				UNIQUE KEY uq_frantic_owls_chats_direct (direct_key)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
			`CREATE TABLE IF NOT EXISTS frantic_owls_chat_members (
				chat_id BIGINT UNSIGNED NOT NULL,
				owl_number CHAR(8) NOT NULL,
				last_read_message_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
				joined_at BIGINT NOT NULL,
				muted_until BIGINT NOT NULL DEFAULT 0,
				role VARCHAR(8) NOT NULL DEFAULT 'member',
				pinned_at BIGINT NOT NULL DEFAULT 0,
				PRIMARY KEY (chat_id, owl_number),
				KEY idx_frantic_owls_chat_members_number (owl_number),
				CONSTRAINT fk_frantic_owls_chat_members_chat FOREIGN KEY (chat_id) REFERENCES frantic_owls_chats (id) ON DELETE CASCADE
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
			`CREATE TABLE IF NOT EXISTS frantic_owls_messages (
				id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
				chat_id BIGINT UNSIGNED NOT NULL,
				sender_number CHAR(8) NOT NULL,
				body TEXT NOT NULL,
				sent_at BIGINT NOT NULL,
				kind VARCHAR(8) NOT NULL DEFAULT 'text',
				deliver_at BIGINT NOT NULL DEFAULT 0,
				reply_to_id BIGINT UNSIGNED NULL,
				unsent_at BIGINT NOT NULL DEFAULT 0,
				deleted_at BIGINT NOT NULL DEFAULT 0,
				KEY idx_frantic_owls_messages_chat (chat_id, id),
				KEY idx_frantic_owls_messages_sent (sent_at),
				CONSTRAINT fk_frantic_owls_messages_chat FOREIGN KEY (chat_id) REFERENCES frantic_owls_chats (id) ON DELETE CASCADE
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
			`CREATE TABLE IF NOT EXISTS frantic_owls_hidden_messages (
				owner_number CHAR(8) NOT NULL,
				message_id BIGINT UNSIGNED NOT NULL,
				created_at BIGINT NOT NULL,
				PRIMARY KEY (owner_number, message_id),
				KEY idx_frantic_owls_hidden_messages_message (message_id),
				CONSTRAINT fk_frantic_owls_hidden_messages_message FOREIGN KEY (message_id) REFERENCES frantic_owls_messages (id) ON DELETE CASCADE
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
			`CREATE TABLE IF NOT EXISTS frantic_owls_calls (
				id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
				caller_number CHAR(8) NOT NULL,
				callee_number CHAR(8) NOT NULL,
				outcome VARCHAR(12) NOT NULL,
				started_at BIGINT NOT NULL,
				answered_at BIGINT NOT NULL DEFAULT 0,
				ended_at BIGINT NOT NULL DEFAULT 0,
				callee_seen_at BIGINT NOT NULL DEFAULT 0,
				caller_cleared_at BIGINT NOT NULL DEFAULT 0,
				callee_cleared_at BIGINT NOT NULL DEFAULT 0,
				deleted_at BIGINT NOT NULL DEFAULT 0,
				KEY idx_frantic_owls_calls_caller (caller_number, id),
				KEY idx_frantic_owls_calls_callee (callee_number, id),
				KEY idx_frantic_owls_calls_started (started_at)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
			`CREATE TABLE IF NOT EXISTS frantic_owls_blocks (
				owner_number CHAR(8) NOT NULL,
				blocked_number CHAR(8) NOT NULL,
				created_at BIGINT NOT NULL,
				PRIMARY KEY (owner_number, blocked_number),
				KEY idx_frantic_owls_blocks_blocked (blocked_number)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
			`CREATE TABLE IF NOT EXISTS frantic_owls_senders (
				id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
				sender_key VARCHAR(32) NOT NULL,
				display_name VARCHAR(64) NOT NULL,
				avatar_url VARCHAR(2048) NOT NULL DEFAULT '',
				updated_at BIGINT NOT NULL,
				UNIQUE KEY uq_frantic_owls_senders_key (sender_key)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
			`CREATE TABLE IF NOT EXISTS frantic_owls_profiles (
				owl_number CHAR(8) NOT NULL PRIMARY KEY,
				avatar_url VARCHAR(2048) NOT NULL DEFAULT '',
				updated_at BIGINT NOT NULL
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
			`CREATE TABLE IF NOT EXISTS frantic_owls_settings (
				owl_number CHAR(8) NOT NULL PRIMARY KEY,
				settings_json TEXT NOT NULL,
				updated_at BIGINT NOT NULL
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
		],
	},
];

/// <summary>
/// Rows touched per statement when pruning old owls, so one prune never holds a long lock on a busy table.
/// </summary>
const pruneBatchSize = 2000;

/// <summary>
/// Roles of a group member. Only groups use them; members of other chats keep the default.
/// </summary>
const MemberRole = Object.freeze
({
	Member: "member",
	Admin: "admin",
});

/// <summary>
/// Turn a system sender's row ID into its owl number.
/// Player numbers start at 10000000, so zero-padded IDs ("00000001") can never collide with one.
/// </summary>
/// <param name="id">Sender row ID</param>
/// <returns>8-digit owl number</returns>
function GetSenderNumber(id)
{
	return String(id).padStart(8, "0");
}

/// <summary>
/// Whether an owl number belongs to a system sender rather than a character.
/// </summary>
/// <param name="number">Owl number</param>
/// <returns>True for system senders</returns>
function IsSenderNumber(number)
{
	return typeof number === "string" && number.startsWith("0");
}

/// <summary>
/// SQL condition: the message aliased as alias was not written by someone the chat member (alias cm) has blocked.
/// </summary>
/// <param name="alias">Messages table alias</param>
/// <returns>SQL fragment</returns>
function NotBlockedBy(alias)
{
	return `NOT EXISTS (SELECT 1 FROM frantic_owls_blocks b WHERE b.owner_number = cm.owl_number AND b.blocked_number = ${alias}.sender_number)`;
}

/// <summary>
/// SQL condition: the message aliased as alias is one the chat member (alias cm, in chat alias c) can see.
/// One "now" parameter is needed, for owls still in flight.
///
/// <para>
/// NOTE: A member never sees an owl still in flight to them (deliver_at in the future), anything from an owl they blocked,
/// an owl they deleted for themselves, an owl the server deleted (deleted_at, kept in the database while soft deletion is on),
/// or a bulk owl's history from before they joined it.
/// </para>
///
/// </summary>
/// <param name="alias">Messages table alias</param>
/// <returns>SQL fragment</returns>
function VisibleToMember(alias)
{
	return `${alias}.deleted_at = 0 AND (${alias}.sender_number = cm.owl_number OR ${alias}.deliver_at <= ?) AND ${NotBlockedBy(alias)}
		AND NOT EXISTS (SELECT 1 FROM frantic_owls_hidden_messages h WHERE h.owner_number = cm.owl_number AND h.message_id = ${alias}.id)
		AND (c.kind <> 'group' OR ${alias}.sent_at >= cm.joined_at)`;
}

/// <summary>
/// Chat summary as one member sees it. Two "now" parameters come first (unread count, then last visible message).
///
/// <para>
/// NOTE: Both the unread count and the "last message" preview come from correlated subqueries rather than chats.last_message_id,
/// which would leak an in-flight owl's text and order the chat list by when it was sent rather than when it landed.
/// Unsent owls stay in the preview (as "unsent") but never count as unread.
/// An unsent owl keeps its text in the database while soft deletion is on, so every read blanks it in MapMessage and MapChatSummary instead.
/// </para>
///
/// </summary>
const chatSummarySelect = `SELECT c.id, c.kind, c.title, c.avatar_url, c.created_by, c.created_at, c.pinned_message_id, cm.muted_until, cm.role, cm.pinned_at,
		m.id AS last_id, m.body AS last_body, m.sender_number AS last_sender, m.sent_at AS last_sent_at, m.kind AS last_kind, m.deliver_at AS last_deliver_at, m.unsent_at AS last_unsent_at,
		p.sender_number AS pinned_sender, p.kind AS pinned_kind, LEFT(p.body, 200) AS pinned_body, p.sent_at AS pinned_sent_at,
		(SELECT COUNT(*) FROM frantic_owls_messages x WHERE x.chat_id = c.id AND x.id > cm.last_read_message_id AND x.sender_number <> cm.owl_number AND x.kind IN ('text', 'location') AND x.unsent_at = 0 AND ${VisibleToMember("x")}) AS unread
	FROM frantic_owls_chat_members cm
	JOIN frantic_owls_chats c ON c.id = cm.chat_id
	LEFT JOIN frantic_owls_messages m ON m.id = (SELECT MAX(v.id) FROM frantic_owls_messages v WHERE v.chat_id = c.id AND ${VisibleToMember("v")})
	LEFT JOIN frantic_owls_messages p ON p.id = c.pinned_message_id AND p.deleted_at = 0`;

/// <summary>
/// Column list and join shared by every message read, so each record also carries a short quote of the owl it replies to.
/// A quote of an owl the server deleted is left out of the join, so it shows as "no longer there".
/// </summary>
const messageColumns = `m.id, m.chat_id, m.sender_number, m.body, m.kind, m.sent_at, m.deliver_at, m.reply_to_id, m.unsent_at,
	r.sender_number AS reply_sender, r.kind AS reply_kind, LEFT(r.body, 200) AS reply_body, r.unsent_at AS reply_unsent_at`;
const messageSource = "frantic_owls_messages m LEFT JOIN frantic_owls_messages r ON r.id = m.reply_to_id AND r.deleted_at = 0";

/// <summary>
/// Kinds of message rows. "text" is an owl someone wrote and "location" one carrying where its sender stood (its body is JSON).
/// The others are notes the server records about the chat itself, which the page draws as a centred line ("Bram left.") and which never count as unread.
/// A note's sender is the owl who did it; its body is JSON with any details ({ target } for the member it concerns, { title } for a rename).
/// </summary>
const MessageKind = Object.freeze
({
	Text: "text",
	Location: "location",
	Left: "left",
	Added: "added",
	Removed: "removed",
	Renamed: "renamed",
	Promoted: "promoted",
	Demoted: "demoted",
	Picture: "picture",
	Pinned: "pinned",
	Unpinned: "unpinned",
	Retired: "retired",
});

/// <summary>
/// How a call ended, as stored in the call log.
/// Answered calls are "answered" whoever hung up; the rest never connected.
/// "cancelled" is the caller hanging up while it rang, "missed" nobody answering in time,
/// "busy" the callee already being on a call and "unreachable" the callee being offline (or having blocked the caller, which the caller is never told).
/// </summary>
const CallOutcome = Object.freeze
({
	Answered: "answered",
	Missed: "missed",
	Declined: "declined",
	Cancelled: "cancelled",
	Busy: "busy",
	Unreachable: "unreachable",
});

/// <summary>
/// Column list of every call log read.
/// </summary>
const callColumns = "id, caller_number, callee_number, outcome, started_at, answered_at, ended_at, callee_seen_at";

/// <summary>
/// Column list and join shared by every contact read, so each record also carries the contact's own profile picture.
/// </summary>
const contactColumns = "c.id, c.contact_number, c.display_name, c.avatar_url, c.favourite, c.updated_at, p.avatar_url AS profile_avatar_url";
const contactSource = "frantic_owls_contacts c LEFT JOIN frantic_owls_profiles p ON p.owl_number = c.contact_number";

// ========================
// Row Mapping
// ========================

/// <summary>
/// Convert a contacts row into the shape the rest of the server uses.
/// </summary>
/// <param name="row">Raw database row</param>
/// <returns>Contact record</returns>
function MapContact(row)
{
	return {
		id: Number(row.id),
		number: String(row.contact_number),
		name: String(row.display_name),
		avatarUrl: String(row.avatar_url || ""),
		profileAvatarUrl: String(row.profile_avatar_url || ""),
		favourite: Number(row.favourite) === 1,
		updatedAt: Number(row.updated_at),
	};
}

/// <summary>
/// The short quote of a replied-to owl that travels with a reply. An unsent owl is quoted without its text.
/// </summary>
/// <param name="message">Replied-to message record (or a row mapped to { id, sender, kind, body, unsentAt })</param>
/// <returns>{ id, sender, kind, body, unsent }</returns>
function ToQuote(message)
{
	const unsent = Number(message.unsentAt || 0) > 0;
	return { id: Number(message.id), sender: String(message.sender || ""), kind: String(message.kind || MessageKind.Text), body: unsent ? "" : String(message.body || "").slice(0, 200), unsent };
}

/// <summary>
/// Convert a messages row into the shape sent to clients.
/// </summary>
/// <param name="row">Raw database row</param>
/// <returns>Message record</returns>
function MapMessage(row)
{
	const replyId = Number(row.reply_to_id || 0);

	// The replied-to owl can only be missing if its chat was cleared under it; quote it as unsent rather than dropping the reply.
	const replyTo = replyId === 0 ? null : row.reply_sender === null || row.reply_sender === undefined
		? { id: replyId, sender: "", kind: MessageKind.Text, body: "", unsent: true }
		: ToQuote({ id: replyId, sender: row.reply_sender, kind: row.reply_kind, body: row.reply_body, unsentAt: row.reply_unsent_at });

	const unsentAt = Number(row.unsent_at || 0);

	return {
		id: Number(row.id),
		chatId: Number(row.chat_id),
		sender: String(row.sender_number),
		body: unsentAt > 0 ? "" : String(row.body),
		kind: String(row.kind || MessageKind.Text),
		sentAt: Number(row.sent_at),
		deliverAt: Number(row.deliver_at || 0),
		replyTo,
		unsentAt,
	};
}

/// <summary>
/// Convert a call log row into one owl's entry: the other party, which way the call went and whether it is a missed call not yet seen.
/// </summary>
/// <param name="row">Raw database row</param>
/// <param name="viewer">Owl number whose log this is (the caller or the callee)</param>
/// <returns>{ id, number, direction, outcome, startedAt, answeredAt, endedAt, isNew }</returns>
function MapCall(row, viewer)
{
	const isOutgoing = String(row.caller_number) === viewer;
	const outcome = String(row.outcome);

	return {
		id: Number(row.id),
		number: String(isOutgoing ? row.callee_number : row.caller_number),
		direction: isOutgoing ? "out" : "in",
		outcome,
		startedAt: Number(row.started_at),
		answeredAt: Number(row.answered_at || 0),
		endedAt: Number(row.ended_at || 0),
		isNew: !isOutgoing && Number(row.callee_seen_at || 0) === 0 && outcome !== CallOutcome.Answered && outcome !== CallOutcome.Declined,
	};
}

/// <summary>
/// Group the member rows of several chats by chat.
/// </summary>
/// <param name="rows">Rows with chat_id, owl_number and role</param>
/// <returns>Map of chat ID to { members, admins }</returns>
function GroupMembers(rows)
{
	const byChat = new Map();

	for (const row of rows)
	{
		const chatId = Number(row.chat_id);

		if (!byChat.has(chatId))
		{
			byChat.set(chatId, { members: [], admins: [] });
		}

		const entry = byChat.get(chatId);
		entry.members.push(String(row.owl_number));

		if (String(row.role) === MemberRole.Admin)
		{
			entry.admins.push(String(row.owl_number));
		}
	}

	return byChat;
}

/// <summary>
/// Convert a chat summary row into the shape sent to clients.
/// </summary>
/// <param name="row">Row selected with chatSummarySelect</param>
/// <param name="group">{ members, admins } of the chat</param>
/// <returns>Chat summary</returns>
function MapChatSummary(row, group)
{
	const id = Number(row.id);
	const hasLast = row.last_id !== null && row.last_id !== undefined;
	const lastUnsentAt = Number(row.last_unsent_at || 0);
	const lastMessage = hasLast ? { id: Number(row.last_id), chatId: id, sender: String(row.last_sender), body: lastUnsentAt > 0 ? "" : String(row.last_body), kind: String(row.last_kind || MessageKind.Text), sentAt: Number(row.last_sent_at), deliverAt: Number(row.last_deliver_at || 0), unsentAt: lastUnsentAt } : null;
	const pinnedId = Number(row.pinned_message_id || 0);
	const pinnedMessage = pinnedId > 0 && row.pinned_sender !== null && row.pinned_sender !== undefined ? { ...ToQuote({ id: pinnedId, sender: row.pinned_sender, kind: row.pinned_kind, body: row.pinned_body }), sentAt: Number(row.pinned_sent_at) } : null;

	return {
		id,
		kind: String(row.kind),
		title: String(row.title || ""),
		avatarUrl: String(row.avatar_url || ""),
		createdBy: String(row.created_by),
		members: group.members,
		admins: group.admins,
		role: String(row.role || MemberRole.Member),
		pinnedAt: Number(row.pinned_at || 0),
		pinnedMessage,
		createdAt: Number(row.created_at),
		lastActivityAt: Math.max(Number(row.created_at), lastMessage ? Math.max(lastMessage.sentAt, lastMessage.deliverAt) : 0),
		lastMessage,
		mutedUntil: Number(row.muted_until || 0),
		unread: Number(row.unread) || 0,
	};
}

// ========================
// Database
// ========================

/// <summary>
/// Every query frantic-owls runs, in one place.
/// hmp-mysql rejects its promises on failure; this class catches those, logs them, and returns a sentinel instead.
/// Callers therefore check return values rather than wrapping each call in try/catch.
///
/// <para>
/// NOTE: Owls are soft deleted unless storage.disableSoftDelete is set: an unsent owl keeps its text, a pruned owl is only marked deleted_at,
/// and a bulk owl whose last member left is marked closed_at instead of being dropped with its history.
/// Pages never see any of it; the rows stay for audits and moderation. Only with disableSoftDelete do those rows really leave the database.
/// </para>
///
/// </summary>
class OwlDatabase
{
	/// <summary>
	/// hmp-mysql import.
	/// </summary>
	#mysql;

	/// <summary>
	/// True to keep deleted owls in the database (the default); false when storage.disableSoftDelete is set.
	/// </summary>
	#isSoftDelete = true;

	/// <summary>
	/// Run one database operation, turning a rejection into a logged sentinel.
	/// </summary>
	/// <param name="label">Short description of the operation, used in the log line</param>
	/// <param name="work">Async function performing the queries</param>
	/// <param name="fallback">Value returned if the operation fails</param>
	/// <returns>Whatever work resolved with, or fallback</returns>
	async #Run(label, work, fallback)
	{
		try
		{
			return await work();
		}
		catch (error)
		{
			Logger.LogError("Database", `${label} failed: ${Logger.Describe(error)}`);
			return fallback;
		}
	}

	/// <summary>
	/// Constructor.
	/// </summary>
	/// <param name="mysql">hmp-mysql import</param>
	/// <param name="storageConfig">The "storage" section of the server config</param>
	constructor(mysql, storageConfig)
	{
		this.#mysql = mysql;
		this.#isSoftDelete = !storageConfig.disableSoftDelete;
	}

	// ========================
	// Lifecycle
	// ========================

	/// <summary>
	/// Wait for the connection and apply the schema migrations.
	/// </summary>
	/// <returns>True when the database is ready for use</returns>
	async Initialise()
	{
		const ready = await this.#Run("Connection check", () => this.#mysql.ready(), false);

		if (!ready)
		{
			Logger.LogError("Database", "hmp-mysql is not configured or not reachable. Configure data/hmp-mysql.json and restart the resource.");
			return false;
		}

		const result = await this.#Run("Migration", () => this.#mysql.migrate("frantic-owls", migrations), null);

		if (!result)
		{
			return false;
		}

		Logger.LogSuccess("Database", `Schema at version ${result.currentVersion} (applied: ${result.applied.length > 0 ? result.applied.join(", ") : "none"})`);
		return true;
	}

	// ========================
	// Owl Numbers
	// ========================

	/// <summary>
	/// Look up the owl number assigned to a character.
	/// </summary>
	/// <param name="characterId">hmp-core character ID</param>
	/// <returns>The 8-digit number, empty string if none is assigned, or null on a database failure</returns>
	async GetNumberForCharacter(characterId)
	{
		return this.#Run("GetNumberForCharacter", async () =>
		{
			const number = await this.#mysql.scalar("SELECT owl_number FROM frantic_owls_numbers WHERE character_id = ?", [characterId]);
			return number ? String(number) : "";
		}, null);
	}

	/// <summary>
	/// Try to claim one specific number for a character.
	/// </summary>
	/// <param name="characterId">hmp-core character ID</param>
	/// <param name="number">Candidate 8-digit number</param>
	/// <returns>True if the row was written; false on a collision (with a live or a retired number) or any other failure</returns>
	async TryInsertNumber(characterId, number)
	{
		// A unique-key collision is an expected outcome here, so it is not logged as an error.
		try
		{
			// A retired number still names its old owl in other players' chats, so it is never handed out again.
			const affected = await this.#mysql.update("INSERT INTO frantic_owls_numbers (character_id, owl_number, created_at) SELECT ?, ?, ? FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM frantic_owls_retired_numbers WHERE owl_number = ?)", [characterId, number, Date.now(), number]);
			return Number(affected) > 0;
		}
		catch (error)
		{
			if (error && (error.code === "ER_DUP_ENTRY" || error.errno === 1062))
			{
				return false;
			}

			Logger.LogError("Database", `TryInsertNumber failed: ${Logger.Describe(error)}`);
			return false;
		}
	}

	// ========================
	// Contacts
	// ========================

	/// <summary>
	/// List every contact an owl number has saved.
	/// </summary>
	/// <param name="ownerNumber">Owl number owning the contacts</param>
	/// <returns>Contact records, or null on failure</returns>
	async ListContacts(ownerNumber)
	{
		return this.#Run("ListContacts", async () =>
		{
			const rows = await this.#mysql.query(`SELECT ${contactColumns} FROM ${contactSource} WHERE c.owner_number = ? ORDER BY c.display_name`, [ownerNumber]);
			return rows.map(MapContact);
		}, null);
	}

	/// <summary>
	/// Fetch one contact, but only if it belongs to the given owner.
	/// </summary>
	/// <param name="ownerNumber">Owl number that must own the contact</param>
	/// <param name="contactId">Contact row ID</param>
	/// <returns>Contact record, or null if missing, not owned, or on failure</returns>
	async GetContact(ownerNumber, contactId)
	{
		return this.#Run("GetContact", async () =>
		{
			const row = await this.#mysql.single(`SELECT ${contactColumns} FROM ${contactSource} WHERE c.owner_number = ? AND c.id = ?`, [ownerNumber, contactId]);
			return row ? MapContact(row) : null;
		}, null);
	}

	/// <summary>
	/// Find the contact an owner saved for a given owl number.
	/// </summary>
	/// <param name="ownerNumber">Owl number owning the contact</param>
	/// <param name="contactNumber">Owl number the contact points at</param>
	/// <returns>Contact record, null if none, or undefined on failure</returns>
	async FindContactByNumber(ownerNumber, contactNumber)
	{
		return this.#Run("FindContactByNumber", async () =>
		{
			const row = await this.#mysql.single(`SELECT ${contactColumns} FROM ${contactSource} WHERE c.owner_number = ? AND c.contact_number = ?`, [ownerNumber, contactNumber]);
			return row ? MapContact(row) : null;
		}, undefined);
	}

	/// <summary>
	/// Count the contacts an owner has saved.
	/// </summary>
	/// <param name="ownerNumber">Owl number owning the contacts</param>
	/// <returns>Contact count, or -1 on failure</returns>
	async CountContacts(ownerNumber)
	{
		return this.#Run("CountContacts", async () => Number(await this.#mysql.scalar("SELECT COUNT(*) FROM frantic_owls_contacts WHERE owner_number = ?", [ownerNumber])), -1);
	}

	/// <summary>
	/// Save a new contact.
	/// </summary>
	/// <param name="ownerNumber">Owl number owning the contact</param>
	/// <param name="contactNumber">Owl number the contact points at</param>
	/// <param name="name">Display name, already validated</param>
	/// <param name="avatarUrl">Avatar URL, already validated (may be empty)</param>
	/// <returns>New contact record, or null on failure (including a duplicate pair)</returns>
	async InsertContact(ownerNumber, contactNumber, name, avatarUrl)
	{
		return this.#Run("InsertContact", async () =>
		{
			const now = Date.now();
			const id = await this.#mysql.insert("INSERT INTO frantic_owls_contacts (owner_number, contact_number, display_name, avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [ownerNumber, contactNumber, name, avatarUrl, now, now]);
			const profileAvatarUrl = await this.#mysql.scalar("SELECT avatar_url FROM frantic_owls_profiles WHERE owl_number = ?", [contactNumber]);
			return { id: Number(id), number: contactNumber, name, avatarUrl, profileAvatarUrl: String(profileAvatarUrl || ""), updatedAt: now };
		}, null);
	}

	/// <summary>
	/// Rename a contact and change its picture.
	/// </summary>
	/// <param name="ownerNumber">Owl number that must own the contact</param>
	/// <param name="contactId">Contact row ID</param>
	/// <param name="name">New display name, already validated</param>
	/// <param name="avatarUrl">New avatar URL, already validated (may be empty)</param>
	/// <returns>True if a row owned by ownerNumber was changed</returns>
	async UpdateContact(ownerNumber, contactId, name, avatarUrl)
	{
		return this.#Run("UpdateContact", async () =>
		{
			const affected = await this.#mysql.update("UPDATE frantic_owls_contacts SET display_name = ?, avatar_url = ?, updated_at = ? WHERE owner_number = ? AND id = ?", [name, avatarUrl, Date.now(), ownerNumber, contactId]);
			return Number(affected) > 0;
		}, false);
	}

	/// <summary>
	/// Mark or unmark a contact as a favourite.
	/// </summary>
	/// <param name="ownerNumber">Owl number that must own the contact</param>
	/// <param name="contactId">Contact row ID</param>
	/// <param name="favourite">True to make it a favourite</param>
	/// <returns>True if a row owned by ownerNumber was found</returns>
	async SetContactFavourite(ownerNumber, contactId, favourite)
	{
		return this.#Run("SetContactFavourite", async () =>
		{
			const found = await this.#mysql.scalar("SELECT COUNT(*) FROM frantic_owls_contacts WHERE owner_number = ? AND id = ?", [ownerNumber, contactId]);
			await this.#mysql.update("UPDATE frantic_owls_contacts SET favourite = ? WHERE owner_number = ? AND id = ?", [favourite ? 1 : 0, ownerNumber, contactId]);
			return Number(found) > 0;
		}, false);
	}

	/// <summary>
	/// Delete a contact. Chats with that number are kept; they simply lose their friendly name.
	/// </summary>
	/// <param name="ownerNumber">Owl number that must own the contact</param>
	/// <param name="contactId">Contact row ID</param>
	/// <returns>True if a row owned by ownerNumber was deleted</returns>
	async DeleteContact(ownerNumber, contactId)
	{
		return this.#Run("DeleteContact", async () =>
		{
			const affected = await this.#mysql.update("DELETE FROM frantic_owls_contacts WHERE owner_number = ? AND id = ?", [ownerNumber, contactId]);
			return Number(affected) > 0;
		}, false);
	}

	// ========================
	// Chats
	// ========================

	/// <summary>
	/// List the chats an owl number belongs to, most recently active first.
	/// Direct chats without a message this owl can see yet are left out; groups and channels are always listed.
	/// </summary>
	/// <param name="number">Member owl number</param>
	/// <param name="limit">Maximum number of chats returned</param>
	/// <returns>Chat summaries with their members, or null on failure</returns>
	async ListChats(number, limit)
	{
		return this.#Run("ListChats", async () =>
		{
			const now = Date.now();
			const rows = await this.#mysql.query(
				`${chatSummarySelect}
				WHERE cm.owl_number = ? AND (c.kind <> 'direct' OR m.id IS NOT NULL OR cm.pinned_at > 0)
				ORDER BY cm.pinned_at DESC, GREATEST(COALESCE(m.sent_at, 0), COALESCE(m.deliver_at, 0), c.created_at) DESC
				LIMIT ?`,
				[now, now, number, limit]);

			if (rows.length === 0)
			{
				return [];
			}

			// Channels hold every character on the server, so their member lists are never sent; pages do not need them.
			const listedIds = rows.filter((row) => String(row.kind) !== "channel").map((row) => row.id);
			const members = listedIds.length > 0 ? await this.#mysql.query("SELECT chat_id, owl_number, role FROM frantic_owls_chat_members WHERE chat_id IN (?) ORDER BY joined_at, owl_number", [listedIds]) : [];
			const membersByChat = GroupMembers(members);

			return rows.map((row) => MapChatSummary(row, membersByChat.get(Number(row.id)) || { members: [], admins: [] }));
		}, null);
	}

	/// <summary>
	/// Fetch one chat's summary for a member. Also serves as the membership check.
	/// </summary>
	/// <param name="chatId">Chat row ID</param>
	/// <param name="number">Owl number that must be a member</param>
	/// <returns>Chat summary, null if missing or not a member, or undefined on failure</returns>
	async GetChatForMember(chatId, number)
	{
		return this.#Run("GetChatForMember", async () =>
		{
			const now = Date.now();
			const row = await this.#mysql.single(`${chatSummarySelect} WHERE cm.chat_id = ? AND cm.owl_number = ?`, [now, now, chatId, number]);

			if (!row)
			{
				return null;
			}

			const members = String(row.kind) === "channel" ? [] : await this.#mysql.query("SELECT chat_id, owl_number, role FROM frantic_owls_chat_members WHERE chat_id = ? ORDER BY joined_at, owl_number", [chatId]);
			return MapChatSummary(row, GroupMembers(members).get(Number(chatId)) || { members: [], admins: [] });
		}, undefined);
	}

	/// <summary>
	/// Basic facts about a chat, without a member's point of view (for system senders, who are not members of channels).
	/// </summary>
	/// <param name="chatId">Chat row ID</param>
	/// <returns>{ id, kind, title, avatarUrl, createdBy, createdAt, members, admins }, null if missing, or undefined on failure</returns>
	async GetChat(chatId)
	{
		return this.#Run("GetChat", async () =>
		{
			const row = await this.#mysql.single("SELECT id, kind, title, avatar_url, created_by, created_at FROM frantic_owls_chats WHERE id = ?", [chatId]);

			if (!row)
			{
				return null;
			}

			// A channel's members are every character on the server; callers deliver to whoever is online instead.
			const members = String(row.kind) === "channel" ? [] : await this.#mysql.query("SELECT chat_id, owl_number, role FROM frantic_owls_chat_members WHERE chat_id = ? ORDER BY joined_at, owl_number", [chatId]);
			const group = GroupMembers(members).get(Number(chatId)) || { members: [], admins: [] };
			return { id: Number(row.id), kind: String(row.kind), title: String(row.title || ""), avatarUrl: String(row.avatar_url || ""), createdBy: String(row.created_by), createdAt: Number(row.created_at), members: group.members, admins: group.admins };
		}, undefined);
	}

	/// <summary>
	/// Find the single direct chat between two owl numbers.
	/// </summary>
	/// <param name="directKey">Sorted "lower:higher" number pair</param>
	/// <returns>Chat ID, 0 if no such chat exists, or invalidId on failure</returns>
	async FindDirectChat(directKey)
	{
		return this.#Run("FindDirectChat", async () =>
		{
			const id = await this.#mysql.scalar("SELECT id FROM frantic_owls_chats WHERE direct_key = ?", [directKey]);
			return id === null || id === undefined ? 0 : Number(id);
		}, invalidId);
	}

	/// <summary>
	/// Create a chat and its member rows atomically.
	/// </summary>
	/// <param name="kind">"direct", "group" or "channel"</param>
	/// <param name="directKey">Sorted number pair for direct chats, null otherwise</param>
	/// <param name="title">Group title (may be empty)</param>
	/// <param name="createdBy">Owl number of the creator</param>
	/// <param name="members">Every member owl number, creator included</param>
	/// <returns>New chat ID, or invalidId on failure (including losing a race on directKey)</returns>
	async CreateChat(kind, directKey, title, createdBy, members)
	{
		return this.#Run("CreateChat", () => this.#mysql.transaction(async (tx) =>
		{
			const now = Date.now();
			const chatId = Number(await tx.insert("INSERT INTO frantic_owls_chats (kind, direct_key, title, created_by, created_at) VALUES (?, ?, ?, ?, ?)", [kind, directKey, title, createdBy, now]));

			// The creator of a bulk owl is its first admin.
			for (const member of members)
			{
				await tx.insert("INSERT INTO frantic_owls_chat_members (chat_id, owl_number, joined_at, role) VALUES (?, ?, ?, ?)", [chatId, member, now, kind === "group" && member === createdBy ? MemberRole.Admin : MemberRole.Member]);
			}

			return chatId;
		}), invalidId);
	}

	/// <summary>
	/// List the owl numbers belonging to a chat.
	/// </summary>
	/// <param name="chatId">Chat row ID</param>
	/// <returns>Member numbers, or null on failure</returns>
	async ListMembers(chatId)
	{
		return this.#Run("ListMembers", async () =>
		{
			const rows = await this.#mysql.query("SELECT owl_number FROM frantic_owls_chat_members WHERE chat_id = ?", [chatId]);
			return rows.map((row) => String(row.owl_number));
		}, null);
	}

	/// <summary>
	/// Store a message, bump the chat's activity, and mark it read for its sender, atomically.
	/// </summary>
	/// <param name="chatId">Chat row ID</param>
	/// <param name="senderNumber">Sender's owl number, already checked to be allowed to write here</param>
	/// <param name="body">Message text, already validated</param>
	/// <param name="deliverAt">When the owl lands, in epoch milliseconds; 0 for at once</param>
	/// <param name="kind">A MessageKind: Text or Location for owls, any other kind for a note about the chat</param>
	/// <param name="replyTo">Message record this owl answers, already checked to be visible in the same chat; null for none</param>
	/// <returns>Stored message record, or null on failure</returns>
	async InsertMessage(chatId, senderNumber, body, deliverAt = 0, kind = MessageKind.Text, replyTo = null)
	{
		return this.#Run("InsertMessage", () => this.#mysql.transaction(async (tx) =>
		{
			const sentAt = Date.now();
			const id = Number(await tx.insert("INSERT INTO frantic_owls_messages (chat_id, sender_number, body, kind, sent_at, deliver_at, reply_to_id) VALUES (?, ?, ?, ?, ?, ?, ?)", [chatId, senderNumber, body, kind, sentAt, deliverAt, replyTo ? replyTo.id : null]));

			await tx.update("UPDATE frantic_owls_chats SET last_message_id = ?, last_message_at = ? WHERE id = ?", [id, sentAt, chatId]);
			await tx.update("UPDATE frantic_owls_chat_members SET last_read_message_id = GREATEST(last_read_message_id, ?) WHERE chat_id = ? AND owl_number = ?", [id, chatId, senderNumber]);

			return { id, chatId, sender: senderNumber, body, kind, sentAt, deliverAt, replyTo: replyTo ? ToQuote(replyTo) : null, unsentAt: 0 };
		}), null);
	}

	/// <summary>
	/// Take back an owl its sender wrote: its text is hidden from everyone and it stays as an "unsent" line. A pin on it goes too.
	/// With soft deletion the text stays in the database; with storage.disableSoftDelete it is wiped.
	/// </summary>
	/// <param name="chatId">Chat row ID</param>
	/// <param name="messageId">Message row ID</param>
	/// <param name="senderNumber">Owl number that must have written it</param>
	/// <param name="sentAfter">Only owls sent at or after this time (epoch milliseconds) can be unsent</param>
	/// <returns>Epoch milliseconds it was unsent at, 0 when no such owl qualifies, or -1 on failure</returns>
	async UnsendMessage(chatId, messageId, senderNumber, sentAfter)
	{
		return this.#Run("UnsendMessage", () => this.#mysql.transaction(async (tx) =>
		{
			const now = Date.now();
			const wipe = this.#isSoftDelete ? "" : "body = '', ";
			const affected = Number(await tx.update(`UPDATE frantic_owls_messages SET ${wipe}unsent_at = ? WHERE id = ? AND chat_id = ? AND sender_number = ? AND unsent_at = 0 AND deleted_at = 0 AND kind IN ('text', 'location') AND sent_at >= ?`, [now, messageId, chatId, senderNumber, sentAfter]));

			if (affected === 0)
			{
				return 0;
			}

			await tx.update("UPDATE frantic_owls_chats SET pinned_message_id = NULL WHERE id = ? AND pinned_message_id = ?", [chatId, messageId]);
			return now;
		}), -1);
	}

	/// <summary>
	/// Hide one owl from one member's phone ("delete for me"). Everyone else keeps it.
	/// </summary>
	/// <param name="owner">Member hiding it</param>
	/// <param name="chatId">Chat row ID the message must belong to</param>
	/// <param name="messageId">Message row ID</param>
	/// <returns>True when the message exists in that chat</returns>
	async HideMessage(owner, chatId, messageId)
	{
		return this.#Run("HideMessage", async () =>
		{
			const exists = Number(await this.#mysql.scalar("SELECT COUNT(*) FROM frantic_owls_messages WHERE id = ? AND chat_id = ? AND deleted_at = 0", [messageId, chatId])) > 0;

			if (exists)
			{
				await this.#mysql.update("INSERT IGNORE INTO frantic_owls_hidden_messages (owner_number, message_id, created_at) VALUES (?, ?, ?)", [owner, messageId, Date.now()]);
			}

			return exists;
		}, false);
	}

	/// <summary>
	/// Every member of a chat with their role, read marker and join time, oldest member first.
	/// </summary>
	/// <param name="chatId">Chat row ID</param>
	/// <returns>[{ number, role, lastRead, joinedAt }], or null on failure</returns>
	async ListMemberStates(chatId)
	{
		return this.#Run("ListMemberStates", async () => (await this.#mysql.query("SELECT owl_number, role, last_read_message_id, joined_at FROM frantic_owls_chat_members WHERE chat_id = ? ORDER BY joined_at, owl_number", [chatId])).map((row) => ({ number: String(row.owl_number), role: String(row.role || MemberRole.Member), lastRead: Number(row.last_read_message_id), joinedAt: Number(row.joined_at) })), null);
	}

	// ========================
	// Group Administration
	// ========================

	/// <summary>
	/// Rename a group.
	/// </summary>
	/// <param name="chatId">Group chat ID</param>
	/// <param name="title">New title, already validated</param>
	/// <returns>True on success</returns>
	async SetChatTitle(chatId, title)
	{
		return this.#Run("SetChatTitle", async () =>
		{
			await this.#mysql.update("UPDATE frantic_owls_chats SET title = ? WHERE id = ?", [title, chatId]);
			return true;
		}, false);
	}

	/// <summary>
	/// Change a group's picture.
	/// </summary>
	/// <param name="chatId">Group chat ID</param>
	/// <param name="avatarUrl">Validated picture link (empty to clear it)</param>
	/// <returns>True on success</returns>
	async SetChatAvatar(chatId, avatarUrl)
	{
		return this.#Run("SetChatAvatar", async () =>
		{
			await this.#mysql.update("UPDATE frantic_owls_chats SET avatar_url = ? WHERE id = ?", [avatarUrl, chatId]);
			return true;
		}, false);
	}

	/// <summary>
	/// Pin one owl at the top of a chat, replacing any earlier pin, or clear the pin.
	/// </summary>
	/// <param name="chatId">Chat ID</param>
	/// <param name="messageId">Message ID, already checked to belong to the chat; 0 to unpin</param>
	/// <returns>True on success</returns>
	async SetPinnedMessage(chatId, messageId)
	{
		return this.#Run("SetPinnedMessage", async () =>
		{
			await this.#mysql.update("UPDATE frantic_owls_chats SET pinned_message_id = ? WHERE id = ?", [messageId > 0 ? messageId : null, chatId]);
			return true;
		}, false);
	}

	/// <summary>
	/// Add owls to a group. Owls already in it are left as they are. New members only see the group's history from now on.
	/// </summary>
	/// <param name="chatId">Group chat ID</param>
	/// <param name="numbers">Owl numbers to add</param>
	/// <returns>The numbers actually added, or null on failure</returns>
	async AddMembers(chatId, numbers)
	{
		return this.#Run("AddMembers", () => this.#mysql.transaction(async (tx) =>
		{
			const now = Date.now();
			const added = [];

			for (const number of numbers)
			{
				if (Number(await tx.update("INSERT IGNORE INTO frantic_owls_chat_members (chat_id, owl_number, joined_at, role) VALUES (?, ?, ?, ?)", [chatId, number, now, MemberRole.Member])) > 0)
				{
					added.push(number);
				}
			}

			return added;
		}), null);
	}

	/// <summary>
	/// Take one owl out of a group (removed by an admin). The group keeps at least one admin.
	/// </summary>
	/// <param name="chatId">Group chat ID</param>
	/// <param name="number">Owl number to remove</param>
	/// <returns>{ removed, promoted } where promoted is the member made admin to replace the last one ("" if none), or null on failure</returns>
	async RemoveMember(chatId, number)
	{
		return this.#Run("RemoveMember", () => this.#mysql.transaction(async (tx) =>
		{
			const removed = Number(await tx.update("DELETE FROM frantic_owls_chat_members WHERE chat_id = ? AND owl_number = ?", [chatId, number])) > 0;
			return { removed, promoted: removed ? await this.#EnsureAdmin(tx, chatId) : "" };
		}), null);
	}

	/// <summary>
	/// Make a group member an admin, or an ordinary member again.
	/// </summary>
	/// <param name="chatId">Group chat ID</param>
	/// <param name="number">Member owl number</param>
	/// <param name="role">MemberRole value</param>
	/// <returns>True if the member was found</returns>
	async SetMemberRole(chatId, number, role)
	{
		return this.#Run("SetMemberRole", async () =>
		{
			const found = Number(await this.#mysql.scalar("SELECT COUNT(*) FROM frantic_owls_chat_members WHERE chat_id = ? AND owl_number = ?", [chatId, number]));
			await this.#mysql.update("UPDATE frantic_owls_chat_members SET role = ? WHERE chat_id = ? AND owl_number = ?", [role, chatId, number]);
			return found > 0;
		}, false);
	}

	/// <summary>
	/// Give a group without any admin one: its longest-standing member.
	/// Bulk owls made before admins existed lose theirs when the creator has left; this repairs them on first use.
	/// </summary>
	/// <param name="chatId">Group chat ID</param>
	/// <returns>The member promoted, "" when the group already had an admin or is empty, or null on failure</returns>
	async EnsureGroupAdmin(chatId)
	{
		return this.#Run("EnsureGroupAdmin", () => this.#mysql.transaction((tx) => this.#EnsureAdmin(tx, chatId)), null);
	}

	/// <summary>
	/// Promote the longest-standing member of a group that has no admin, inside a transaction.
	/// </summary>
	/// <param name="tx">hmp-mysql transaction</param>
	/// <param name="chatId">Group chat ID</param>
	/// <returns>The member promoted, or "" when nobody needed promoting</returns>
	async #EnsureAdmin(tx, chatId)
	{
		const rows = await tx.query("SELECT owl_number, role FROM frantic_owls_chat_members WHERE chat_id = ? ORDER BY joined_at, owl_number", [chatId]);

		if (rows.length === 0 || rows.some((row) => String(row.role) === MemberRole.Admin))
		{
			return "";
		}

		const promoted = String(rows[0].owl_number);
		await tx.update("UPDATE frantic_owls_chat_members SET role = ? WHERE chat_id = ? AND owl_number = ?", [MemberRole.Admin, chatId, promoted]);
		return promoted;
	}

	// ========================
	// Chat Pins
	// ========================

	/// <summary>
	/// Pin a chat to the top of one member's list, or unpin it.
	/// </summary>
	/// <param name="chatId">Chat ID</param>
	/// <param name="number">Member owl number</param>
	/// <param name="pinnedAt">Epoch milliseconds it was pinned at; 0 to unpin</param>
	/// <returns>True if the member's row was found</returns>
	async SetChatPinned(chatId, number, pinnedAt)
	{
		return this.#Run("SetChatPinned", async () =>
		{
			const found = Number(await this.#mysql.scalar("SELECT COUNT(*) FROM frantic_owls_chat_members WHERE chat_id = ? AND owl_number = ?", [chatId, number]));
			await this.#mysql.update("UPDATE frantic_owls_chat_members SET pinned_at = ? WHERE chat_id = ? AND owl_number = ?", [pinnedAt, chatId, number]);
			return found > 0;
		}, false);
	}

	/// <summary>
	/// How many chats a member has pinned.
	/// </summary>
	/// <param name="number">Member owl number</param>
	/// <returns>Count, or -1 on failure</returns>
	async CountPinnedChats(number)
	{
		return this.#Run("CountPinnedChats", async () => Number(await this.#mysql.scalar("SELECT COUNT(*) FROM frantic_owls_chat_members WHERE owl_number = ? AND pinned_at > 0", [number])), -1);
	}

	/// <summary>
	/// Owls still in the air, so their arrival can be announced again after a restart.
	/// </summary>
	/// <param name="now">Current time in epoch milliseconds</param>
	/// <returns>Message records, or an empty array on failure</returns>
	async ListInFlight(now)
	{
		return this.#Run("ListInFlight", async () =>
		{
			const rows = await this.#mysql.query(`SELECT ${messageColumns} FROM ${messageSource} WHERE m.deliver_at > ? AND m.unsent_at = 0 AND m.deleted_at = 0`, [now]);
			return rows.map(MapMessage);
		}, []);
	}

	/// <summary>
	/// Take an owl out of a group chat atomically: record a "left" note, drop its membership,
	/// promote someone if the last admin left, and close the chat when nobody is left in it.
	/// </summary>
	/// <param name="chatId">Chat row ID, already checked to be a group the owl belongs to</param>
	/// <param name="number">Leaving owl's number</param>
	/// <param name="kind">Note recorded: MessageKind.Left, or MessageKind.Retired when the owl's character was deleted</param>
	/// <returns>{ message, members, promoted } with the note, the remaining members (empty when the chat was closed) and any member made admin, or null on failure</returns>
	async LeaveChat(chatId, number, kind = MessageKind.Left)
	{
		return this.#Run("LeaveChat", () => this.#mysql.transaction(async (tx) =>
		{
			const sentAt = Date.now();
			const id = Number(await tx.insert("INSERT INTO frantic_owls_messages (chat_id, sender_number, body, kind, sent_at) VALUES (?, ?, '', ?, ?)", [chatId, number, kind, sentAt]));

			await tx.update("UPDATE frantic_owls_chats SET last_message_id = ?, last_message_at = ? WHERE id = ?", [id, sentAt, chatId]);
			await tx.update("DELETE FROM frantic_owls_chat_members WHERE chat_id = ? AND owl_number = ?", [chatId, number]);

			const rows = await tx.query("SELECT owl_number FROM frantic_owls_chat_members WHERE chat_id = ?", [chatId]);
			const members = rows.map((row) => String(row.owl_number));

			// Nobody can reach a chat without members any more. With soft deletion it is only marked closed and keeps its history;
			// otherwise the last one out takes the chat (and, through the foreign keys, its messages) with them.
			if (members.length === 0 && this.#isSoftDelete)
			{
				await tx.update("UPDATE frantic_owls_chats SET closed_at = ? WHERE id = ?", [sentAt, chatId]);
			}
			else if (members.length === 0)
			{
				await tx.update("DELETE FROM frantic_owls_chats WHERE id = ?", [chatId]);
			}

			const promoted = members.length > 0 ? await this.#EnsureAdmin(tx, chatId) : "";
			return { message: { id, chatId, sender: number, body: "", kind, sentAt, deliverAt: 0, replyTo: null, unsentAt: 0 }, members, promoted };
		}), null);
	}

	// ========================
	// Pruning & Retired Owls
	// ========================

	/// <summary>
	/// Delete every owl and note sent before a point in time (storage.messageRetentionDays).
	/// With soft deletion they are only marked deleted_at, which hides them from every phone; with storage.disableSoftDelete the rows are dropped.
	/// </summary>
	/// <param name="before">Epoch milliseconds; anything sent earlier goes</param>
	/// <returns>How many owls were deleted, or -1 on failure</returns>
	async PruneMessages(before)
	{
		return this.#Run("PruneMessages", async () =>
		{
			let total = 0;
			let affected = 0;

			// Batched, so a first prune over years of history does not lock the table for its whole length.
			do
			{
				affected = this.#isSoftDelete
					? Number(await this.#mysql.update("UPDATE frantic_owls_messages SET deleted_at = ? WHERE sent_at < ? AND deleted_at = 0 LIMIT ?", [Date.now(), before, pruneBatchSize]))
					: Number(await this.#mysql.update("DELETE FROM frantic_owls_messages WHERE sent_at < ? LIMIT ?", [before, pruneBatchSize]));
				total += affected;
			}
			while (affected >= pruneBatchSize);

			// A pin on a pruned owl would point at nothing.
			await this.#mysql.update("UPDATE frantic_owls_chats c LEFT JOIN frantic_owls_messages p ON p.id = c.pinned_message_id SET c.pinned_message_id = NULL WHERE c.pinned_message_id IS NOT NULL AND (p.id IS NULL OR p.deleted_at > 0)");
			return total;
		}, -1);
	}

	/// <summary>
	/// Delete every call log entry of calls started before a point in time, by the same rules as PruneMessages.
	/// </summary>
	/// <param name="before">Epoch milliseconds; anything started earlier goes</param>
	/// <returns>How many calls were deleted, or -1 on failure</returns>
	async PruneCalls(before)
	{
		return this.#Run("PruneCalls", async () =>
		{
			let total = 0;
			let affected = 0;

			do
			{
				affected = this.#isSoftDelete
					? Number(await this.#mysql.update("UPDATE frantic_owls_calls SET deleted_at = ? WHERE started_at < ? AND deleted_at = 0 LIMIT ?", [Date.now(), before, pruneBatchSize]))
					: Number(await this.#mysql.update("DELETE FROM frantic_owls_calls WHERE started_at < ? LIMIT ?", [before, pruneBatchSize]));
				total += affected;
			}
			while (affected >= pruneBatchSize);

			return total;
		}, -1);
	}

	/// <summary>
	/// Retire the owl number of a deleted character: it stops being a live owl and is never handed out again.
	/// </summary>
	/// <param name="characterId">hmp-core character ID</param>
	/// <returns>The retired number, "" when the character never had one, or null on failure</returns>
	async RetireNumber(characterId)
	{
		return this.#Run("RetireNumber", () => this.#mysql.transaction(async (tx) =>
		{
			const number = await tx.scalar("SELECT owl_number FROM frantic_owls_numbers WHERE character_id = ?", [characterId]);

			if (!number)
			{
				return "";
			}

			await tx.update("INSERT IGNORE INTO frantic_owls_retired_numbers (owl_number, character_id, retired_at) VALUES (?, ?, ?)", [String(number), characterId, Date.now()]);
			await tx.update("DELETE FROM frantic_owls_numbers WHERE character_id = ?", [characterId]);
			return String(number);
		}), null);
	}

	/// <summary>
	/// Characters that have an owl number but were deleted in hmp-core while this resource was not running.
	/// </summary>
	/// <returns>hmp-core character IDs, or an empty array when hmp-core's table cannot be read</returns>
	async ListDeletedCharacters()
	{
		// hmp-core keeps deleted characters as rows with another status. Reading its table is a best-effort catch-up, so a failure is only a warning.
		try
		{
			const rows = await this.#mysql.query("SELECT n.character_id FROM frantic_owls_numbers n JOIN hmp_characters c ON c.id = n.character_id WHERE c.status <> 'active'");
			return rows.map((row) => Number(row.character_id));
		}
		catch (error)
		{
			Logger.LogWarning("Database", `Could not look for characters deleted while the owl post was closed: ${Logger.Describe(error)}`);
			return [];
		}
	}

	/// <summary>
	/// Every retired number among some owl numbers.
	/// </summary>
	/// <param name="numbers">Owl numbers</param>
	/// <returns>Set of the retired ones, or an empty set on failure</returns>
	async ListRetiredAmong(numbers)
	{
		if (numbers.length === 0)
		{
			return new Set();
		}

		return this.#Run("ListRetiredAmong", async () => new Set((await this.#mysql.query("SELECT owl_number FROM frantic_owls_retired_numbers WHERE owl_number IN (?)", [numbers])).map((row) => String(row.owl_number))), new Set());
	}

	/// <summary>
	/// The retired owls a live owl still knows of: in its contacts or sharing a chat with it.
	/// </summary>
	/// <param name="number">Owl number</param>
	/// <returns>Retired numbers, or an empty array on failure</returns>
	async ListRetiredRelated(number)
	{
		return this.#Run("ListRetiredRelated", async () =>
		{
			const rows = await this.#mysql.query(
				`SELECT r.owl_number FROM frantic_owls_retired_numbers r
				WHERE r.owl_number IN (SELECT contact_number FROM frantic_owls_contacts WHERE owner_number = ?)
					OR r.owl_number IN (SELECT other.owl_number FROM frantic_owls_chat_members mine JOIN frantic_owls_chat_members other ON other.chat_id = mine.chat_id WHERE mine.owl_number = ?)`,
				[number, number]);
			return rows.map((row) => String(row.owl_number));
		}, []);
	}

	/// <summary>
	/// The chats a retired owl still belongs to, by kind.
	/// </summary>
	/// <param name="number">Retired owl number</param>
	/// <returns>[{ id, kind }], or null on failure</returns>
	async ListChatsOf(number)
	{
		return this.#Run("ListChatsOf", async () => (await this.#mysql.query("SELECT c.id, c.kind FROM frantic_owls_chat_members cm JOIN frantic_owls_chats c ON c.id = cm.chat_id WHERE cm.owl_number = ?", [number])).map((row) => ({ id: Number(row.id), kind: String(row.kind) })), null);
	}

	/// <summary>
	/// Take a retired owl out of every announcement channel. It cannot read them any more, and channels hold every character otherwise.
	/// </summary>
	/// <param name="number">Retired owl number</param>
	/// <returns>True on success</returns>
	async LeaveChannels(number)
	{
		return this.#Run("LeaveChannels", async () =>
		{
			await this.#mysql.update("DELETE cm FROM frantic_owls_chat_members cm JOIN frantic_owls_chats c ON c.id = cm.chat_id WHERE c.kind = 'channel' AND cm.owl_number = ?", [number]);
			return true;
		}, false);
	}

	/// <summary>
	/// Drop what only a retired owl itself could see: its contacts, settings, picture, blocks, hidden owls and its side of the call log.
	/// Only used with storage.disableSoftDelete; owls it sent stay, as they belong to the chats of the others too, and so do calls the other owl still lists.
	/// </summary>
	/// <param name="number">Retired owl number</param>
	/// <returns>True on success</returns>
	async PurgeOwnData(number)
	{
		return this.#Run("PurgeOwnData", () => this.#mysql.transaction(async (tx) =>
		{
			const now = Date.now();
			await tx.update("DELETE FROM frantic_owls_contacts WHERE owner_number = ?", [number]);
			await tx.update("DELETE FROM frantic_owls_settings WHERE owl_number = ?", [number]);
			await tx.update("DELETE FROM frantic_owls_profiles WHERE owl_number = ?", [number]);
			await tx.update("DELETE FROM frantic_owls_blocks WHERE owner_number = ?", [number]);
			await tx.update("DELETE FROM frantic_owls_hidden_messages WHERE owner_number = ?", [number]);
			await tx.update("UPDATE frantic_owls_calls SET caller_cleared_at = ? WHERE caller_number = ? AND caller_cleared_at = 0", [now, number]);
			await tx.update("UPDATE frantic_owls_calls SET callee_cleared_at = ? WHERE callee_number = ? AND callee_cleared_at = 0", [now, number]);
			await tx.update("DELETE FROM frantic_owls_calls WHERE (caller_number = ? OR callee_number = ?) AND caller_cleared_at > 0 AND callee_cleared_at > 0", [number, number]);
			return true;
		}), false);
	}

	/// <summary>
	/// Whether soft deletion is on (storage.disableSoftDelete not set).
	/// </summary>
	/// <returns>True while deleted owls are kept</returns>
	IsSoftDelete()
	{
		return this.#isSoftDelete;
	}

	/// <summary>
	/// Read one page of a chat's history as one member sees it, oldest first. See VisibleToMember for what is left out.
	/// </summary>
	/// <param name="chatId">Chat row ID</param>
	/// <param name="viewer">Owl number of the member reading</param>
	/// <param name="beforeId">Only messages older than this ID; 0 for the newest page</param>
	/// <param name="limit">Page size</param>
	/// <returns>{ messages, hasMore }, or null on failure</returns>
	async ListMessages(chatId, viewer, beforeId, limit)
	{
		return this.#Run("ListMessages", async () =>
		{
			const source = `${messageSource} JOIN frantic_owls_chat_members cm ON cm.chat_id = m.chat_id AND cm.owl_number = ? JOIN frantic_owls_chats c ON c.id = m.chat_id`;
			const now = Date.now();

			// One extra row tells us whether an older page exists without a second COUNT query.
			const rows = beforeId > 0
				? await this.#mysql.query(`SELECT ${messageColumns} FROM ${source} WHERE m.chat_id = ? AND ${VisibleToMember("m")} AND m.id < ? ORDER BY m.id DESC LIMIT ?`, [viewer, chatId, now, beforeId, limit + 1])
				: await this.#mysql.query(`SELECT ${messageColumns} FROM ${source} WHERE m.chat_id = ? AND ${VisibleToMember("m")} ORDER BY m.id DESC LIMIT ?`, [viewer, chatId, now, limit + 1]);

			const hasMore = rows.length > limit;
			const page = rows.slice(0, limit).map(MapMessage).reverse();

			return { messages: page, hasMore };
		}, null);
	}

	/// <summary>
	/// One message of a chat, if the viewer is a member and can see it (see VisibleToMember).
	/// </summary>
	/// <param name="chatId">Chat row ID</param>
	/// <param name="viewer">Owl number of the member reading</param>
	/// <param name="messageId">Message row ID</param>
	/// <returns>Message record, null when not visible, or undefined on failure</returns>
	async GetVisibleMessage(chatId, viewer, messageId)
	{
		return this.#Run("GetVisibleMessage", async () =>
		{
			const row = await this.#mysql.single(`SELECT ${messageColumns} FROM ${messageSource} JOIN frantic_owls_chat_members cm ON cm.chat_id = m.chat_id AND cm.owl_number = ? JOIN frantic_owls_chats c ON c.id = m.chat_id WHERE m.id = ? AND m.chat_id = ? AND ${VisibleToMember("m")}`, [viewer, messageId, chatId, Date.now()]);
			return row ? MapMessage(row) : null;
		}, undefined);
	}

	/// <summary>
	/// Move a member's read marker forward. It never moves backwards.
	/// </summary>
	/// <param name="chatId">Chat row ID</param>
	/// <param name="number">Member owl number</param>
	/// <param name="messageId">Newest message ID the member has seen</param>
	/// <returns>The member's read marker afterwards, 0 when they are not a member, or -1 on failure</returns>
	async MarkRead(chatId, number, messageId)
	{
		return this.#Run("MarkRead", async () =>
		{
			// Capped at the chat's newest message, so a page cannot claim to have read owls that do not exist yet; read receipts would show them as read.
			await this.#mysql.update("UPDATE frantic_owls_chat_members SET last_read_message_id = GREATEST(last_read_message_id, LEAST(?, (SELECT COALESCE(MAX(id), 0) FROM frantic_owls_messages WHERE chat_id = ?))) WHERE chat_id = ? AND owl_number = ?", [messageId, chatId, chatId, number]);
			return Number(await this.#mysql.scalar("SELECT last_read_message_id FROM frantic_owls_chat_members WHERE chat_id = ? AND owl_number = ?", [chatId, number]) || 0);
		}, -1);
	}

	/// <summary>
	/// Silence (or unsilence) a chat's notifications for one member.
	/// </summary>
	/// <param name="chatId">Chat row ID</param>
	/// <param name="number">Member owl number</param>
	/// <param name="mutedUntil">Epoch milliseconds until which it stays quiet; 0 to unmute</param>
	/// <returns>True if the member's row was found</returns>
	async SetMuted(chatId, number, mutedUntil)
	{
		return this.#Run("SetMuted", async () => Number(await this.#mysql.update("UPDATE frantic_owls_chat_members SET muted_until = ? WHERE chat_id = ? AND owl_number = ?", [mutedUntil, chatId, number])) > 0, false);
	}

	// ========================
	// Calls
	// ========================

	/// <summary>
	/// Record a finished call in both owls' call logs.
	/// </summary>
	/// <param name="call">{ caller, callee, outcome, startedAt, answeredAt, endedAt, hideFromCallee } where hideFromCallee keeps it out of the callee's log (a call from someone they blocked)</param>
	/// <returns>The new row's ID, or invalidId on failure</returns>
	async InsertCall(call)
	{
		return this.#Run("InsertCall", async () => Number(await this.#mysql.insert(
			"INSERT INTO frantic_owls_calls (caller_number, callee_number, outcome, started_at, answered_at, ended_at, callee_cleared_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
			[call.caller, call.callee, call.outcome, call.startedAt, call.answeredAt, call.endedAt, call.hideFromCallee ? call.endedAt : 0])), invalidId);
	}

	/// <summary>
	/// Read one call log entry as one of its two owls sees it.
	/// </summary>
	/// <param name="callId">Call row ID</param>
	/// <param name="viewer">Owl number of the caller or the callee</param>
	/// <returns>Entry (see MapCall), null when it is not in their log, or undefined on failure</returns>
	async GetCall(callId, viewer)
	{
		return this.#Run("GetCall", async () =>
		{
			const row = await this.#mysql.single(`SELECT ${callColumns} FROM frantic_owls_calls WHERE id = ? AND deleted_at = 0 AND ((caller_number = ? AND caller_cleared_at = 0) OR (callee_number = ? AND callee_cleared_at = 0))`, [callId, viewer, viewer]);
			return row ? MapCall(row, viewer) : null;
		}, undefined);
	}

	/// <summary>
	/// An owl's call log, newest first.
	/// </summary>
	/// <param name="number">Owl number</param>
	/// <param name="limit">Most entries returned</param>
	/// <returns>Entries (see MapCall), or null on failure</returns>
	async ListCalls(number, limit)
	{
		return this.#Run("ListCalls", async () =>
		{
			// Two halves, so each walks its own (number, id) index instead of the whole table; nobody can call themselves, so they never overlap.
			const rows = await this.#mysql.query(
				`(SELECT ${callColumns} FROM frantic_owls_calls WHERE caller_number = ? AND caller_cleared_at = 0 AND deleted_at = 0 ORDER BY id DESC LIMIT ?)
				UNION ALL
				(SELECT ${callColumns} FROM frantic_owls_calls WHERE callee_number = ? AND callee_cleared_at = 0 AND deleted_at = 0 ORDER BY id DESC LIMIT ?)
				ORDER BY id DESC LIMIT ?`,
				[number, limit, number, limit, limit]);
			return rows.map((row) => MapCall(row, number));
		}, null);
	}

	/// <summary>
	/// Mark every missed call of an owl as seen, which clears the badge on its Calls app.
	/// </summary>
	/// <param name="number">Owl number</param>
	/// <returns>True on success</returns>
	async MarkCallsSeen(number)
	{
		return this.#Run("MarkCallsSeen", async () =>
		{
			await this.#mysql.update("UPDATE frantic_owls_calls SET callee_seen_at = ? WHERE callee_number = ? AND callee_seen_at = 0", [Date.now(), number]);
			return true;
		}, false);
	}

	/// <summary>
	/// Take calls out of one owl's log; the other owl keeps them in theirs.
	/// With soft deletion the rows stay, marked cleared for that side; with storage.disableSoftDelete a row goes once both sides have cleared it.
	/// </summary>
	/// <param name="number">Owl number clearing its log</param>
	/// <param name="callId">One call to clear, or 0 for the whole log</param>
	/// <returns>True on success</returns>
	async ClearCalls(number, callId)
	{
		return this.#Run("ClearCalls", () => this.#mysql.transaction(async (tx) =>
		{
			const now = Date.now();
			const onlyOne = callId > 0 ? " AND id = ?" : "";
			const extra = callId > 0 ? [callId] : [];

			await tx.update(`UPDATE frantic_owls_calls SET caller_cleared_at = ? WHERE caller_number = ? AND caller_cleared_at = 0${onlyOne}`, [now, number, ...extra]);
			await tx.update(`UPDATE frantic_owls_calls SET callee_cleared_at = ? WHERE callee_number = ? AND callee_cleared_at = 0${onlyOne}`, [now, number, ...extra]);

			if (!this.#isSoftDelete)
			{
				await tx.update(`DELETE FROM frantic_owls_calls WHERE (caller_number = ? OR callee_number = ?) AND caller_cleared_at > 0 AND callee_cleared_at > 0${onlyOne}`, [number, number, ...extra]);
			}

			return true;
		}), false);
	}

	/// <summary>
	/// Whether two owls know each other well enough for one to call the other:
	/// either has the other as a contact, they share a one-to-one chat, or they have called before.
	/// </summary>
	/// <param name="first">One owl number</param>
	/// <param name="second">The other owl number</param>
	/// <returns>True or false, or null on failure</returns>
	async AreRelated(first, second)
	{
		const directKey = first < second ? `${first}:${second}` : `${second}:${first}`;

		return this.#Run("AreRelated", async () => Number(await this.#mysql.scalar(
			`SELECT EXISTS (SELECT 1 FROM frantic_owls_contacts WHERE (owner_number = ? AND contact_number = ?) OR (owner_number = ? AND contact_number = ?))
				OR EXISTS (SELECT 1 FROM frantic_owls_chats WHERE direct_key = ?)
				OR EXISTS (SELECT 1 FROM frantic_owls_calls WHERE (caller_number = ? AND callee_number = ?) OR (caller_number = ? AND callee_number = ?))`,
			[first, second, second, first, directKey, first, second, second, first])) === 1, null);
	}

	// ========================
	// Blocks
	// ========================

	/// <summary>
	/// Every owl number an owl has blocked.
	/// </summary>
	/// <param name="owner">Blocking owl's number</param>
	/// <returns>Blocked numbers, or null on failure</returns>
	async ListBlocks(owner)
	{
		return this.#Run("ListBlocks", async () => (await this.#mysql.query("SELECT blocked_number FROM frantic_owls_blocks WHERE owner_number = ? ORDER BY created_at", [owner])).map((row) => String(row.blocked_number)), null);
	}

	/// <summary>
	/// Block an owl. Blocking twice is harmless.
	/// </summary>
	/// <param name="owner">Blocking owl's number</param>
	/// <param name="blocked">Owl number to block</param>
	/// <returns>True on success</returns>
	async AddBlock(owner, blocked)
	{
		return this.#Run("AddBlock", async () =>
		{
			await this.#mysql.update("INSERT IGNORE INTO frantic_owls_blocks (owner_number, blocked_number, created_at) VALUES (?, ?, ?)", [owner, blocked, Date.now()]);
			return true;
		}, false);
	}

	/// <summary>
	/// Unblock an owl.
	/// </summary>
	/// <param name="owner">Blocking owl's number</param>
	/// <param name="blocked">Owl number to unblock</param>
	/// <returns>True on success, including when it was not blocked</returns>
	async RemoveBlock(owner, blocked)
	{
		return this.#Run("RemoveBlock", async () =>
		{
			await this.#mysql.update("DELETE FROM frantic_owls_blocks WHERE owner_number = ? AND blocked_number = ?", [owner, blocked]);
			return true;
		}, false);
	}

	/// <summary>
	/// Which of several owls have blocked one particular owl.
	/// </summary>
	/// <param name="blocked">Owl number that may be blocked</param>
	/// <param name="owners">Owl numbers to check</param>
	/// <returns>Set of the owners that blocked it, or null on failure</returns>
	async ListBlockersAmong(blocked, owners)
	{
		if (owners.length === 0)
		{
			return new Set();
		}

		return this.#Run("ListBlockersAmong", async () => new Set((await this.#mysql.query("SELECT owner_number FROM frantic_owls_blocks WHERE blocked_number = ? AND owner_number IN (?)", [blocked, owners])).map((row) => String(row.owner_number))), null);
	}

	// ========================
	// System Senders & Channels
	// ========================

	/// <summary>
	/// Create or update a system sender (e.g. "ministry", "gringotts") and return its owl number.
	/// The number stays the same for a key forever, so its chats survive restarts and renames.
	/// </summary>
	/// <param name="key">Stable sender key, already validated</param>
	/// <param name="name">Display name, already validated</param>
	/// <param name="avatarUrl">Picture link, already validated (may be empty)</param>
	/// <returns>The sender's owl number, or an empty string on failure</returns>
	async EnsureSender(key, name, avatarUrl)
	{
		return this.#Run("EnsureSender", async () =>
		{
			await this.#mysql.update("INSERT INTO frantic_owls_senders (sender_key, display_name, avatar_url, updated_at) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), avatar_url = VALUES(avatar_url), updated_at = VALUES(updated_at)", [key, name, avatarUrl, Date.now()]);
			const id = await this.#mysql.scalar("SELECT id FROM frantic_owls_senders WHERE sender_key = ?", [key]);
			return id ? GetSenderNumber(Number(id)) : "";
		}, "");
	}

	/// <summary>
	/// Every system sender ever registered, so pages can name owls from senders whose resource is not running.
	/// </summary>
	/// <returns>[{ key, number, name, avatarUrl }], or an empty array on failure</returns>
	async ListSenders()
	{
		return this.#Run("ListSenders", async () => (await this.#mysql.query("SELECT id, sender_key, display_name, avatar_url FROM frantic_owls_senders ORDER BY id")).map((row) => ({ key: String(row.sender_key), number: GetSenderNumber(Number(row.id)), name: String(row.display_name), avatarUrl: String(row.avatar_url || "") })), []);
	}

	/// <summary>
	/// The broadcast channel of a system sender, created the first time it is needed.
	/// </summary>
	/// <param name="senderNumber">System sender's owl number</param>
	/// <param name="title">Channel title (the sender's name)</param>
	/// <returns>Chat ID, or invalidId on failure</returns>
	async EnsureChannel(senderNumber, title)
	{
		return this.#Run("EnsureChannel", async () =>
		{
			const existing = await this.#mysql.scalar("SELECT id FROM frantic_owls_chats WHERE kind = 'channel' AND created_by = ? ORDER BY id LIMIT 1", [senderNumber]);

			if (existing)
			{
				await this.#mysql.update("UPDATE frantic_owls_chats SET title = ? WHERE id = ?", [title, existing]);
				return Number(existing);
			}

			return Number(await this.#mysql.insert("INSERT INTO frantic_owls_chats (kind, direct_key, title, created_by, created_at) VALUES ('channel', NULL, ?, ?, ?)", [title, senderNumber, Date.now()]));
		}, invalidId);
	}

	/// <summary>
	/// Make every character that owns an owl number a member of a channel. Existing members are left alone.
	/// New members start with everything already posted marked as read, so they only see announcements from now on.
	/// </summary>
	/// <param name="chatId">Channel chat ID</param>
	/// <returns>True on success</returns>
	async JoinEveryoneToChannel(chatId)
	{
		return this.#Run("JoinEveryoneToChannel", async () =>
		{
			const lastId = Number(await this.#mysql.scalar("SELECT COALESCE(MAX(id), 0) FROM frantic_owls_messages WHERE chat_id = ?", [chatId])) || 0;
			await this.#mysql.update("INSERT IGNORE INTO frantic_owls_chat_members (chat_id, owl_number, last_read_message_id, joined_at) SELECT ?, owl_number, ?, ? FROM frantic_owls_numbers", [chatId, lastId, Date.now()]);
			return true;
		}, false);
	}

	/// <summary>
	/// Find who owns an owl number.
	/// </summary>
	/// <param name="number">Owl number</param>
	/// <returns>hmp-core character ID, 0 if unknown, or -1 on failure</returns>
	async GetCharacterForNumber(number)
	{
		return this.#Run("GetCharacterForNumber", async () => Number(await this.#mysql.scalar("SELECT character_id FROM frantic_owls_numbers WHERE owl_number = ?", [number]) || 0), -1);
	}

	// ========================
	// Profiles
	// ========================

	/// <summary>
	/// Read an owl's own profile picture.
	/// </summary>
	/// <param name="number">Owl number</param>
	/// <returns>Picture link (empty if none is set), or null on failure</returns>
	async GetProfileAvatar(number)
	{
		return this.#Run("GetProfileAvatar", async () => String(await this.#mysql.scalar("SELECT avatar_url FROM frantic_owls_profiles WHERE owl_number = ?", [number]) || ""), null);
	}

	/// <summary>
	/// Store an owl's own profile picture, replacing what was there.
	/// </summary>
	/// <param name="number">Owl number</param>
	/// <param name="avatarUrl">Validated picture link (empty to clear it)</param>
	/// <returns>True on success</returns>
	async SaveProfileAvatar(number, avatarUrl)
	{
		return this.#Run("SaveProfileAvatar", async () =>
		{
			await this.#mysql.update("INSERT INTO frantic_owls_profiles (owl_number, avatar_url, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE avatar_url = VALUES(avatar_url), updated_at = VALUES(updated_at)", [number, avatarUrl, Date.now()]);
			return true;
		}, false);
	}

	/// <summary>
	/// Read the profile pictures of several owls at once.
	/// </summary>
	/// <param name="numbers">Owl numbers</param>
	/// <returns>Map of number to picture link (owls without one are left out), or null on failure</returns>
	async ListProfileAvatars(numbers)
	{
		if (numbers.length === 0)
		{
			return new Map();
		}

		return this.#Run("ListProfileAvatars", async () =>
		{
			const rows = await this.#mysql.query("SELECT owl_number, avatar_url FROM frantic_owls_profiles WHERE owl_number IN (?) AND avatar_url <> ''", [numbers]);
			return new Map(rows.map((row) => [String(row.owl_number), String(row.avatar_url)]));
		}, null);
	}

	/// <summary>
	/// Every owl number related to an owl: those it saved as contacts, those that saved it, and those it shares a chat with.
	/// This is the audience allowed to see its profile picture, and the set whose pictures it may see.
	/// </summary>
	/// <param name="number">Owl number</param>
	/// <returns>Related numbers (never including number itself), or null on failure</returns>
	async ListRelatedNumbers(number)
	{
		return this.#Run("ListRelatedNumbers", async () =>
		{
			const rows = await this.#mysql.query(
				`SELECT contact_number AS related FROM frantic_owls_contacts WHERE owner_number = ?
				UNION SELECT owner_number FROM frantic_owls_contacts WHERE contact_number = ?
				UNION SELECT other.owl_number FROM frantic_owls_chat_members mine JOIN frantic_owls_chat_members other ON other.chat_id = mine.chat_id WHERE mine.owl_number = ? AND other.owl_number <> ?`,
				[number, number, number, number]);
			return rows.map((row) => String(row.related)).filter((related) => related !== number);
		}, null);
	}

	// ========================
	// Settings
	// ========================

	/// <summary>
	/// Read the stored settings object of an owl number.
	/// </summary>
	/// <param name="number">Owl number</param>
	/// <returns>Parsed settings object, an empty object if none are stored, or null on failure</returns>
	async GetSettings(number)
	{
		return this.#Run("GetSettings", async () =>
		{
			const text = await this.#mysql.scalar("SELECT settings_json FROM frantic_owls_settings WHERE owl_number = ?", [number]);

			if (!text)
			{
				return {};
			}

			const parsed = JSON.parse(String(text));
			return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
		}, null);
	}

	/// <summary>
	/// Read the stored settings objects of several owl numbers.
	/// </summary>
	/// <param name="numbers">Owl numbers</param>
	/// <returns>Map of number to parsed settings (owls with none stored, or unreadable ones, are left out), or null on failure</returns>
	async ListSettings(numbers)
	{
		if (numbers.length === 0)
		{
			return new Map();
		}

		return this.#Run("ListSettings", async () =>
		{
			const result = new Map();

			for (const row of await this.#mysql.query("SELECT owl_number, settings_json FROM frantic_owls_settings WHERE owl_number IN (?)", [numbers]))
			{
				// One damaged row should not cost the others their settings; it simply falls back to the defaults.
				try
				{
					result.set(String(row.owl_number), JSON.parse(String(row.settings_json)));
				}
				catch (error)
				{
					continue;
				}
			}

			return result;
		}, null);
	}

	/// <summary>
	/// Store the settings object of an owl number, replacing what was there.
	/// </summary>
	/// <param name="number">Owl number</param>
	/// <param name="settings">Validated settings object</param>
	/// <returns>True on success</returns>
	async SaveSettings(number, settings)
	{
		return this.#Run("SaveSettings", async () =>
		{
			await this.#mysql.update("INSERT INTO frantic_owls_settings (owl_number, settings_json, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE settings_json = VALUES(settings_json), updated_at = VALUES(updated_at)", [number, JSON.stringify(settings), Date.now()]);
			return true;
		}, false);
	}
}

module.exports = { OwlDatabase, invalidId, MessageKind, MemberRole, CallOutcome, IsSenderNumber, ToQuote };
