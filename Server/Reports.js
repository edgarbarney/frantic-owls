// FranticDreamer 2026
"use strict";

const { Ok, Fail } = require("./Result.js");
const { ClampInteger } = require("./Config.js");
const { IsSenderNumber, ReportStatus } = require("./Database.js");
const { Logger } = require("./Logger.js");

/// <summary>
/// Owls kept before and after the reported one when a report copies its chat.
/// </summary>
const snapshotBefore = 200;
const snapshotAfter = 100;

/// <summary>
/// Reports on one page of the moderators' list.
/// </summary>
const reportPageSize = 30;

/// <summary>
/// Most owls of a report's chat read at once, on each side of where the page starts.
/// </summary>
const messagePageSize = 25;

/// <summary>
/// Most bytes of owls one page of a report's chat carries. A page is cut to this so it fits the outbox's batch budget (letters can be long).
/// </summary>
const messagePageBytes = 16000;

/// <summary>
/// Longest search kept.
/// </summary>
const maxQueryLength = 64;

/// <summary>
/// Where a report was filed from: an owl on the phone, or a letter on the desk.
/// </summary>
const ReportSource = Object.freeze
({
	Phone: "phone",
	Letter: "letter",
});

// ========================
// Report Service
// ========================

/// <summary>
/// Reports: any owl can report an owl (or a letter) it received, and moderators read the chat it came from.
///
/// <para>
/// NOTE: A report copies the chat as its reporter saw it then, around the reported owl, with the names and numbers of everyone in it.
/// Unsending, deleting or pruning owls afterwards never takes that evidence, and it is the reporter's view only: nothing they could not see is copied.
/// </para>
///
/// <para>
/// NOTE: The reporter learns only that the report was received. In immersive mode a report from a letter therefore tells its reader nothing about who wrote it,
/// while moderators, who need to, see every member's name and owl number.
/// </para>
///
/// </summary>
class ReportService
{
	/// <summary>
	/// OwlDatabase instance.
	/// </summary>
	#database;

	/// <summary>
	/// OwlDirectory instance, for the moderators online.
	/// </summary>
	#directory;

	/// <summary>
	/// Outbox instance.
	/// </summary>
	#outbox;

	/// <summary>
	/// SenderRegistry instance, for the names of official senders in a reported chat.
	/// </summary>
	#senders;

	/// <summary>
	/// AuditLog instance.
	/// </summary>
	#audit;

	/// <summary>
	/// Async function (player) => boolean: whether a player may moderate reports (reports.capability).
	/// </summary>
	#CanModerate;

	/// <summary>
	/// Function (number) => string describing an owl for the audit log.
	/// </summary>
	#Describe;

	/// <summary>
	/// Whether reports are on (reports.enabled).
	/// </summary>
	#isEnabled;

	/// <summary>
	/// Per-owl limiter for filing reports, keyed by owl number.
	/// </summary>
	#fileLimiter;

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
	/// Check that the player may moderate, asked fresh each time: staff rights change while a character stays loaded.
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <returns>Text key of the refusal, or null when allowed</returns>
	async #CheckModerator(entry)
	{
		if (!this.#isEnabled)
		{
			return "error.report.closed";
		}

		return await this.#CanModerate(entry.player) ? null : "error.report.notModerator";
	}

	/// <summary>
	/// The names of everyone in a reported chat: its members, and anyone who wrote one of the copied owls (a member who has since left a bulk owl).
	/// </summary>
	/// <param name="chat">Chat record</param>
	/// <param name="reporter">Reporter's owl number</param>
	/// <param name="messages">Copied owls</param>
	/// <returns>[{ number, name }]</returns>
	async #GetMembers(chat, reporter, messages)
	{
		const numbers = new Set([reporter, ...(chat.kind === "channel" ? [] : chat.members), ...messages.map((message) => message.sender)]);
		const members = [];

		for (const number of numbers)
		{
			const name = IsSenderNumber(number) ? this.#senders.GetName(number) : await this.#database.GetNumberName(number);
			members.push({ number, name: name || "" });
		}

		return members;
	}

	/// <summary>
	/// Cut a page of a report's chat to the byte budget, dropping owls from its far ends and keeping the one it was asked around.
	/// </summary>
	/// <param name="page">{ messages, hasOlder, hasNewer } from the database</param>
	/// <param name="keepId">Message ID never dropped, or 0</param>
	/// <param name="direction">"older", "newer" or "around"</param>
	/// <returns>The page, cut</returns>
	#FitPage(page, keepId, direction)
	{
		const messages = [...page.messages];
		let hasOlder = page.hasOlder;
		let hasNewer = page.hasNewer;
		let bytes = messages.reduce((total, message) => total + Buffer.byteLength(JSON.stringify(message), "utf8"), 0);
		let fromOldEnd = direction !== "newer";

		while (bytes > messagePageBytes && messages.length > 1)
		{
			// An "older" page joins what the page has at its newest end, so it loses its oldest owls; a "newer" page the other way; "around" trims both ends in turn.
			let dropOld = direction === "around" ? fromOldEnd : direction === "older";

			if (dropOld && messages[0].id === keepId)
			{
				dropOld = false;
			}
			else if (!dropOld && messages[messages.length - 1].id === keepId)
			{
				dropOld = true;
			}

			const dropped = dropOld ? messages.shift() : messages.pop();
			bytes -= Buffer.byteLength(JSON.stringify(dropped), "utf8");

			if (dropOld)
			{
				hasOlder = true;
			}
			else
			{
				hasNewer = true;
			}

			fromOldEnd = !fromOldEnd;
		}

		return { messages, hasOlder, hasNewer };
	}

	/// <summary>
	/// Tell every moderator online that a report arrived or changed.
	/// </summary>
	/// <param name="type">"reports:new" or "reports:updated"</param>
	/// <param name="report">Report summary</param>
	async #TellModerators(type, report)
	{
		const open = await this.#database.CountOpenReports();

		for (const entry of this.#directory.All())
		{
			if (await this.#CanModerate(entry.player))
			{
				this.#outbox.Push(entry.player, type, { report, open });
			}
		}
	}

	/// <summary>
	/// Constructor.
	/// </summary>
	/// <param name="options">{ database, directory, outbox, senders, audit, hmp, config, CanModerate, Describe }</param>
	constructor(options)
	{
		this.#database = options.database;
		this.#directory = options.directory;
		this.#outbox = options.outbox;
		this.#senders = options.senders;
		this.#audit = options.audit;
		this.#CanModerate = options.CanModerate;
		this.#Describe = options.Describe;
		this.#isEnabled = options.config.reports.enabled;
		this.#fileLimiter = options.hmp.rateLimit.create({ limit: 5, windowMs: 60000 });
	}

	/// <summary>
	/// Drop rate-limit buckets nobody has used for a while. Call from a maintenance tick.
	/// </summary>
	Sweep()
	{
		this.#fileLimiter.sweep(240000);
	}

	/// <summary>
	/// What the page needs to know about moderation when it loads: whether this player moderates, and how many reports are open if so.
	/// </summary>
	/// <param name="entry">Directory entry</param>
	/// <returns>{ canModerate, open }</returns>
	async GetAccess(entry)
	{
		if (await this.#CheckModerator(entry))
		{
			return { canModerate: false, open: 0 };
		}

		return { canModerate: true, open: Math.max(0, await this.#database.CountOpenReports()) };
	}

	/// <summary>
	/// Report an owl the player received.
	/// </summary>
	/// <param name="entry">Directory entry of the reporting owl</param>
	/// <param name="data">{ messageId }</param>
	/// <param name="source">ReportSource value</param>
	/// <returns>Result carrying { reportId, isNew }</returns>
	async File(entry, data, source)
	{
		if (!this.#isEnabled)
		{
			return Fail("error.report.closed");
		}

		const messageId = this.#ReadId(data.messageId);

		if (messageId === 0)
		{
			return Fail("error.report.gone");
		}

		if (!this.#fileLimiter.allow(entry.number))
		{
			return Fail("error.slowDown");
		}

		// The same check as reading a letter: the owl must be one the reporter can see now.
		const message = await this.#database.GetLetter(entry.number, messageId);

		if (message === undefined)
		{
			return Fail("error.report.failed");
		}

		if (!message)
		{
			return Fail("error.report.gone");
		}

		if (message.sender === entry.number)
		{
			return Fail("error.report.own");
		}

		if (IsSenderNumber(message.sender))
		{
			return Fail("error.report.official");
		}

		const [chat, messages] = await Promise.all([this.#database.GetChat(message.chatId), this.#database.ListMessagesAround(message.chatId, entry.number, messageId, snapshotBefore, snapshotAfter)]);

		if (!chat || !messages)
		{
			return Fail("error.report.failed");
		}

		const members = await this.#GetMembers(chat, entry.number, messages);
		const stored = await this.#database.InsertReport({ reporter: entry.number, messageId, sender: message.sender, chatId: chat.id, chatKind: chat.kind, chatTitle: chat.title, source }, members, messages);

		if (!stored)
		{
			return Fail("error.report.failed");
		}

		if (stored.isNew)
		{
			this.#audit.Log("reports", "Owl reported", `${this.#Describe(entry.number)} reported owl #${messageId} from ${this.#Describe(message.sender)} (report #${stored.id}).`);
			const report = await this.#database.GetReport(stored.id);

			if (report)
			{
				this.#TellModerators("reports:new", { ...report, members: undefined, messageId: undefined }).catch((error) => Logger.LogWarning("Reports", `Could not tell moderators about report #${stored.id}: ${Logger.Describe(error)}`));
			}
		}

		return Ok({ reportId: stored.id, isNew: stored.isNew });
	}

	/// <summary>
	/// One page of reports for a moderator.
	/// </summary>
	/// <param name="entry">Directory entry of the moderator</param>
	/// <param name="data">{ query, status, beforeId }</param>
	/// <returns>Result carrying { reports, hasMore, open }</returns>
	async List(entry, data)
	{
		const refusal = await this.#CheckModerator(entry);

		if (refusal)
		{
			return Fail(refusal);
		}

		const query = String(data.query ?? "").trim().slice(0, maxQueryLength);
		const status = Object.values(ReportStatus).includes(data.status) ? data.status : "";
		const [page, open] = await Promise.all([this.#database.ListReports(query, status, this.#ReadId(data.beforeId), reportPageSize), this.#database.CountOpenReports()]);

		if (!page)
		{
			return Fail("error.report.listFailed");
		}

		return Ok({ reports: page.reports, hasMore: page.hasMore, open: Math.max(0, open) });
	}

	/// <summary>
	/// Open a report: its facts, its members and the part of its chat around the reported owl.
	/// </summary>
	/// <param name="entry">Directory entry of the moderator</param>
	/// <param name="data">{ reportId }</param>
	/// <returns>Result carrying { report, page }</returns>
	async Open(entry, data)
	{
		const refusal = await this.#CheckModerator(entry);

		if (refusal)
		{
			return Fail(refusal);
		}

		const report = await this.#database.GetReport(this.#ReadId(data.reportId));

		if (report === undefined)
		{
			return Fail("error.report.openFailed");
		}

		if (!report)
		{
			return Fail("error.report.missing");
		}

		const page = await this.#database.ListReportMessages(report.id, report.messageId, "around", messagePageSize);

		if (!page)
		{
			return Fail("error.report.openFailed");
		}

		this.#audit.Log("reports", "Report read", `${this.#Describe(entry.number)} read report #${report.id}.`);
		return Ok({ report, page: this.#FitPage(page, report.messageId, "around") });
	}

	/// <summary>
	/// More of a report's chat, older or newer than what the moderator has.
	/// </summary>
	/// <param name="entry">Directory entry of the moderator</param>
	/// <param name="data">{ reportId, anchorId, direction }</param>
	/// <returns>Result carrying { reportId, direction, page }</returns>
	async Messages(entry, data)
	{
		const refusal = await this.#CheckModerator(entry);

		if (refusal)
		{
			return Fail(refusal);
		}

		const reportId = this.#ReadId(data.reportId);
		const direction = data.direction === "newer" ? "newer" : "older";
		const page = reportId > 0 ? await this.#database.ListReportMessages(reportId, this.#ReadId(data.anchorId), direction, messagePageSize) : null;

		if (!page)
		{
			return Fail("error.report.openFailed");
		}

		return Ok({ reportId, direction, page: this.#FitPage(page, 0, direction) });
	}

	/// <summary>
	/// Mark a report resolved or dismissed, or open it again.
	/// </summary>
	/// <param name="entry">Directory entry of the moderator</param>
	/// <param name="data">{ reportId, status }</param>
	/// <returns>Result carrying { report }</returns>
	async SetStatus(entry, data)
	{
		const refusal = await this.#CheckModerator(entry);

		if (refusal)
		{
			return Fail(refusal);
		}

		const reportId = this.#ReadId(data.reportId);
		const status = Object.values(ReportStatus).includes(data.status) ? data.status : "";

		if (!reportId || !status)
		{
			return Fail("error.report.statusFailed");
		}

		if (!await this.#database.SetReportStatus(reportId, status, entry.characterName))
		{
			return Fail("error.report.statusFailed");
		}

		const report = await this.#database.GetReport(reportId);

		if (!report)
		{
			return Fail("error.report.statusFailed");
		}

		const summary = { ...report, members: undefined, messageId: undefined };
		this.#audit.Log("reports", "Report status changed", `${this.#Describe(entry.number)} marked report #${reportId} ${status}.`);
		this.#TellModerators("reports:updated", summary).catch((error) => Logger.LogWarning("Reports", `Could not tell moderators about report #${reportId}: ${Logger.Describe(error)}`));
		return Ok({ report: summary });
	}
}

module.exports = { ReportService, ReportSource };
