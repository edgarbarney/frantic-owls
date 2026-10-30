// FranticDreamer 2026
"use strict";

window.Owls = window.Owls || {};

// ========================
// Desk Tabs
// ========================

/// <summary>
/// The tabs along the top of the desk's main screens: the inbox, the sent box, the correspondents and, for those allowed to write them, official letters.
/// Each screen builds its own head with these tabs and its own button beside them (writing a letter, adding a correspondent).
/// </summary>
Owls.DeskTabs = (() =>
{
	const { Element } = Owls.Util;
	const T = Owls.Lang.T;
	const Store = Owls.MailStore;

	/// <summary>
	/// Build a head of tabs.
	/// </summary>
	/// <param name="desk">Owls.Desk, for navigation</param>
	/// <param name="options">{ active: "inbox" | "sent" | "correspondents" | "official", onBox(box) (optional, lets the letters screen switch boxes in place), action (optional button beside the tabs) }</param>
	/// <returns>{ element, Render(active) }</returns>
	function Create(desk, options)
	{
		const tabs = Element("div", { className: "letters-tabs", attributes: { role: "tablist" } });
		const element = Element("div", { className: "letters-head" }, [tabs, options.action || null]);
		let active = options.active;

		/// <summary>
		/// Go to a tab.
		/// </summary>
		/// <param name="name">Tab name</param>
		function Go(name)
		{
			if ((name === "inbox" || name === "sent") && options.onBox)
			{
				options.onBox(name);
				return;
			}

			switch (name)
			{
			case "inbox":
			case "sent":
				desk.ShowLetters({ box: name });
				break;
			case "correspondents":
				desk.ShowCorrespondents();
				break;
			case "official":
				desk.ShowOfficial();
				break;
			default:
				break;
			}
		}

		/// <summary>
		/// One tab.
		/// </summary>
		/// <param name="name">Tab name</param>
		/// <param name="label">Text</param>
		/// <param name="badge">Number shown beside it, 0 for none</param>
		/// <returns>Button</returns>
		function Tab(name, label, badge = 0)
		{
			return Element("button", { className: `letters-tab ${active === name ? "is-active" : ""}`, attributes: { role: "tab", "aria-selected": String(active === name) }, on: { click: () => Go(name) } },
			[
				Element("span", { text: label }),
				badge > 0 ? Element("span", { className: "letters-badge", text: badge > 99 ? "99+" : String(badge) }) : null,
			]);
		}

		/// <summary>
		/// Draw the tabs, e.g. after the unread count changed.
		/// </summary>
		/// <param name="newActive">Tab to mark active (optional; keeps the current one)</param>
		function Render(newActive)
		{
			active = newActive || active;
			tabs.replaceChildren(...[
				Tab("inbox", T("mail.list.inbox"), Store.state.unread),
				Tab("sent", T("mail.list.sent")),
				Tab("correspondents", T("mail.correspondents.tab")),
				Store.state.me.canPostOfficial ? Tab("official", T("mail.official.tab")) : null,
			].filter(Boolean));
		}

		Render();
		return { element, Render };
	}

	return { Create };
})();
