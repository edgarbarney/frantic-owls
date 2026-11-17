// FranticDreamer 2026
"use strict";

// ========================
// Moderation Screens
// ========================

/// <summary>
/// The Moderation app, shown on the home screen to moderators only: every report, searchable, and each reported chat read-only.
/// The views themselves are Owls.Moderation's, shared with the letter desk; these screens only give them the phone's header.
/// </summary>
Owls.Screens.Reports = (() =>
{
	const T = Owls.Lang.T;

	/// <summary>
	/// Create the screen.
	/// </summary>
	/// <returns>Screen instance</returns>
	function Create()
	{
		const view = Owls.Moderation.CreateList({ onOpen: (reportId) => Owls.App.Navigate("Report", { reportId }) });
		const header = Owls.Widgets.Header(T("home.moderation"));
		const element = Owls.Util.Element("div", { className: "screen" }, [header.element, Owls.Util.Element("div", { className: "screen-body" }, [view.element])]);

		/// <summary>
		/// Load the list again when a report arrives or changes.
		/// </summary>
		/// <param name="reason">Change reason from the store</param>
		function Refresh(reason)
		{
			if (reason === "reports")
			{
				view.Reload();
			}
		}

		return { element, Refresh, Destroy: () => view.Destroy() };
	}

	return { Create };
})();

/// <summary>
/// One reported chat, read-only, opened from the Moderation app or a report's pop-up.
/// </summary>
Owls.Screens.Report = (() =>
{
	const T = Owls.Lang.T;

	/// <summary>
	/// Create the screen.
	/// </summary>
	/// <param name="params">{ reportId }</param>
	/// <returns>Screen instance</returns>
	function Create(params)
	{
		const header = Owls.Widgets.Header(T("report.chatTitle", { number: Owls.Moderation.FormatReportNumber(params.reportId) }));
		const view = Owls.Moderation.CreateReport({ reportId: params.reportId, onTitle: (text) =>
		{
			header.title.textContent = text;
		} });
		const element = Owls.Util.Element("div", { className: "screen" }, [header.element, Owls.Util.Element("div", { className: "screen-body" }, [view.element])]);

		return { element, Refresh: () => {}, Destroy: () => view.Destroy() };
	}

	return { Create };
})();
