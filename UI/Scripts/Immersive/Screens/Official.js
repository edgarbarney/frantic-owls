// FranticDreamer 2026
"use strict";

window.Owls = window.Owls || {};
Owls.DeskScreens = Owls.DeskScreens || {};

// ========================
// Official Letters Screen
// ========================

/// <summary>
/// For players allowed to make announcements (the same permission as /owl_announce): writing official letters as the Ministry, or as any other resource's sender that is running.
/// An official letter goes to everyone as an announcement, or to each character named, one copy each.
/// The tab only shows for those the server said may use it; the server checks again on every request.
/// </summary>
Owls.DeskScreens.Official = (() =>
{
	const { Element, CreateAvatar } = Owls.Util;
	const T = Owls.Lang.T;

	/// <summary>
	/// Build the screen.
	/// </summary>
	/// <param name="desk">Owls.Desk, for navigation and messages</param>
	/// <returns>{ element, OnStore(reason), Destroy() }</returns>
	function Create(desk)
	{
		const head = Owls.DeskTabs.Create(desk, { active: "official" });
		const list = Element("ul", { className: "official-senders" });
		const note = Element("p", { className: "letters-empty", text: T("mail.list.loading") });
		const element = Element("section", { className: "letters official" },
		[
			head.element,
			Element("p", { className: "letters-hint", text: T("mail.official.intro") }),
			Element("div", { className: "letters-scroll" }, [list, note]),
		]);

		/// <summary>
		/// One sender to write as.
		/// </summary>
		/// <param name="sender">{ number, name }</param>
		/// <returns>List item</returns>
		function CreateRow(sender)
		{
			return Element("li", {},
			[
				Element("button", { className: "official-sender", on: { click: () => desk.Compose({ official: sender }) } },
				[
					CreateAvatar(sender.name, "", sender.name, "is-desk"),
					Element("span", { className: "official-sender-lines" },
					[
						Element("span", { className: "official-sender-name", text: sender.name }),
						Element("span", { className: "official-sender-hint", text: T("mail.official.writeAs", { sender: sender.name }) }),
					]),
					Element("i", { className: "fa-solid fa-feather-pointed", attributes: { "aria-hidden": "true" } }),
				]),
			]);
		}

		/// <summary>
		/// Ask the server which senders the player may write as.
		/// </summary>
		async function Load()
		{
			const result = await Owls.Bridge.Request("mail.officialSenders", {});

			if (!result.ok)
			{
				note.textContent = result.error;
				return;
			}

			const senders = Array.isArray(result.data.senders) ? result.data.senders : [];
			list.replaceChildren(...senders.map(CreateRow));
			note.textContent = T("mail.official.noSenders");
			note.hidden = senders.length > 0;
		}

		Load();

		return {
			element,
			OnStore: (reason) =>
			{
				if (reason === "letters" || reason === "arrived")
				{
					head.Render();
				}
			},
			Destroy: () => {},
		};
	}

	return { Create };
})();
