// FranticDreamer 2026
"use strict";

window.Owls = window.Owls || {};
Owls.DeskScreens = Owls.DeskScreens || {};

// ========================
// Reports Screens
// ========================

/// <summary>
/// The desk's Reports tab, shown to moderators only: every report, searchable, and each reported letter thread read-only.
/// The views themselves are Owls.Moderation's, shared with the phone; these screens give them the desk's tabs and toolbar.
///
/// <para>
/// NOTE: Unlike everything else on the desk, these views name the characters in a reported thread and their owl numbers: moderators need to know who wrote what.
/// The server sends them only to players with the moderator permission, checked on every request.
/// </para>
///
/// </summary>
Owls.DeskScreens.Reports = (() =>
{
	const { Element } = Owls.Util;

	/// <summary>
	/// Build the screen.
	/// </summary>
	/// <param name="desk">Owls.Desk, for navigation</param>
	/// <returns>{ element, OnStore(reason), Destroy() }</returns>
	function Create(desk)
	{
		const head = Owls.DeskTabs.Create(desk, { active: "reports" });
		const view = Owls.Moderation.CreateList({ onOpen: (reportId) => desk.ShowReport(reportId) });
		const element = Element("section", { className: "letters reports" }, [head.element, Element("div", { className: "letters-scroll" }, [view.element])]);

		return {
			element,
			OnStore: (reason) =>
			{
				if (reason === "letters" || reason === "arrived" || reason === "me")
				{
					head.Render();
				}

				if (reason === "reports")
				{
					head.Render();
					view.Reload();
				}
			},
			Destroy: () => view.Destroy(),
		};
	}

	return { Create };
})();

/// <summary>
/// One reported letter thread, read-only.
/// </summary>
Owls.DeskScreens.Report = (() =>
{
	const { Element } = Owls.Util;
	const T = Owls.Lang.T;

	/// <summary>
	/// Build the screen.
	/// </summary>
	/// <param name="desk">Owls.Desk, for navigation</param>
	/// <param name="params">{ reportId }</param>
	/// <returns>{ element, OnStore(reason), Destroy() }</returns>
	function Create(desk, params)
	{
		const title = Element("span", { className: "compose-title", text: T("report.chatTitle", { number: Owls.Moderation.FormatReportNumber(params.reportId) }) });
		const view = Owls.Moderation.CreateReport({ reportId: params.reportId, onTitle: (text) =>
		{
			title.textContent = text;
		} });
		const element = Element("section", { className: "settings report" },
		[
			Element("div", { className: "desk-toolbar" },
			[
				Element("button", { className: "desk-button is-quiet", on: { click: () => desk.ShowReports() } },
				[
					Element("i", { className: "fa-solid fa-arrow-left", attributes: { "aria-hidden": "true" } }),
					Element("span", { text: T("mail.reader.back") }),
				]),
				title,
			]),
			Element("div", { className: "letters-scroll report-scroll" }, [view.element]),
		]);

		return { element, OnStore: () => {}, Destroy: () => view.Destroy() };
	}

	return { Create };
})();
