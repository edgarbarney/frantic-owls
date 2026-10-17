// FranticDreamer 2026
"use strict";

// ========================
// Home Screen
// ========================

/// <summary>
/// The phone's main screen: apps for Floo-Calls, Contacts, Owls, Inform and Settings, over the player's wallpaper if they set one.
/// The Floo-Calls app carries the missed calls not yet seen, the Owls app the total unread count and the Inform app the informs waiting for an answer.
/// Floo-Calls is hidden when the server turned calls off.
///
/// <para>
/// NOTE: Both themes share this markup and the stylesheet decides the look.
/// Muggle Phone lays the apps out as small icons in a grid, like a phone, and keeps its crest in Settings only;
/// Parchment shows the crest on top and the apps as large tiles.
/// </para>
///
/// </summary>
Owls.Screens.Home = (() =>
{
	const { Element } = Owls.Util;
	const T = Owls.Lang.T;

	/// <summary>
	/// Build one app: its icon in a rounded square, with its name underneath (or inside the tile, on Parchment).
	/// </summary>
	/// <param name="icon">Icon markup</param>
	/// <param name="label">App name</param>
	/// <param name="screen">Screen opened on click</param>
	/// <param name="badge">Unread badge element, or null</param>
	/// <returns>App element</returns>
	function CreateApp(icon, label, screen, badge = null)
	{
		const iconHolder = Element("span", { className: "home-tile-icon" });
		iconHolder.innerHTML = icon;

		if (badge)
		{
			iconHolder.appendChild(badge);
		}

		// The app opens out of its icon on Muggle Phone; data-screen is how the App finds the icon again to shrink back into.
		return Element("button", { className: "home-tile", attributes: { "data-screen": screen }, on: { click: () => Owls.App.OpenApp(screen) } }, [iconHolder, Element("span", { className: "home-tile-label", text: label })]);
	}

	/// <summary>
	/// Create the screen.
	/// </summary>
	/// <returns>Screen instance</returns>
	function Create()
	{
		const badge = Element("span", { className: "unread-badge" });
		const callsBadge = Element("span", { className: "unread-badge" });
		const informBadge = Element("span", { className: "unread-badge" });
		const owner = Element("div", { className: "crest-owner" });
		const callsApp = CreateApp(Owls.Icons.flame, T("home.calls"), "Calls", callsBadge);
		const grid = Element("div", { className: "home-grid" },
		[
			callsApp,
			CreateApp(Owls.Icons.contacts, T("home.contacts"), "Contacts"),
			CreateApp(Owls.Icons.owl, T("home.owls"), "Owls", badge),
			CreateApp(Owls.Icons.inform, T("home.inform"), "Inform", informBadge),
			CreateApp(Owls.Icons.settings, T("home.settings"), "Settings"),
		]);

		const element = Element("div", { className: "home" },
		[
			Element("div", { className: "crest-title", text: T("home.crestTitle") }),
			Element("div", { className: "crest-subtitle", text: T("home.crestSubtitle") }),
			owner,
			grid,
		]);

		/// <summary>
		/// Update the owner line, the unread badge, the missed calls and the count of informs waiting for an answer.
		/// </summary>
		function Refresh()
		{
			const unread = Owls.Store.GetTotalUnread();
			const missed = Owls.Store.GetMissedCallCount();
			const waiting = Owls.Store.GetInformRequests().length;
			callsBadge.textContent = missed > 99 ? "99+" : String(missed);
			callsBadge.hidden = missed === 0;

			// The screen is built before the server's settings arrive, so whether calls are on is only known here.
			// The app count lets Parchment fit five large tiles where four used to be.
			callsApp.hidden = Owls.Store.state.config.callsEnabled === false;
			grid.dataset.count = String(grid.querySelectorAll(".home-tile:not([hidden])").length);
			informBadge.textContent = String(waiting);
			informBadge.hidden = waiting === 0;
			owner.textContent = Owls.Store.state.me.name ? T("home.owner", { name: Owls.Store.state.me.name }) : "";
			badge.textContent = unread > 99 ? "99+" : String(unread);
			badge.hidden = unread === 0;
		}

		Refresh();
		return { element, Refresh, Destroy: () => {} };
	}

	return { Create };
})();
