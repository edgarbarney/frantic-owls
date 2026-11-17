// FranticDreamer 2026
"use strict";

// ========================
// Reports Mock
// ========================

/// <summary>
/// Reports for the preview pages, shared by the phone's and the desk's mock servers (see Server/Reports.js for the real thing).
/// The previewing player is always a moderator, so the Moderation app and the Reports tab show.
/// </summary>
window.OwlsReportsMock = (() =>
{
	/// <summary>
	/// Every report filed so far, newest last.
	/// </summary>
	const reports = [];
	let nextId = 1;

	/// <summary>
	/// A report as the list shows it.
	/// </summary>
	/// <param name="report">Stored report</param>
	/// <returns>Summary</returns>
	function Summarise(report)
	{
		const name = (number) => (report.members.find((member) => member.number === number) || {}).name || "";
		return { id: report.id, reporter: report.reporter, reporterName: name(report.reporter), sender: report.sender, senderName: name(report.sender), chatKind: report.chatKind, chatTitle: report.chatTitle, source: report.source, status: report.status, createdAt: report.createdAt, handledBy: report.handledBy, handledAt: report.handledAt };
	}

	/// <summary>
	/// How many reports are open.
	/// </summary>
	/// <returns>Count</returns>
	function CountOpen()
	{
		return reports.filter((report) => report.status === "open").length;
	}

	/// <summary>
	/// What the page is told about moderation when it loads.
	/// </summary>
	/// <returns>{ canModerate, open }</returns>
	function Access()
	{
		return { canModerate: true, open: CountOpen() };
	}

	/// <summary>
	/// File a report.
	/// </summary>
	/// <param name="report">{ reporter, sender, messageId, chatKind, chatTitle, source, members: [{ number, name }], messages: [{ id, sender, kind, body, sentAt, replyToId, unsent, forwarded }] }</param>
	/// <returns>{ reportId, isNew, item } where item is the "reports:new" push for the page, or null</returns>
	function File(report)
	{
		const existing = reports.find((entry) => entry.reporter === report.reporter && entry.messageId === report.messageId);

		if (existing)
		{
			return { reportId: existing.id, isNew: false, item: null };
		}

		const stored = { ...report, id: nextId++, status: "open", createdAt: Date.now(), handledBy: "", handledAt: 0 };
		reports.push(stored);
		return { reportId: stored.id, isNew: true, item: { type: "reports:new", data: { report: Summarise(stored), open: CountOpen() } } };
	}

	/// <summary>
	/// Answer a reports.* request; anything else is not this mock's.
	/// </summary>
	/// <param name="action">Action name</param>
	/// <param name="data">Payload</param>
	/// <param name="moderatorName">Name of the previewing moderator</param>
	/// <returns>{ ok, data } or { ok, errorKey }, or null when the action is not a report action</returns>
	function Handle(action, data, moderatorName)
	{
		switch (action)
		{
		case "reports.access":
			return { ok: true, data: Access() };
		case "reports.list":
		{
			const query = String(data.query || "").trim().toLowerCase();
			const digits = /^#?\d{1,8}$/.test(query) ? query.replace("#", "") : "";
			const matches = reports.filter((report) => (!data.status || report.status === data.status) && (!data.beforeId || report.id < data.beforeId) && (!query
				|| (digits && report.id === Number(digits))
				|| !query.startsWith("#") && report.members.some((member) => member.name.toLowerCase().includes(query) || member.number.includes(digits || query)))).reverse();
			return { ok: true, data: { reports: matches.slice(0, 30).map(Summarise), hasMore: matches.length > 30, open: CountOpen() } };
		}
		case "reports.open":
		{
			const report = reports.find((entry) => entry.id === data.reportId);

			if (!report)
			{
				return { ok: false, errorKey: "error.report.missing" };
			}

			const index = report.messages.findIndex((message) => message.id === report.messageId);
			const page = report.messages.slice(Math.max(0, index - 25), index + 26);
			return { ok: true, data: { report: { ...Summarise(report), messageId: report.messageId, members: report.members }, page: { messages: page, hasOlder: index - 25 > 0, hasNewer: index + 26 < report.messages.length } } };
		}
		case "reports.messages":
		{
			const report = reports.find((entry) => entry.id === data.reportId);

			if (!report)
			{
				return { ok: false, errorKey: "error.report.openFailed" };
			}

			const older = data.direction !== "newer";
			const side = report.messages.filter((message) => (older ? message.id < data.anchorId : message.id > data.anchorId));
			const page = older ? side.slice(-25) : side.slice(0, 25);
			return { ok: true, data: { reportId: report.id, direction: older ? "older" : "newer", page: { messages: page, hasOlder: older ? side.length > 25 : null, hasNewer: older ? null : side.length > 25 } } };
		}
		case "reports.setStatus":
		{
			const report = reports.find((entry) => entry.id === data.reportId);

			if (!report || !["open", "resolved", "dismissed"].includes(data.status))
			{
				return { ok: false, errorKey: "error.report.statusFailed" };
			}

			report.status = data.status;
			report.handledBy = data.status === "open" ? "" : moderatorName;
			report.handledAt = data.status === "open" ? 0 : Date.now();
			return { ok: true, data: { report: Summarise(report) } };
		}
		default:
			return null;
		}
	}

	return { Access, File, Handle, CountOpen };
})();
